import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { expectedRenewalValues } from "./revenue-metrics";

/**
 * PAINEL DE RENOVAÇÕES — fonte única da seção "Renovações do Mês" (Gestão do
 * Mês) e do módulo /renovacoes. Para uma competência (mês/ano):
 *
 *  - Clientes ativos com renovação prevista no mês: união de
 *    Client.renewalMonth === mês (agenda editável da carteira) e
 *    Contract.renewalDate dentro do mês (vigência real do contrato).
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

const ACTIVE_STATUSES = ["ACTIVE", "RENEWAL", "DELINQUENT", "PAUSED"] as const;

function monthsBetween(from: Date | null, toYear: number, toMonth: number): number | null {
  if (!from) return null;
  const key = toYear * 12 + (toMonth - 1);
  const fromKey = from.getFullYear() * 12 + from.getMonth();
  return Math.max(0, key - fromKey);
}

const CLIENT_SELECT = {
  id: true, name: true, status: true, modality: true, salesOwner: true,
  monthlyValue: true, contractMonths: true, startedAt: true,
} as const;

export async function getRenewalPanel(month: number, year: number): Promise<RenewalPanel> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  // FASE 1 — quatro fontes da lista do mês:
  //  (a) agenda da carteira (Client.renewalMonth) — clientes em atividade;
  //  (b) contratos vigentes com renewalDate dentro do mês;
  //  (c) renovações JÁ registradas para o mês (por data OU pela competência
  //      de lançamento escolhida) — mantém a linha verde mesmo que a
  //      renovação tenha mudado o renewalMonth do cliente, e marca como
  //      renovada a renovação antecipada feita noutro mês;
  //  (d) perdas do mês — o "Não renovou" vira CHURNED e ainda assim precisa
  //      aparecer como linha vermelha.
  const [byMonth, contractsInMonth, renewals, losses] = await Promise.all([
    prisma.client.findMany({
      where: {
        renewalMonth: month,
        status: { in: ACTIVE_STATUSES as any },
      },
      orderBy: { name: "asc" },
      select: CLIENT_SELECT,
    }),
    prisma.contract.findMany({
      where: {
        renewalDate: { gte: monthStart, lt: monthEnd },
        status: { in: ["ACTIVE", "RENEWAL"] },
      },
      select: { clientId: true, client: { select: CLIENT_SELECT } },
    }),
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

  // União (dedup por cliente). Contratos exigem cliente em atividade;
  // renovados/perdidos do mês entram SEMPRE (o desfecho é a própria linha).
  const clientById = new Map<string, (typeof byMonth)[number]>();
  for (const c of byMonth) clientById.set(c.id, c);
  for (const ct of contractsInMonth) {
    if (
      !clientById.has(ct.clientId) &&
      (ACTIVE_STATUSES as readonly string[]).includes(ct.client.status)
    ) {
      clientById.set(ct.clientId, ct.client);
    }
  }
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
// (agenda Client.renewalMonth), para o módulo /renovacoes.
// ===================================================================

export type RenewalStripItem = {
  month: number; // 1-12
  year: number;
  count: number;
  expectedTotal: number;
};

export async function getRenewalStrip(
  fromMonth: number,
  fromYear: number,
  span = 6
): Promise<RenewalStripItem[]> {
  const clients = await prisma.client.findMany({
    where: {
      renewalMonth: { not: null },
      status: { in: ACTIVE_STATUSES as any },
    },
    select: { id: true, modality: true, monthlyValue: true, renewalMonth: true },
  });
  const expected = await expectedRenewalValues(clients);

  const byMonth = new Map<number, { count: number; expectedTotal: number }>();
  for (const c of clients) {
    const cur = byMonth.get(c.renewalMonth!) ?? { count: 0, expectedTotal: 0 };
    cur.count += 1;
    cur.expectedTotal += expected.get(c.id) ?? 0;
    byMonth.set(c.renewalMonth!, cur);
  }

  return Array.from({ length: span }, (_, i) => {
    const ref = new Date(fromYear, fromMonth - 1 + i, 1);
    const month = ref.getMonth() + 1;
    const bucket = byMonth.get(month) ?? { count: 0, expectedTotal: 0 };
    return { month, year: ref.getFullYear(), ...bucket };
  });
}
