import { PORTFOLIO_ACTIVE_STATUSES } from "@/lib/client-status";
import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import {
  monthBounds, monthIndex, toCompetenceKey, civilParts, type YearMonth,
} from "@/lib/renewal-expectation";
import { expectedRenewalValues } from "./revenue-metrics";

/**
 * LIVRO DE RENOVAÇÕES — fonte única (25/09/2026).
 *
 * Para cada competência (mês/ano), três tipos de linha:
 *
 *   PENDENTE  cliente em atividade cuja DATA DE EXPECTATIVA
 *             (Client.expectedRenewalAt) cai no mês e ainda sem desfecho;
 *   GANHA     renovação registrada para a expectativa daquele mês
 *             (ClientRenewal.expectedCompetence);
 *   PERDIDA   perda registrada contra a expectativa daquele mês
 *             (ClientLoss.renewalCompetence).
 *
 * O desfecho conta no mês da EXPECTATIVA, não no dia em que foi registrado:
 * quem renova em agosto a expectativa de setembro é uma renovação ganha de
 * setembro. É o que mantém "ganho ≤ esperado" e o histórico comparável.
 *
 * Valor esperado da linha: pendente → regra central `expectedRenewalValues`
 * (TCV = valor cheio do contrato; MRR = mensalidade); ganha/perdida → o
 * valor esperado gravado no desfecho (snapshot), para o passado não mudar
 * quando o cadastro muda.
 *
 * Todos os leitores de renovação (módulo, Gestão do Mês, Visão geral,
 * gráfico, rotina, painel do gestor, notificações, relatórios, assistente)
 * passam por aqui.
 */

export type RenewalOutcome = "pendente" | "renovou" | "nao_renovou";

export type RenewalLedgerRow = {
  clientId: string;
  name: string;
  status: string;
  modality: string | null;
  salesOwner: string | null;
  monthlyValue: number | null;
  paymentDay: number | null;
  contractMonths: number | null;
  startedAtISO: string | null;
  /** Data de expectativa (pendente: a atual do cliente; desfecho: nula). */
  expectedRenewalAtISO: string | null;
  /** Meses de relação até o mês da expectativa. */
  monthsActive: number | null;
  expected: number;
  outcome: RenewalOutcome;
  renewal: { id: string; renewedAtISO: string; months: number; totalValue: number } | null;
  lostAtISO: string | null;
  lostValue: number;
};

export type RenewalLedgerMonth = {
  month: number;
  year: number;
  competence: string;
  rows: RenewalLedgerRow[];
  /** Soma dos valores esperados de TODAS as linhas do mês (pendentes + desfechos). */
  expectedTotal: number;
  /** Soma do valor das renovações ganhas. */
  gainedValue: number;
  /** Soma do valor esperado das renovações perdidas. */
  lostValue: number;
  /** Soma esperada do que ainda não teve desfecho. */
  pendingValue: number;
  renewedCount: number;
  lostCount: number;
  pendingCount: number;
};

export const LEDGER_CLIENT_SELECT = {
  id: true, name: true, status: true, modality: true, salesOwner: true,
  monthlyValue: true, totalContractValue: true, paymentDay: true,
  contractMonths: true, startedAt: true, expectedRenewalAt: true,
} as const;

type LedgerClient = {
  id: string; name: string; status: string; modality: string | null;
  salesOwner: string | null; monthlyValue: unknown; totalContractValue: unknown;
  paymentDay: number | null; contractMonths: number | null;
  startedAt: Date | null; expectedRenewalAt: Date | null;
};

function mesesDeRelacao(startedAt: Date | null, ym: YearMonth): number | null {
  if (!startedAt) return null;
  return Math.max(0, monthIndex(ym) - monthIndex(civilParts(startedAt)));
}

/** Livro de várias competências de uma vez (consultas em lote). */
export async function renewalLedger(months: YearMonth[]): Promise<Map<string, RenewalLedgerMonth>> {
  const out = new Map<string, RenewalLedgerMonth>();
  if (months.length === 0) return out;
  const keys = months.map(toCompetenceKey);
  const ordered = [...months].sort((a, b) => monthIndex(a) - monthIndex(b));
  const rangeStart = monthBounds(ordered[0]).start;
  const rangeEnd = monthBounds(ordered[ordered.length - 1]).end;

  const [pendentes, renovacoes, perdas] = await Promise.all([
    prisma.client.findMany({
      where: {
        expectedRenewalAt: { gte: rangeStart, lt: rangeEnd },
        status: { in: [...PORTFOLIO_ACTIVE_STATUSES] as any },
      },
      select: LEDGER_CLIENT_SELECT,
    }),
    prisma.clientRenewal.findMany({
      where: { expectedCompetence: { in: keys } },
      orderBy: { renewedAt: "desc" },
      select: {
        id: true, clientId: true, renewedAt: true, months: true, totalValue: true,
        expectedValue: true, expectedCompetence: true,
        client: { select: LEDGER_CLIENT_SELECT },
      },
    }),
    prisma.clientLoss.findMany({
      where: { renewalCompetence: { in: keys } },
      orderBy: { lostAt: "desc" },
      select: {
        clientId: true, lostAt: true, expectedValue: true, renewalCompetence: true,
        client: { select: LEDGER_CLIENT_SELECT },
      },
    }),
  ]);

  // Valor esperado ATUAL (regra central) — para pendentes e para desfechos
  // antigos que não guardaram o snapshot.
  const todos = new Map<string, LedgerClient>();
  for (const c of pendentes) todos.set(c.id, c);
  for (const r of renovacoes) todos.set(r.client.id, r.client);
  for (const l of perdas) todos.set(l.client.id, l.client);
  const esperadoAtual = await expectedRenewalValues(Array.from(todos.values()));

  for (const ym of months) {
    const key = toCompetenceKey(ym);
    const { start, end } = monthBounds(ym);
    const linhas = new Map<string, RenewalLedgerRow>();

    const base = (c: LedgerClient): Omit<RenewalLedgerRow, "expected" | "outcome" | "renewal" | "lostAtISO" | "lostValue" | "expectedRenewalAtISO"> => ({
      clientId: c.id,
      name: c.name,
      status: c.status,
      modality: c.modality,
      salesOwner: c.salesOwner,
      monthlyValue: c.monthlyValue != null ? n(c.monthlyValue) : null,
      paymentDay: c.paymentDay,
      contractMonths: c.contractMonths,
      startedAtISO: c.startedAt ? c.startedAt.toISOString() : null,
      monthsActive: mesesDeRelacao(c.startedAt, ym),
    });

    // 1) Ganhas (a mais recente por cliente).
    for (const r of renovacoes) {
      if (r.expectedCompetence !== key || linhas.has(r.clientId)) continue;
      const esperado = r.expectedValue != null ? n(r.expectedValue) : n(r.totalValue);
      linhas.set(r.clientId, {
        ...base(r.client),
        expectedRenewalAtISO: null,
        expected: esperado,
        outcome: "renovou",
        renewal: {
          id: r.id,
          renewedAtISO: r.renewedAt.toISOString(),
          months: r.months,
          totalValue: n(r.totalValue),
        },
        lostAtISO: null,
        lostValue: 0,
      });
    }
    // 2) Perdidas (sem renovação no mesmo mês).
    for (const l of perdas) {
      if (l.renewalCompetence !== key || linhas.has(l.clientId)) continue;
      const esperado =
        l.expectedValue != null ? n(l.expectedValue) : esperadoAtual.get(l.clientId) ?? 0;
      linhas.set(l.clientId, {
        ...base(l.client),
        expectedRenewalAtISO: null,
        expected: esperado,
        outcome: "nao_renovou",
        renewal: null,
        lostAtISO: l.lostAt.toISOString(),
        lostValue: esperado,
      });
    }
    // 3) Pendentes: expectativa no mês e sem desfecho.
    for (const c of pendentes) {
      if (!c.expectedRenewalAt || linhas.has(c.id)) continue;
      if (c.expectedRenewalAt < start || c.expectedRenewalAt >= end) continue;
      linhas.set(c.id, {
        ...base(c),
        expectedRenewalAtISO: c.expectedRenewalAt.toISOString(),
        expected: esperadoAtual.get(c.id) ?? 0,
        outcome: "pendente",
        renewal: null,
        lostAtISO: null,
        lostValue: 0,
      });
    }

    const rows = Array.from(linhas.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const ganhas = rows.filter((r) => r.outcome === "renovou");
    const perdidas = rows.filter((r) => r.outcome === "nao_renovou");
    const pend = rows.filter((r) => r.outcome === "pendente");
    const soma = (xs: RenewalLedgerRow[], f: (r: RenewalLedgerRow) => number) =>
      Math.round(xs.reduce((s, r) => s + f(r), 0) * 100) / 100;

    out.set(key, {
      month: ym.month,
      year: ym.year,
      competence: key,
      rows,
      expectedTotal: soma(rows, (r) => r.expected),
      gainedValue: soma(ganhas, (r) => r.renewal?.totalValue ?? 0),
      lostValue: soma(perdidas, (r) => r.lostValue),
      pendingValue: soma(pend, (r) => r.expected),
      renewedCount: ganhas.length,
      lostCount: perdidas.length,
      pendingCount: pend.length,
    });
  }
  return out;
}

/** Livro de uma competência. */
export async function renewalLedgerMonth(ym: YearMonth): Promise<RenewalLedgerMonth> {
  const m = await renewalLedger([ym]);
  return m.get(toCompetenceKey(ym))!;
}

/**
 * Expectativas de meses ANTERIORES a `ym` que continuam sem desfecho — o que
 * ficou para trás e ainda precisa de "renovou / não renovou".
 */
export async function overdueRenewals(ym: YearMonth): Promise<{ count: number; value: number }> {
  const { start } = monthBounds(ym);
  const clients = await prisma.client.findMany({
    where: {
      expectedRenewalAt: { lt: start },
      status: { in: [...PORTFOLIO_ACTIVE_STATUSES] as any },
    },
    select: LEDGER_CLIENT_SELECT,
  });
  if (clients.length === 0) return { count: 0, value: 0 };
  const v = await expectedRenewalValues(clients);
  return {
    count: clients.length,
    value: Math.round(clients.reduce((s, c) => s + (v.get(c.id) ?? 0), 0) * 100) / 100,
  };
}

/**
 * Clientes em atividade com expectativa entre `from` e `to` e sem desfecho —
 * a janela "próximos N dias" da rotina, notificações, painel e prioridades.
 */
export async function upcomingRenewals(from: Date, to: Date, clientIds?: string[] | null) {
  return prisma.client.findMany({
    where: {
      expectedRenewalAt: { gte: from, lte: to },
      status: { in: [...PORTFOLIO_ACTIVE_STATUSES] as any },
      ...(clientIds ? { id: { in: clientIds } } : {}),
    },
    orderBy: { expectedRenewalAt: "asc" },
    select: LEDGER_CLIENT_SELECT,
  });
}
