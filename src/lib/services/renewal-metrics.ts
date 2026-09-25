import { prisma } from "@/lib/prisma";
import { toNumber as n, MONTHS_PT_SHORT } from "@/lib/format";
import { ownerCached } from "@/lib/owner-cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import {
  currentYearMonth, fromMonthIndex, monthIndex, monthRange, toCompetenceKey, type YearMonth,
} from "@/lib/renewal-expectation";
import {
  renewalLedger, renewalLedgerMonth, overdueRenewals,
  type RenewalLedgerRow, type RenewalLedgerMonth,
} from "./renewal-schedule";

/**
 * PAINEL DE RENOVAÇÕES — o que o módulo /renovacoes, a seção da Gestão do
 * Mês e a Visão geral mostram. Tudo vem do LIVRO de renewal-schedule; aqui
 * só se acrescenta o contrato vigente (que o "Sim, renovou" estende) e os
 * recortes de tempo (faixa dos próximos meses, histórico do gráfico).
 */

export type RenewalPanelRow = RenewalLedgerRow & {
  contract: {
    id: string;
    title: string;
    type: string;
    totalValue: number;
    monthlyValue: number;
  } | null;
};

export type RenewalPanel = Omit<RenewalLedgerMonth, "rows"> & {
  rows: RenewalPanelRow[];
  /** Expectativas de meses anteriores ainda sem desfecho (só no mês corrente). */
  overdue: { count: number; value: number } | null;
};

export async function getRenewalPanel(month: number, year: number): Promise<RenewalPanel> {
  const ym = { month, year };
  const ledger = await renewalLedgerMonth(ym);
  const ids = ledger.rows.map((r) => r.clientId);
  const hoje = currentYearMonth();
  const [contracts, overdue] = await Promise.all([
    ids.length
      ? prisma.contract.findMany({
          where: { clientId: { in: ids }, status: { in: ["ACTIVE", "RENEWAL"] } },
          orderBy: { endDate: "desc" },
          select: {
            id: true, clientId: true, title: true, type: true,
            totalValue: true, monthlyValue: true,
          },
        })
      : Promise.resolve([]),
    monthIndex(ym) === monthIndex(hoje) ? overdueRenewals(ym) : Promise.resolve(null),
  ]);
  const byClient = new Map<string, (typeof contracts)[number]>();
  for (const c of contracts) if (!byClient.has(c.clientId)) byClient.set(c.clientId, c);

  return {
    ...ledger,
    overdue,
    rows: ledger.rows.map((r) => {
      const ct = byClient.get(r.clientId);
      return {
        ...r,
        contract: ct
          ? {
              id: ct.id, title: ct.title, type: ct.type,
              totalValue: n(ct.totalValue), monthlyValue: n(ct.monthlyValue),
            }
          : null,
      };
    }),
  };
}

// ===================================================================
// Faixa de previsibilidade — próximos meses a partir do mês em foco.
// ===================================================================

export type RenewalStripItem = {
  month: number;
  year: number;
  count: number;
  expectedTotal: number;
};

async function getRenewalStripImpl(
  fromMonth: number,
  fromYear: number,
  span = 6
): Promise<RenewalStripItem[]> {
  const meses = monthRange({ month: fromMonth, year: fromYear }, span);
  const livro = await renewalLedger(meses);
  return meses.map((ym) => {
    const m = livro.get(toCompetenceKey(ym))!;
    return { month: ym.month, year: ym.year, count: m.rows.length, expectedTotal: m.expectedTotal };
  });
}

/** Versão cacheada por (usuário, janela) — TTL 300s; invalidada por mutações
 * de clientes/contratos (revalidateAgency → tags). */
export const getRenewalStrip = ownerCached("renewal-strip", getRenewalStripImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.CLIENTS, CACHE_TAGS.CONTRACTS],
});

// ===================================================================
// Histórico — evolução mês a mês (gráfico da Visão geral).
// ===================================================================

export type RenewalHistoryPoint = {
  label: string; // "Set/26"
  competence: string; // "2026-09"
  expected: number;
  gained: number;
  lost: number;
  pending: number;
  renewedCount: number;
  lostCount: number;
};

/**
 * Os `back` meses anteriores a `ym` e o próprio `ym` (padrão: 6 + o atual),
 * em ordem cronológica.
 */
export async function getRenewalHistory(ym: YearMonth, back = 6): Promise<RenewalHistoryPoint[]> {
  const inicio = fromMonthIndex(monthIndex(ym) - back);
  const meses = monthRange(inicio, back + 1);
  const livro = await renewalLedger(meses);
  return meses.map((m) => {
    const l = livro.get(toCompetenceKey(m))!;
    return {
      label: `${MONTHS_PT_SHORT[m.month - 1]}/${String(m.year).slice(2)}`,
      competence: l.competence,
      expected: l.expectedTotal,
      gained: l.gainedValue,
      lost: l.lostValue,
      pending: l.pendingValue,
      renewedCount: l.renewedCount,
      lostCount: l.lostCount,
    };
  });
}
