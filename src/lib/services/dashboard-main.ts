import { computeOperationalMargin } from "@/lib/financial/calculations";
import { clientActiveInMonth } from "@/lib/client-status";
import { BILLING_OPEN_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { ownerCached } from "@/lib/owner-cache";
import type { Period } from "@/lib/period";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { MONTHS_PT_SHORT, formatBRL, toNumber as n } from "@/lib/format";
import { resolveOwnerId, runWithOwner } from "@/lib/auth/owner-scope";
import {
  getPeriodRevenue,
  getReceiptsSummary,
} from "./revenue-metrics";
import { getFinanceSummary } from "./finance-metrics";
import type { YearMonth } from "@/lib/renewal-expectation";

/**
 * CAMADA CENTRAL DO DASHBOARD (redesign Parte 1).
 *
 * Reúne as 5 métricas principais do mês + composições + comparativo com o mês
 * anterior + séries anuais dos 3 gráficos principais. Tudo aqui respeita o
 * período filtrado e as regras MRR/TCV/Receita Extra do dicionário:
 *
 *  - Faturamento total = MRR previsto + TCV previsto + Receita Extra manual
 *    (TCV entra CHEIO no mês da adesão/renovação, NUNCA rateado).
 *  - Recebido = totalRevenue do dicionário (a MESMA conta do "Recebido no
 *    mês" da Gestão do Mês): pagamentos da competência + RECUPERAÇÕES de
 *    meses anteriores recebidas no mês + Receita Extra manual/avulsas.
 *  - Em aberto = max(0, Faturamento total − (Recebido − Recuperado)): fica na
 *    base de COMPETÊNCIA — recuperação de mês anterior não abate o aberto do
 *    mês atual (coerente com Recebimentos e Rotina).
 *  - Vencido ⊂ Em aberto (parte já vencida).
 *  - Resultado = Recebido − Total de despesas.  Margem = Resultado / Recebido.
 *
 * Nenhum componente recalcula: importam destas funções.
 */


// ===================================================================
// 5 métricas principais + comparativo com o mês anterior
// ===================================================================

export type DashboardMainMetrics = {
  faturamentoTotal: number; // MRR + TCV + avulsas + Receita Extra manual
  avulso: number; // cobranças avulsas da competência (upsell, setup, pontual)
  mrr: number;
  tcv: number;
  extraManual: number;
  despesas: number;
  recebido: number;
  /** Recuperações: cobranças de competências ANTERIORES pagas neste mês (⊂ recebido). */
  recuperado: number;
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
  // RECEBIDO EM CAIXA = a MESMA conta do "Recebido no mês" da Gestão do Mês
  // (totalRevenue do dicionário): competência certa + RECUPERAÇÕES de meses
  // anteriores recebidas agora + extras/avulsas. Antes o card excluía as
  // recuperações e discordava da outra tela — §5.5 proíbe exatamente isso.
  const recuperado = receipts.extraRevenueAutomatic;
  const recebido = receipts.totalRevenue;
  const despesas = finance.despesas;
  // EM ABERTO continua na base de COMPETÊNCIA: recuperação de julho recebida
  // em agosto não abate o que agosto ainda tem a receber.
  // Adiantamento conta no Recebido do mês em que foi PAGO (decisão do dono,
  // 25/09/2026); o Em aberto é da COMPETÊNCIA — tira o adiantamento que é de
  // outro mês e soma o que já entrou antes para este mês.
  const emAberto = Math.max(
    0,
    faturamentoTotal - (recebido - recuperado - receipts.advanceOutValue + receipts.advanceInValue)
  );
  const resultado = recebido - despesas;

  return {
    faturamentoTotal,
    avulso: revenue.avulso,
    mrr: revenue.mrr,
    tcv: revenue.tcv,
    extraManual,
    despesas,
    recebido,
    recuperado,
    mrrRecebido: receipts.mrrReceived,
    tcvRecebido: receipts.tcvReceived,
    emAberto,
    vencido: receipts.overdueOpenAmount,
    resultado,
    margem: computeOperationalMargin(resultado, recebido),
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
// Usa o helper ÚNICO de cache por dono (03 §4: nunca duplicar helper). Ele
// resolve o ownerId fora do callback e sabe rodar sem cache fora de uma
// request (scripts de conferência e testes).
export const getDashboardMainMetrics = ownerCached(
  "dashboard-main-metrics",
  (period: Period) => getDashboardMainMetricsImpl(period),
  { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] }
);

// ===================================================================
// Séries ANUAIS (12 meses do ano selecionado) — 3 gráficos principais
// ===================================================================

export type YearlySeries = {
  year: number;
  labels: string[]; // Jan..Dez
  faturamento: number[]; // total previsto por mês (MRR+TCV+extra)
  despesas: number[]; // total de despesas por mês
  /** recebido em caixa: tudo o que foi PAGO no mês (no prazo, adiantado ou atrasado) + extras */
  recebido: number[];
  /** recuperações de competências anteriores, no mês do RECEBIMENTO (⊂ recebido) */
  recuperado: number[];
  /** adiantamentos pagos no mês para competências futuras (⊂ recebido) */
  adiantadoSaida: number[];
  /** adiantamentos pagos ANTES para a competência do mês (fora do recebido dele) */
  adiantadoEntrada: number[];
  resultado: number[]; // recebido − despesas por mês
};

const MONTHS_SHORT = [...MONTHS_PT_SHORT];

/**
 * 12 pontos (Jan–Dez) do ano selecionado para os gráficos de Faturamento,
 * Despesas e Resultado. Uma passada de dados por fonte, bucketizada por mês.
 */
async function getYearlySeriesImpl(year: number): Promise<YearlySeries> {
  const yStart = new Date(year, 0, 1);
  const yEnd = new Date(year + 1, 0, 1);
  const now = new Date();

  const [mrrClients, tcvBillings, extraRevenues, looseIncomes, payments, expenses, adiantadosAntes] =
    await Promise.all([
      prisma.client.findMany({
        where: { modality: "MRR" },
        select: { monthlyValue: true, startedAt: true, churnedAt: true, status: true, createdAt: true },
      }),
      // TCV e AVULSAS (tudo que não é MRR) por competência — a mesma base do
      // card Faturamento total, para a série anual não divergir dele.
      prisma.billing.findMany({
        where: { revenueType: { not: "MRR" }, status: { not: "CANCELED" }, competenceYear: year },
        select: { amount: true, competenceMonth: true },
      }),
      prisma.extraRevenue.findMany({
        // Pela COMPETÊNCIA informada no cadastro; legado sem competência cai
        // no mês do recebimento.
        where: {
          origin: "MANUAL",
          OR: [
            { competenceYear: year },
            { competenceYear: null, receivedAt: { gte: yStart, lt: yEnd } },
          ],
        },
        select: { amount: true, receivedAt: true, competenceMonth: true },
      }),
      prisma.income.findMany({
        where: { status: "RECEIVED", billingId: null, receivedAt: { gte: yStart, lt: yEnd } },
        select: { amount: true, receivedAt: true },
      }),
      prisma.payment.findMany({
        // Tudo o que foi PAGO dentro do ano — cada pagamento conta no mês em
        // que entrou (decisão do dono, 25/09/2026). É a regra do card
        // "Recebido em caixa": série e card não podem divergir.
        where: {
          status: "CONFIRMED",
          paidAt: { gte: yStart, lt: yEnd },
          billing: { status: { not: "CANCELED" } },
        },
        select: {
          amount: true,
          paidAt: true,
          billing: { select: { amount: true, competenceMonth: true, competenceYear: true } },
          // Como no card: conta só o que foi APLICADO em cobranças; o
          // excedente não aplicado é crédito do cliente.
          applications: {
            select: {
              amount: true,
              billing: { select: { status: true, competenceMonth: true, competenceYear: true } },
            },
          },
        },
      }),
      prisma.transaction.findMany({
        where: { type: "despesa", status: { not: "cancelado" }, date: { gte: yStart, lt: yEnd } },
        select: { amount: true, date: true },
      }),
      // Pago no ano anterior para competências deste ano (ex.: dezembro
      // adiantando janeiro) — entra no "Em aberto" de janeiro como já pago.
      prisma.paymentApplication.findMany({
        where: {
          payment: { status: "CONFIRMED", paidAt: { lt: yStart } },
          billing: { status: { not: "CANCELED" }, competenceYear: year },
        },
        select: { amount: true, billing: { select: { competenceMonth: true } } },
      }),
    ]);

  const zero = () => Array(12).fill(0) as number[];
  const mrr = zero();
  const tcv = zero();
  const extra = zero();
  const recebido = zero();
  const recuperado = zero();
  const adiantadoSaida = zero();
  const adiantadoEntrada = zero();
  const despesas = zero();

  // MRR previsto por mês: cliente MRR ativo naquele mês (regra única).
  const activeInMonth = (c: (typeof mrrClients)[number], m: number) =>
    clientActiveInMonth(c, year, m + 1, now);
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

  // Receita Extra manual entra no mês da COMPETÊNCIA informada; avulsas
  // (Income) seguem pelo mês de recebimento.
  for (const e of extraRevenues)
    extra[(e.competenceMonth ?? e.receivedAt.getMonth() + 1) - 1] += n(e.amount);
  for (const i of looseIncomes) extra[i.receivedAt.getMonth()] += n(i.amount);

  // Recebido: TODO pagamento entra no mês em que foi PAGO — no prazo,
  // adiantado (competência futura) ou em atraso. Decisão do dono em
  // 25/09/2026, a mesma regra do card "Recebido em caixa" (getReceiptsSummary).
  // Pago depois da competência também é RECUPERAÇÃO (marcada à parte, porque
  // o "Em aberto" do mês não é abatido por ela). paidAt é data civil: mês
  // pelas partes UTC.
  for (const p of payments) {
    const mes = p.paidAt.getUTCMonth();
    const paidKey = p.paidAt.getUTCFullYear() * 12 + mes;
    const aplicadas = p.applications.filter((a) => a.billing.status !== "CANCELED");
    const parcelas =
      p.applications.length > 0
        ? aplicadas.map((a) => ({ v: n(a.amount), b: a.billing }))
        : [{ v: Math.min(n(p.amount), n(p.billing.amount)), b: p.billing }];
    for (const { v, b } of parcelas) {
      if (v <= 0) continue;
      recebido[mes] += v;
      const compKey = b.competenceYear * 12 + (b.competenceMonth - 1);
      if (paidKey > compKey) recuperado[mes] += v;
      if (paidKey < compKey) {
        adiantadoSaida[mes] += v;
        if (b.competenceYear === year) adiantadoEntrada[b.competenceMonth - 1] += v;
      }
    }
  }
  for (const a of adiantadosAntes) adiantadoEntrada[a.billing.competenceMonth - 1] += n(a.amount);
  // Receita Extra também é recebimento.
  for (let m = 0; m < 12; m++) recebido[m] += extra[m];

  // Despesas por mês (data da transação).
  for (const t of expenses) despesas[t.date.getMonth()] += n(t.amount);

  const faturamento = mrr.map((v, i) => v + tcv[i] + extra[i]);
  const resultado = recebido.map((r, i) => r - despesas[i]);

  return {
    year, labels: MONTHS_SHORT, faturamento, despesas, recebido, recuperado,
    adiantadoSaida, adiantadoEntrada, resultado,
  };
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
async function getOpenByClientImpl(period: Period): Promise<ClientOpenItem[]> {
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
async function getReceivedDetailImpl(period: Period): Promise<ReceivedItem[]> {
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
async function getExpensesDetailImpl(period: Period): Promise<ExpenseItem[]> {
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
async function getExpensesByCategoryImpl(period: Period): Promise<ExpenseCategorySlice[]> {
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
  const brl = formatBRL;
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

export type NamedValue = {
  id?: string;
  name: string;
  sub?: string;
  value: number;
  /** Modalidade (MRR | TCV), quando a lista é de clientes. */
  modality?: string | null;
};


/**
 * Competências (ano/mês 1-12) que o período cobre — MESMA leitura (e mesmo
 * teto de 24 meses) de getPeriodRevenue, para os detalhes somarem igual aos
 * cards.
 */
export function periodMonths(period: Pick<Period, "start" | "end">): YearMonth[] {
  const out: YearMonth[] = [];
  const cur = new Date(period.start.getFullYear(), period.start.getMonth(), 1);
  const endRef = new Date(period.end);
  endRef.setDate(endRef.getDate() - 1);
  const lastRef = new Date(endRef.getFullYear(), endRef.getMonth(), 1);
  while (cur <= lastRef && out.length < 24) {
    out.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

/**
 * Clientes MRR que compõem o faturamento recorrente do período — a MESMA
 * regra do card (clientActiveInMonth, mês a mês). `value` = Σ mensalidade
 * nos meses do período em que o cliente estava ativo; a soma da lista é o
 * MRR do card. Antes a lista lia o status de HOJE, sem período e cortada em
 * 60 — e não fechava com o card.
 */
async function getMrrClientsDetailImpl(period: Period): Promise<NamedValue[]> {
  const months = periodMonths(period);
  if (months.length === 0) return [];
  const rows = await prisma.client.findMany({
    where: { modality: "MRR" },
    select: {
      id: true, name: true, monthlyValue: true, salesOwner: true,
      startedAt: true, churnedAt: true, status: true, createdAt: true,
    },
  });
  const now = new Date();
  const out: NamedValue[] = [];
  for (const r of rows) {
    const mensal = n(r.monthlyValue);
    if (mensal <= 0) continue;
    let value = 0;
    for (const { year, month } of months) {
      if (clientActiveInMonth(r, year, month, now)) value += mensal;
    }
    if (value > 0) out.push({ id: r.id, name: r.name, sub: r.salesOwner ?? undefined, value });
  }
  return out.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "pt-BR"));
}

/** Clientes TCV com fechamento/renovação (cobrança TCV) na competência do período. */
async function getTcvClientsDetailImpl(period: Period): Promise<NamedValue[]> {
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
async function getNewClientsDetailImpl(period: Period): Promise<NamedValue[]> {
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
      // TCV: valor total do CLIENTE primeiro, depois o do contrato mais
      // recente — a mesma ordem de expectedRenewalValues.
      value:
        c.modality === "TCV"
          ? n(c.totalContractValue) > 0
            ? n(c.totalContractValue)
            : lastTcv.get(c.id) ?? 0
          : n(c.monthlyValue),
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Renovações das competências pedidas — a MESMA lista do módulo /renovacoes
 * (livro de renovações): expectativas, quem renovou e quem não renovou.
 * Recebe TODOS os meses do período filtrado (um trimestre traz as linhas
 * dos três meses); `value` é o valor ESPERADO da linha e a soma da lista é
 * "Renovações esperadas" do período. Com mais de um mês, a competência entra
 * no subtítulo.
 */
async function getRenewalClientsDetailImpl(months: YearMonth[]): Promise<NamedValue[]> {
  if (months.length === 0) return [];
  const { renewalLedger } = await import("./renewal-schedule");
  const { monthIndex, toCompetenceKey } = await import("@/lib/renewal-expectation");
  const ordenados = [...months].sort((a, b) => monthIndex(a) - monthIndex(b));
  const livro = await renewalLedger(ordenados);
  const rotulo = { pendente: "pendente", renovou: "renovou", nao_renovou: "não renovou" } as const;
  const varios = ordenados.length > 1;
  const out: NamedValue[] = [];
  for (const ym of ordenados) {
    const mes = livro.get(toCompetenceKey(ym));
    if (!mes) continue;
    const comp = `${MONTHS_PT_SHORT[ym.month - 1]}/${ym.year}`;
    for (const r of mes.rows) {
      out.push({
        id: r.clientId,
        name: r.name,
        sub: [
          varios ? comp : null,
          rotulo[r.outcome],
          r.modality === "TCV" ? "TCV · valor cheio" : r.modality ? "MRR · mensalidade" : null,
          r.salesOwner,
        ]
          .filter(Boolean)
          .join(" · "),
        value: r.expected,
        modality: r.modality,
      });
    }
  }
  return out;
}

/** Versão cacheada por (usuário, argumentos) — TTL 300s, invalidada pelas tags de mutação. */
export const getYearlySeries = ownerCached("yearly-series", getYearlySeriesImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.DASHBOARD_METRICS],
});

/** Versões cacheadas por (usuário, argumentos) — TTL 300s. */
export const getOpenByClient = ownerCached("getopenbyclient", getOpenByClientImpl, { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] });
export const getReceivedDetail = ownerCached("getreceiveddetail", getReceivedDetailImpl, { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] });
export const getExpensesDetail = ownerCached("getexpensesdetail", getExpensesDetailImpl, { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] });
export const getExpensesByCategory = ownerCached("getexpensesbycategory", getExpensesByCategoryImpl, { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] });
export const getMrrClientsDetail = ownerCached("getmrrclientsdetail", getMrrClientsDetailImpl, { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] });
export const getTcvClientsDetail = ownerCached("gettcvclientsdetail", getTcvClientsDetailImpl, { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] });
export const getNewClientsDetail = ownerCached("getnewclientsdetail", getNewClientsDetailImpl, { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] });
export const getRenewalClientsDetail = ownerCached("getrenewalclientsdetail", getRenewalClientsDetailImpl, { revalidate: 300, tags: [CACHE_TAGS.DASHBOARD_METRICS] });
