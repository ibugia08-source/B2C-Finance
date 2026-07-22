import { BILLING_OPEN_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { unstable_cache } from "next/cache";
import type { Period } from "@/lib/period";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { toNumber as n } from "@/lib/format";
import { resolveOwnerId, runWithOwner } from "@/lib/auth/owner-scope";
import {
  getPeriodRevenue,
  getReceiptsSummary,
} from "./revenue-metrics";
import { getFinanceSummary } from "./finance-metrics";

/**
 * CAMADA CENTRAL DO DASHBOARD (redesign Parte 1).
 *
 * Reúne as 5 métricas principais do mês + composições + comparativo com o mês
 * anterior + séries anuais dos 3 gráficos principais. Tudo aqui respeita o
 * período filtrado e as regras MRR/TCV/Receita Extra do dicionário:
 *
 *  - Faturamento total = MRR previsto + TCV previsto + Receita Extra manual
 *    (TCV entra CHEIO no mês da adesão/renovação, NUNCA rateado).
 *  - Recebido = recebimentos confirmados na competência do mês (mesma base do
 *    módulo Recebimentos / card Em Aberto) + Receita Extra manual recebida.
 *  - Em aberto = max(0, Faturamento total − Recebido). Como a Receita Extra
 *    entra dos dois lados, o Em aberto = previsto MRR/TCV − recebido cobranças
 *    (coerente com Recebimentos e Rotina).
 *  - Vencido ⊂ Em aberto (parte já vencida).
 *  - Resultado = Recebido − Total de despesas.  Margem = Resultado / Recebido.
 *
 * Nenhum componente recalcula: importam destas funções.
 */


// ===================================================================
// 5 métricas principais + comparativo com o mês anterior
// ===================================================================

export type DashboardMainMetrics = {
  faturamentoTotal: number; // MRR + TCV + Receita Extra manual
  mrr: number;
  tcv: number;
  extraManual: number;
  despesas: number;
  recebido: number;
  mrrRecebido: number;
  tcvRecebido: number;
  emAberto: number; // max(0, total − recebido)
  vencido: number; // ⊂ em aberto
  resultado: number; // recebido − despesas
  margem: number; // 0-1
  mrrClients: number;
  tcvClients: number;
};

/** Build metrics object from raw data */
function buildMetrics(
  revenue: Awaited<ReturnType<typeof getPeriodRevenue>>,
  receipts: Awaited<ReturnType<typeof getReceiptsSummary>>,
  finance: Awaited<ReturnType<typeof getFinanceSummary>>
): DashboardMainMetrics {
  const extraManual = receipts.extraRevenueManual;
  const faturamentoTotal = revenue.total + extraManual;
  const recebido = receipts.receiptsCorrectMonth + extraManual;
  const despesas = finance.despesas;
  const emAberto = Math.max(0, faturamentoTotal - recebido);
  const resultado = recebido - despesas;

  return {
    faturamentoTotal,
    mrr: revenue.mrr,
    tcv: revenue.tcv,
    extraManual,
    despesas,
    recebido,
    mrrRecebido: receipts.mrrReceived,
    tcvRecebido: receipts.tcvReceived,
    emAberto,
    vencido: receipts.overdueOpenAmount,
    resultado,
    margem: recebido > 0 ? resultado / recebido : 0,
    mrrClients: revenue.mrrClients,
    tcvClients: revenue.tcvClients,
  };
}

/** Fetch both current and previous period snapshots in parallel for better pool utilization */
async function dualPeriodSnapshot(
  currentStart: Date,
  currentEnd: Date,
  prevStart: Date,
  prevEnd: Date
): Promise<[DashboardMainMetrics, DashboardMainMetrics]> {
  // Fetch both periods in parallel instead of sequentially
  const [
    [currRevenue, currReceipts, currFinance],
    [prevRevenue, prevReceipts, prevFinance],
  ] = await Promise.all([
    Promise.all([
      getPeriodRevenue(currentStart, currentEnd),
      getReceiptsSummary(currentStart, currentEnd),
      getFinanceSummary({ key: "custom", start: currentStart, end: currentEnd, label: "" } as Period),
    ]),
    Promise.all([
      getPeriodRevenue(prevStart, prevEnd),
      getReceiptsSummary(prevStart, prevEnd),
      getFinanceSummary({ key: "custom", start: prevStart, end: prevEnd, label: "" } as Period),
    ]),
  ]);

  return [
    buildMetrics(currRevenue, currReceipts, currFinance),
    buildMetrics(prevRevenue, prevReceipts, prevFinance),
  ];
}

/**
 * Período imediatamente anterior ao filtrado. Para um mês-calendário cheio
 * (1º ao 1º do próximo), devolve o mês-calendário anterior; para um intervalo
 * livre, devolve a janela de mesmo tamanho terminando no início do período.
 */
export function previousPeriodRange(period: Period): { start: Date; end: Date } {
  const { start, end } = period;
  const isFullMonth =
    start.getDate() === 1 &&
    end.getDate() === 1 &&
    (end.getMonth() + end.getFullYear() * 12) - (start.getMonth() + start.getFullYear() * 12) === 1;
  if (isFullMonth) {
    return {
      start: new Date(start.getFullYear(), start.getMonth() - 1, 1),
      end: new Date(start.getFullYear(), start.getMonth(), 1),
    };
  }
  const len = end.getTime() - start.getTime();
  return { start: new Date(start.getTime() - len), end: new Date(start.getTime()) };
}

export type MetricDelta = {
  /** variação relativa (-1..∞) ou null quando não há base de comparação */
  pct: number | null;
  /** true se o mês anterior tinha algum dado (para distinguir 0 de "sem dados") */
  hasBase: boolean;
  current: number;
  previous: number;
};

function delta(current: number, previous: number, hadData: boolean): MetricDelta {
  const hasBase = hadData && previous !== 0;
  return {
    pct: hasBase ? (current - previous) / Math.abs(previous) : null,
    hasBase,
    current,
    previous,
  };
}

export type DashboardMainResult = {
  current: DashboardMainMetrics;
  previous: DashboardMainMetrics;
  /** o mês anterior tinha QUALQUER movimento (define "sem dados") */
  previousHasData: boolean;
  deltas: {
    faturamentoTotal: MetricDelta;
    despesas: MetricDelta;
    recebido: MetricDelta;
    emAberto: MetricDelta;
    resultado: MetricDelta;
  };
};

async function getDashboardMainMetricsImpl(period: Period): Promise<DashboardMainResult> {
  const prevRange = previousPeriodRange(period);
  // Busca ambos os períodos em paralelo: reduz de 2×periodSnapshot sequenciais para 1 batch
  // dualPeriodSnapshot internamente paraleliza as 6 queries (3 por período) mantendo o pico
  // de conexões sob controle com estrutura de Promise.all dupla
  const [current, previous] = await dualPeriodSnapshot(
    period.start, period.end,
    prevRange.start, prevRange.end
  );

  const previousHasData =
    previous.faturamentoTotal !== 0 ||
    previous.recebido !== 0 ||
    previous.despesas !== 0;

  return {
    current,
    previous,
    previousHasData,
    deltas: {
      faturamentoTotal: delta(current.faturamentoTotal, previous.faturamentoTotal, previousHasData),
      despesas: delta(current.despesas, previous.despesas, previousHasData),
      recebido: delta(current.recebido, previous.recebido, previousHasData),
      emAberto: delta(current.emAberto, previous.emAberto, previousHasData),
      resultado: delta(current.resultado, previous.resultado, previousHasData),
    },
  };
}

/**
 * Cache de 5 min. O ownerId é resolvido FORA do callback cacheado (dentro
 * dele, cookies() lança erro → o escopo caía no fail-closed "__no_owner__"
 * e o cache servia zeros) e entra como argumento — logo, como parte da
 * chave: cada usuário tem sua própria entrada, sem vazamento entre contas.
 */
const getDashboardMainMetricsCached = unstable_cache(
  (ownerId: string | null, period: Period) =>
    runWithOwner(ownerId, () => getDashboardMainMetricsImpl(period)),
  ["dashboard-main-metrics"],
  { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] }
);

export async function getDashboardMainMetrics(period: Period): Promise<DashboardMainResult> {
  const ownerId = await resolveOwnerId();
  return getDashboardMainMetricsCached(ownerId, period);
}

// ===================================================================
// Séries ANUAIS (12 meses do ano selecionado) — 3 gráficos principais
// ===================================================================

export type YearlySeries = {
  year: number;
  labels: string[]; // Jan..Dez
  faturamento: number[]; // total previsto por mês (MRR+TCV+extra)
  despesas: number[]; // total de despesas por mês
  recebido: number[]; // recebido por competência do mês
  resultado: number[]; // recebido − despesas por mês
};

const MONTHS_SHORT = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/**
 * 12 pontos (Jan–Dez) do ano selecionado para os gráficos de Faturamento,
 * Despesas e Resultado. Uma passada de dados por fonte, bucketizada por mês.
 */
export async function getYearlySeries(year: number): Promise<YearlySeries> {
  const yStart = new Date(year, 0, 1);
  const yEnd = new Date(year + 1, 0, 1);
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + now.getMonth();

  const [mrrClients, tcvBillings, extraRevenues, looseIncomes, payments, expenses] =
    await Promise.all([
      prisma.client.findMany({
        where: { modality: "MRR" },
        select: { monthlyValue: true, startedAt: true, churnedAt: true, status: true, createdAt: true },
      }),
      prisma.billing.findMany({
        where: { revenueType: "TCV", status: { not: "CANCELED" }, competenceYear: year },
        select: { amount: true, competenceMonth: true },
      }),
      prisma.extraRevenue.findMany({
        where: { origin: "MANUAL", receivedAt: { gte: yStart, lt: yEnd } },
        select: { amount: true, receivedAt: true },
      }),
      prisma.income.findMany({
        where: { status: "RECEIVED", billingId: null, receivedAt: { gte: yStart, lt: yEnd } },
        select: { amount: true, receivedAt: true },
      }),
      prisma.payment.findMany({
        // Só pagamentos de cobranças cuja COMPETÊNCIA é do ano selecionado —
        // bounded e suficiente (recebido é bucketizado por competência).
        where: {
          status: "CONFIRMED",
          billing: { status: { not: "CANCELED" }, competenceYear: year },
        },
        select: {
          amount: true,
          paidAt: true,
          billing: { select: { competenceMonth: true, competenceYear: true } },
        },
      }),
      prisma.transaction.findMany({
        where: { type: "despesa", status: { not: "cancelado" }, date: { gte: yStart, lt: yEnd } },
        select: { amount: true, date: true },
      }),
    ]);

  const zero = () => Array(12).fill(0) as number[];
  const mrr = zero();
  const tcv = zero();
  const extra = zero();
  const recebido = zero();
  const despesas = zero();

  // MRR previsto por mês: cliente MRR ativo naquele mês.
  const activeInMonth = (
    c: (typeof mrrClients)[number],
    m: number
  ) => {
    const monthStart = new Date(year, m, 1);
    const monthEnd = new Date(year, m + 1, 1);
    const entered = c.startedAt ?? c.createdAt;
    if (entered && entered >= monthEnd) return false;
    if (c.churnedAt && c.churnedAt < monthStart) return false;
    const key = year * 12 + m;
    const REVENUE_ACTIVE = ["ACTIVE", "RENEWAL", "DELINQUENT"];
    if (key >= currentKey && !REVENUE_ACTIVE.includes(c.status)) return false;
    return true;
  };
  for (let m = 0; m < 12; m++) {
    for (const c of mrrClients) {
      if (activeInMonth(c, m)) mrr[m] += n(c.monthlyValue);
    }
  }

  // TCV previsto por competência do mês (valor cheio, sem rateio).
  for (const b of tcvBillings) {
    const i = b.competenceMonth - 1;
    if (i >= 0 && i < 12) tcv[i] += n(b.amount);
  }

  // Receita Extra manual + receitas avulsas por mês de recebimento.
  for (const e of extraRevenues) extra[e.receivedAt.getMonth()] += n(e.amount);
  for (const i of looseIncomes) extra[i.receivedAt.getMonth()] += n(i.amount);

  // Recebido por competência (pago on-time ou adiantado; atrasado não conta no
  // mês original — vira recuperação, fora da série de faturamento do mês).
  for (const p of payments) {
    const compKey = p.billing.competenceYear * 12 + (p.billing.competenceMonth - 1);
    const paidKey = p.paidAt.getFullYear() * 12 + p.paidAt.getMonth();
    if (p.billing.competenceYear === year && paidKey <= compKey) {
      recebido[p.billing.competenceMonth - 1] += n(p.amount);
    }
  }
  // Receita Extra também é recebimento.
  for (let m = 0; m < 12; m++) recebido[m] += extra[m];

  // Despesas por mês (data da transação).
  for (const t of expenses) despesas[t.date.getMonth()] += n(t.amount);

  const faturamento = mrr.map((v, i) => v + tcv[i] + extra[i]);
  const resultado = recebido.map((r, i) => r - despesas[i]);

  return { year, labels: MONTHS_SHORT, faturamento, despesas, recebido, resultado };
}

// ===================================================================
// Composição do faturamento e maiores despesas (detalhe dos cards)
// ===================================================================

export type ClientOpenItem = {
  clientId: string;
  clientName: string;
  salesOwner: string | null;
  open: number;
  dueDate: Date | null;
  overdue: boolean;
};

/** Clientes com valor em aberto na competência do período (para o card Em Aberto). */
export async function getOpenByClient(period: Period): Promise<ClientOpenItem[]> {
  const { start, end } = period;
  // Competências (ano/mês) que o período cobre.
  const months: { y: number; m: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endRef = new Date(end);
  endRef.setDate(endRef.getDate() - 1);
  const lastRef = new Date(endRef.getFullYear(), endRef.getMonth(), 1);
  while (cur <= lastRef && months.length < 24) {
    months.push({ y: cur.getFullYear(), m: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  if (months.length === 0) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const billings = await prisma.billing.findMany({
    where: {
      status: { in: [...BILLING_OPEN_STATUSES] },
      OR: months.map(({ y, m }) => ({ competenceYear: y, competenceMonth: m })),
    },
    select: {
      amount: true,
      paidTotal: true,
      dueDate: true,
      clientId: true,
      client: { select: { name: true, salesOwner: true } },
    },
  });

  const byClient = new Map<string, ClientOpenItem>();
  for (const b of billings) {
    const open = n(b.amount) - n(b.paidTotal);
    if (open <= 0) continue;
    const cur = byClient.get(b.clientId) ?? {
      clientId: b.clientId,
      clientName: b.client.name,
      salesOwner: b.client.salesOwner,
      open: 0,
      dueDate: b.dueDate,
      overdue: false,
    };
    cur.open += open;
    // guarda o vencimento mais antigo e marca se algum já venceu
    if (!cur.dueDate || (b.dueDate && b.dueDate < cur.dueDate)) cur.dueDate = b.dueDate;
    if (b.dueDate && b.dueDate < today) cur.overdue = true;
    byClient.set(b.clientId, cur);
  }

  return Array.from(byClient.values()).sort((a, b) => b.open - a.open);
}

export type ReceivedItem = {
  clientName: string;
  amount: number;
  revenueType: string | null;
  paidAt: Date;
};

/** Recebimentos confirmados do período (para o card Recebido). */
export async function getReceivedDetail(period: Period): Promise<ReceivedItem[]> {
  const { start, end } = period;
  const payments = await prisma.payment.findMany({
    where: { status: "CONFIRMED", paidAt: { gte: start, lt: end }, billing: { status: { not: "CANCELED" } } },
    orderBy: { paidAt: "desc" },
    take: 60,
    select: {
      amount: true,
      paidAt: true,
      billing: { select: { revenueType: true, client: { select: { name: true } } } },
    },
  });
  return payments.map((p) => ({
    clientName: p.billing.client.name,
    amount: n(p.amount),
    revenueType: p.billing.revenueType,
    paidAt: p.paidAt,
  }));
}

export type ExpenseItem = { description: string; amount: number; category: string | null; dueDate: Date | null };

/** Maiores despesas do período (para o card Total de despesas). */
export async function getExpensesDetail(period: Period): Promise<ExpenseItem[]> {
  const { start, end } = period;
  const rows = await prisma.transaction.findMany({
    where: { type: "despesa", status: { not: "cancelado" }, date: { gte: start, lt: end } },
    orderBy: { amount: "desc" },
    take: 40,
    select: {
      description: true,
      amount: true,
      dueDate: true,
      category: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    description: r.description,
    amount: n(r.amount),
    category: r.category?.name ?? null,
    dueDate: r.dueDate,
  }));
}

export type ExpenseCategorySlice = { label: string; value: number };

/** Despesas agrupadas por categoria no período (para o detalhe de despesas). */
export async function getExpensesByCategory(period: Period): Promise<ExpenseCategorySlice[]> {
  const { start, end } = period;
  const grouped = await prisma.transaction.groupBy({
    by: ["categoryId"],
    where: { type: "despesa", status: { not: "cancelado" }, date: { gte: start, lt: end } },
    _sum: { amount: true },
  });
  const ids = grouped.map((g) => g.categoryId).filter(Boolean) as string[];
  const cats = ids.length
    ? await prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const name = new Map(cats.map((c) => [c.id, c.name]));
  return grouped
    .map((g) => ({
      label: g.categoryId ? name.get(g.categoryId) ?? "—" : "Sem categoria",
      value: n(g._sum.amount),
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

// ===================================================================
// Caixa: quanto do resultado do mês já foi lançado
// ===================================================================

// ===================================================================
// Comparativo com mês anterior (helper público) — §19
// ===================================================================

/**
 * Compara um valor com o do mês anterior. `metricType` só documenta a intenção;
 * a direção "boa/ruim" é decidida na UI (goodWhenUp). Evita divisão por zero e
 * distingue 0 real de "sem dados".
 */
export function getPreviousMonthComparison(
  current: number,
  previous: number,
  hadData: boolean
): MetricDelta {
  return delta(current, previous, hadData);
}

// ===================================================================
// Resumo inteligente do mês (determinístico) — §21
// ===================================================================

export type SummaryInput = {
  previsto: number;
  recebido: number;
  emAberto: number;
  vencido: number;
  despesas: number;
  resultado: number;
  margem: number; // 0-1
  folhaPct: number; // 0-100
  recorrenciaPct: number; // 0-100
};

/**
 * Texto determinístico (sem IA) interpretando os números reais do mês.
 * Frases curtas, linguagem simples, sempre com base nos dados do período.
 */
export function buildDashboardSummary(i: SummaryInput): string[] {
  const brl = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const out: string[] = [];

  if (i.previsto <= 0 && i.recebido <= 0 && i.despesas <= 0) {
    return ["Ainda não há movimentação financeira registrada neste mês."];
  }

  out.push(
    `Você recebeu ${brl(i.recebido)} de um faturamento previsto de ${brl(i.previsto)}.`
  );
  if (i.emAberto > 0) {
    out.push(
      i.vencido > 0
        ? `Ainda existem ${brl(i.emAberto)} em aberto, sendo ${brl(i.vencido)} já vencidos.`
        : `Ainda existem ${brl(i.emAberto)} em aberto, todos dentro do prazo.`
    );
  } else {
    out.push("Todo o faturamento previsto do mês já foi recebido.");
  }
  if (i.recebido > 0) {
    out.push(`As despesas representam ${Math.round((i.despesas / i.recebido) * 100)}% do valor recebido.`);
  }
  out.push(
    i.resultado >= 0
      ? `O resultado atual é positivo em ${brl(i.resultado)} (margem de ${Math.round(i.margem * 100)}%).`
      : `O resultado atual está negativo em ${brl(i.resultado)} — as despesas superaram o recebido.`
  );
  if (i.recorrenciaPct > 0) {
    out.push(
      `${i.recorrenciaPct}% do faturamento vem de MRR — ${
        i.recorrenciaPct >= 60 ? "receita bem previsível" : "há espaço para aumentar a recorrência"
      }.`
    );
  }
  return out;
}

// ===================================================================
// Detalhes internos dos cards secundários — §11
// ===================================================================

export type NamedValue = { id?: string; name: string; sub?: string; value: number };

const REVENUE_ACTIVE_STATUSES = ["ACTIVE", "RENEWAL", "DELINQUENT"];

/** Clientes MRR que compõem o faturamento recorrente do período. */
export async function getMrrClientsDetail(): Promise<NamedValue[]> {
  const rows = await prisma.client.findMany({
    where: { modality: "MRR", status: { in: REVENUE_ACTIVE_STATUSES as any } },
    select: { id: true, name: true, monthlyValue: true, salesOwner: true },
    orderBy: { monthlyValue: "desc" },
    take: 60,
  });
  return rows
    .map((r) => ({ id: r.id, name: r.name, sub: r.salesOwner ?? undefined, value: n(r.monthlyValue) }))
    .filter((r) => r.value > 0);
}

/** Clientes TCV com fechamento/renovação (cobrança TCV) na competência do período. */
export async function getTcvClientsDetail(period: Period): Promise<NamedValue[]> {
  const { start, end } = period;
  const months: { y: number; m: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endRef = new Date(end); endRef.setDate(endRef.getDate() - 1);
  const lastRef = new Date(endRef.getFullYear(), endRef.getMonth(), 1);
  while (cur <= lastRef && months.length < 24) {
    months.push({ y: cur.getFullYear(), m: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  if (months.length === 0) return [];
  const billings = await prisma.billing.findMany({
    where: {
      revenueType: "TCV",
      status: { not: "CANCELED" },
      OR: months.map(({ y, m }) => ({ competenceYear: y, competenceMonth: m })),
    },
    select: { amount: true, clientId: true, client: { select: { name: true } } },
  });
  const byClient = new Map<string, NamedValue>();
  for (const b of billings) {
    const cur = byClient.get(b.clientId) ?? { id: b.clientId, name: b.client.name, value: 0 };
    cur.value += n(b.amount);
    byClient.set(b.clientId, cur);
  }
  return Array.from(byClient.values()).sort((a, b) => b.value - a.value);
}

/** Novos clientes do período com a receita (MRR mensal / TCV total do contrato). */
export async function getNewClientsDetail(period: Period): Promise<NamedValue[]> {
  const { start, end } = period;
  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { startedAt: { gte: start, lt: end } },
        { startedAt: null, createdAt: { gte: start, lt: end } },
      ],
    },
    select: { id: true, name: true, modality: true, monthlyValue: true, totalContractValue: true },
  });
  const tcvIds = clients.filter((c) => c.modality === "TCV").map((c) => c.id);
  const contracts = tcvIds.length
    ? await prisma.contract.findMany({
        where: { clientId: { in: tcvIds } },
        orderBy: { startDate: "desc" },
        select: { clientId: true, totalValue: true },
      })
    : [];
  const lastTcv = new Map<string, number>();
  for (const c of contracts) if (!lastTcv.has(c.clientId)) lastTcv.set(c.clientId, n(c.totalValue));
  return clients
    .map((c) => ({
      id: c.id,
      name: c.name,
      sub: c.modality ?? undefined,
      value:
        c.modality === "TCV"
          ? lastTcv.get(c.id) ?? n(c.totalContractValue) ?? n(c.monthlyValue)
          : n(c.monthlyValue),
    }))
    .sort((a, b) => b.value - a.value);
}

/** Clientes com renovação no mês selecionado (mês-calendário). */
export async function getRenewalClientsDetail(month: number): Promise<NamedValue[]> {
  const rows = await prisma.client.findMany({
    where: {
      renewalMonth: month,
      status: { notIn: ["CHURNED", "INACTIVE", "PROSPECT", "LEAD"] },
    },
    select: { id: true, name: true, modality: true, monthlyValue: true, totalContractValue: true, salesOwner: true },
    orderBy: { name: "asc" },
    take: 60,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sub: r.salesOwner ?? r.modality ?? undefined,
    value: r.modality === "TCV" ? n(r.totalContractValue) : n(r.monthlyValue),
  }));
}

/** Marcador estável na descrição do movimento para rastrear o mês de origem. */
export function resultLaunchTag(year: number, month: number): string {
  return `[resultado:${year}-${String(month).padStart(2, "0")}]`;
}

/** Total já lançado ao caixa como "Resultado do mês" para a competência. */
export async function getResultLaunchedForMonth(year: number, month: number): Promise<number> {
  const agg = await prisma.cashBoxMovement.aggregate({
    where: { type: "IN", description: { contains: resultLaunchTag(year, month) } },
    _sum: { amount: true },
  });
  return n(agg._sum.amount);
}
