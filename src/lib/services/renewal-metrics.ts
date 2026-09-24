import { prisma } from "@/lib/prisma";
import {
  scheduledRenewals, monthKey, zonedMonthBounds, SCHEDULE_CLIENT_SELECT,
} from "./renewal-schedule";
import { toNumber as n } from "@/lib/format";
import { ownerCached } from "@/lib/owner-cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { expectedRenewalValues } from "./revenue-metrics";

/**
 * PAINEL DE RENOVAÇÕES — fonte única da seção "Renovações do Mês" (Gestão do
 * Mês) e do módulo /renovacoes. Para uma competência (mês/ano):
 *
 *  - Clientes ativos com renovação prevista no mês: a AGENDA única de
 *    renewal-schedule (Client.renewalMonth, Contract.renewalDate do contrato
 *    vigente e, na falta dos dois, entrada + prazo). O card do painel
 *    principal, a faixa de próximos meses e o relatório leem a MESMA agenda.
 *  - Valor esperado pela regra central `expectedRenewalValues` (TCV = valor
 *    cheio da última adesão; MRR = mensalidade atual).
 *  - Cruza com ClientRenewal para marcar quem JÁ renovou no mês (e quando) e
 *    com ClientLoss para quem foi marcado como perdido no mês.
 */

export type RenewalPanelRow = {
  clientId: string;
  name: string;
  status: string; // ClientStatus
  modality: string | null; // MRR | TCV
  salesOwner: string | null;
  /** Mensalidade atual do cadastro (default do form de renovação MRR). */
  monthlyValue: number | null;
  /** Dia recorrente de pagamento do cadastro (default do form MRR). */
  paymentDay: number | null;
  /** Data de renovação do contrato (renewalDate), quando existe. */
  renewalDateISO: string | null;
  /** Há quantos meses o contrato/relação está ativo (startDate → mês alvo). */
  monthsActive: number | null;
  /** Prazo cadastrado do contrato (Client.contractMonths). */
  contractMonths: number | null;
  /** Valor do contrato: TCV = valor cheio da última adesão; MRR = mensalidade. */
  expected: number;
  contract: {
    id: string;
    title: string;
    type: string;
    totalValue: number;
    monthlyValue: number;
  } | null;
  /** Renovação já registrada NESTE mês (se houver). */
  renewal: {
    id: string;
    renewedAtISO: string;
    months: number;
    totalValue: number;
  } | null;
  /** Perda registrada neste mês (não renovou). */
  lostAtISO: string | null;
};

export type RenewalPanel = {
  month: number;
  year: number;
  rows: RenewalPanelRow[];
  expectedTotal: number;
  renewedCount: number;
  renewedValue: number;
  lostCount: number;
  pendingCount: number;
};

function monthsBetween(from: Date | null, toYear: number, toMonth: number): number | null {
  if (!from) return null;
  const key = toYear * 12 + (toMonth - 1);
  const fromKey = from.getFullYear() * 12 + from.getMonth();
  return Math.max(0, key - fromKey);
}

const CLIENT_SELECT = SCHEDULE_CLIENT_SELECT;

export async function getRenewalPanel(month: number, year: number): Promise<RenewalPanel> {
  const { start: monthStart, end: monthEnd } = zonedMonthBounds(year, month);

  // FASE 1 — três fontes da lista do mês:
  //  (a) agenda única de renovações (renewal-schedule): mês de renovação do
  //      cadastro, data do contrato vigente ou entrada + prazo;
  //  (b) renovações JÁ registradas para o mês (por data OU pela competência
  //      de lançamento escolhida) — mantém a linha verde mesmo que a
  //      renovação tenha mudado o renewalMonth do cliente, e marca como
  //      renovada a renovação antecipada feita noutro mês;
  //  (c) perdas do mês — o "Não renovou" vira CHURNED e ainda assim precisa
  //      aparecer como linha vermelha.
  const [schedule, renewals, losses] = await Promise.all([
    scheduledRenewals([{ month, year }]),
    prisma.clientRenewal.findMany({
      where: {
        OR: [
          { renewedAt: { gte: monthStart, lt: monthEnd } },
          { billingYear: year, billingMonth: month },
        ],
      },
      orderBy: { renewedAt: "desc" },
      select: {
        id: true, clientId: true, renewedAt: true, months: true, totalValue: true,
        client: { select: CLIENT_SELECT },
      },
    }),
    prisma.clientLoss.findMany({
      where: { lostAt: { gte: monthStart, lt: monthEnd } },
      orderBy: { lostAt: "desc" },
      select: { clientId: true, lostAt: true, client: { select: CLIENT_SELECT } },
    }),
  ]);
  const scheduled = schedule.get(monthKey({ month, year })) ?? [];

  // União (dedup por cliente). A agenda já exige cliente em atividade;
  // renovados/perdidos do mês entram SEMPRE (o desfecho é a própria linha).
  type PanelClient = {
    id: string; name: string; status: string; modality: string | null;
    salesOwner: string | null; monthlyValue: unknown; totalContractValue: unknown;
    paymentDay: number | null; contractMonths: number | null; startedAt: Date | null;
  };
  const clientById = new Map<string, PanelClient>();
  for (const c of scheduled) clientById.set(c.id, c);
  for (const r of renewals) {
    if (!clientById.has(r.clientId)) clientById.set(r.clientId, r.client);
  }
  for (const l of losses) {
    if (!clientById.has(l.clientId)) clientById.set(l.clientId, l.client);
  }
  const clients = Array.from(clientById.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );
  const ids = clients.map((c) => c.id);

  if (ids.length === 0) {
    return {
      month, year, rows: [], expectedTotal: 0,
      renewedCount: 0, renewedValue: 0, lostCount: 0, pendingCount: 0,
    };
  }

  // FASE 2 — apoio: contrato vigente por cliente + valores esperados.
  const [contracts, expected] = await Promise.all([
    prisma.contract.findMany({
      where: { clientId: { in: ids }, status: { in: ["ACTIVE", "RENEWAL"] } },
      orderBy: { endDate: "desc" },
      select: {
        id: true, clientId: true, title: true, type: true,
        totalValue: true, monthlyValue: true, startDate: true, renewalDate: true,
      },
    }),
    expectedRenewalValues(clients),
  ]);

  const contractByClient = new Map<string, (typeof contracts)[number]>();
  for (const c of contracts)
    if (!contractByClient.has(c.clientId)) contractByClient.set(c.clientId, c);
  const renewalByClient = new Map<string, (typeof renewals)[number]>();
  for (const r of renewals)
    if (!renewalByClient.has(r.clientId)) renewalByClient.set(r.clientId, r);
  const lossByClient = new Map<string, Date>();
  for (const l of losses)
    if (!lossByClient.has(l.clientId)) lossByClient.set(l.clientId, l.lostAt);

  const rows: RenewalPanelRow[] = clients.map((c) => {
    const ct = contractByClient.get(c.id) ?? null;
    const renewal = renewalByClient.get(c.id) ?? null;
    const lostAt = lossByClient.get(c.id) ?? null;
    return {
      clientId: c.id,
      name: c.name,
      status: c.status,
      modality: c.modality,
      salesOwner: c.salesOwner,
      monthlyValue: c.monthlyValue != null ? n(c.monthlyValue) : null,
      paymentDay: c.paymentDay,
      renewalDateISO: ct?.renewalDate ? ct.renewalDate.toISOString() : null,
      monthsActive: monthsBetween(ct?.startDate ?? c.startedAt, year, month),
      contractMonths: c.contractMonths,
      expected: expected.get(c.id) ?? 0,
      contract: ct
        ? {
            id: ct.id,
            title: ct.title,
            type: ct.type,
            totalValue: n(ct.totalValue),
            monthlyValue: n(ct.monthlyValue),
          }
        : null,
      renewal: renewal
        ? {
            id: renewal.id,
            renewedAtISO: renewal.renewedAt.toISOString(),
            months: renewal.months,
            totalValue: n(renewal.totalValue),
          }
        : null,
      lostAtISO: lostAt ? lostAt.toISOString() : null,
    };
  });

  const renewedRows = rows.filter((r) => r.renewal);
  const lostRows = rows.filter((r) => !r.renewal && r.lostAtISO);
  return {
    month,
    year,
    rows,
    expectedTotal: rows.reduce((s, r) => s + r.expected, 0),
    renewedCount: renewedRows.length,
    renewedValue: renewedRows.reduce((s, r) => s + (r.renewal?.totalValue ?? 0), 0),
    lostCount: lostRows.length,
    pendingCount: rows.length - renewedRows.length - lostRows.length,
  };
}

// ===================================================================
// Faixa de previsibilidade — contagem/valor esperado dos próximos meses
// (agenda única de renewal-schedule), para o módulo /renovacoes.
// ===================================================================

export type RenewalStripItem = {
  month: number; // 1-12
  year: number;
  count: number;
  expectedTotal: number;
};

async function getRenewalStripImpl(
  fromMonth: number,
  fromYear: number,
  span = 6
): Promise<RenewalStripItem[]> {
  const window = Array.from({ length: span }, (_, i) => {
    const ref = new Date(fromYear, fromMonth - 1 + i, 1);
    return { month: ref.getMonth() + 1, year: ref.getFullYear() };
  });
  const schedule = await scheduledRenewals(window);
  const all = Array.from(schedule.values()).flat();
  const expected = await expectedRenewalValues(all);

  return window.map((w) => {
    const clients = schedule.get(monthKey(w)) ?? [];
    return {
      month: w.month,
      year: w.year,
      count: clients.length,
      expectedTotal: clients.reduce((s, c) => s + (expected.get(c.id) ?? 0), 0),
    };
  });
}

/** Versão cacheada por (usuário, janela) — TTL 300s; invalidada por mutações
 * de clientes/contratos (revalidateAgency → tags). */
export const getRenewalStrip = ownerCached("renewal-strip", getRenewalStripImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.CLIENTS, CACHE_TAGS.CONTRACTS],
});
