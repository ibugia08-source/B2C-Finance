import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/period";
import { formatBRL, formatDateBR } from "@/lib/format";
import {
  getFinanceSummary,
  getCashSummary,
  type FinanceSummary,
  type CashSummary,
} from "./finance-metrics";
import { getDelinquentClients } from "./billing-metrics";
import {
  getPeriodRevenue,
  getReceiptsSummary,
  getRenewalOutlook,
  getLossSummary,
  type PeriodRevenue,
  type ReceiptsSummary,
  type RenewalWindow,
  type LossSummary,
  type RevenueFilters,
} from "./revenue-metrics";
import { getUpsellKpis, type UpsellKpis } from "./upsell-metrics";
import { getExpenseSummary, type ExpenseSummary } from "./expense-metrics";
import { getMonthDelinquencies } from "./client-metrics";

/**
 * Dashboard executivo — agrega os services de métricas existentes
 * (finance/billing/contract-metrics) sob um conjunto único de filtros.
 *
 * Semântica dos filtros de entidade (cliente/serviço/tipos):
 *  - aplicam-se ao bloco comercial (faturamento, pendente, vencido, séries e
 *    rankings), que é por natureza ligado a cliente/serviço;
 *  - caixa e patrimônio são globais da agência (uma conta bancária não
 *    "pertence" a um cliente) e não são filtrados por entidade — apenas
 *    pelo período.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v));

export type DashboardFilters = {
  period: Period;
  clientId?: string;
  serviceId?: string;
  billingStatus?: string; // BillingStatus
  revenueType?: string; // RevenueType
  expenseType?: string; // ExpenseType
  // ===== Faturamento MRR/TCV (PARTE 2) =====
  modality?: string; // ClientModality — MRR | TCV
  salesOwner?: string; // responsável
  segment?: string; // segmento do cliente
  clientStatus?: string; // status do cliente
};

/** Filtro de entidade aplicável a Billing. */
function billingWhere(f: DashboardFilters): Record<string, unknown> {
  const w: Record<string, unknown> = {};
  if (f.clientId) w.clientId = f.clientId;
  if (f.serviceId) w.serviceId = f.serviceId;
  if (f.revenueType) w.revenueType = f.revenueType;
  return w;
}

/** Filtro para despesas (Transaction type=despesa). */
function expenseWhere(f: DashboardFilters): Record<string, unknown> {
  const w: Record<string, unknown> = {
    type: "despesa",
    status: { not: "cancelado" },
  };
  if (f.clientId) w.clientId = f.clientId;
  if (f.serviceId) w.serviceId = f.serviceId;
  if (f.expenseType) w.expenseType = f.expenseType;
  return w;
}

/** Receitas avulsas (Income sem cobrança vinculada — dinheiro fora do fluxo de Billing). */
function looseIncomeWhere(f: DashboardFilters): Record<string, unknown> {
  const w: Record<string, unknown> = { status: "RECEIVED", billingId: null };
  if (f.clientId) w.clientId = f.clientId;
  if (f.revenueType) w.revenueType = f.revenueType;
  return w;
}

/** Relaciona Payment → Billing quando há filtro de entidade. */
function paymentBillingFilter(f: DashboardFilters): Record<string, unknown> {
  const bw = billingWhere(f);
  return Object.keys(bw).length > 0 ? { billing: bw } : {};
}

// ===================================================================
// KPIs comerciais
// ===================================================================

export type CommercialKpis = {
  faturamentoEsperado: number; // cobranças com vencimento no período
  faturamentoRecebido: number; // pagamentos confirmados no período
  receitaPendente: number; // em aberto dentro do prazo (PENDING/PARTIAL)
  receitaVencida: number; // em aberto vencido (OVERDUE)
  inadimplenciaTaxa: number; // vencido / total em aberto (0-1)
  mrrAtivo: number;
  tcvVendido: number; // contratos iniciados no período
  novosClientes: number;
  clientesAtivos: number;
  clientesInadimplentes: number;
  contratosEmRenovacao: number; // próximos 30 dias
};

export async function getCommercialKpis(f: DashboardFilters): Promise<CommercialKpis> {
  const { start, end } = f.period;
  const bw = billingWhere(f);
  const today = new Date();
  const renewLimit = new Date();
  renewLimit.setDate(renewLimit.getDate() + 30);

  const contractClientWhere = f.clientId ? { clientId: f.clientId } : {};

  const [esperado, recebido, pendente, vencido, novos, ativos, delinq, renov, mrr, tcv] =
    await Promise.all([
      prisma.billing.aggregate({
        where: {
          ...bw,
          dueDate: { gte: start, lt: end },
          status: f.billingStatus ? (f.billingStatus as any) : { not: "CANCELED" },
        },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: {
          status: "CONFIRMED",
          paidAt: { gte: start, lt: end },
          ...paymentBillingFilter(f),
        },
        _sum: { amount: true },
      }),
      prisma.billing.aggregate({
        where: { ...bw, status: { in: ["PENDING", "PARTIAL"] } },
        _sum: { amount: true, paidTotal: true },
      }),
      prisma.billing.aggregate({
        where: { ...bw, status: "OVERDUE" },
        _sum: { amount: true, paidTotal: true },
      }),
      prisma.client.count({ where: { createdAt: { gte: start, lt: end } } }),
      prisma.client.count({ where: { status: "ACTIVE" } }),
      prisma.billing.groupBy({ by: ["clientId"], where: { ...bw, status: "OVERDUE" } }),
      prisma.contract.count({
        where: {
          ...contractClientWhere,
          status: { in: ["ACTIVE", "RENEWAL"] },
          renewalDate: { not: null, lte: renewLimit },
        },
      }),
      prisma.contract.aggregate({
        where: {
          ...contractClientWhere,
          status: { in: ["ACTIVE", "RENEWAL"] },
          startDate: { lte: today },
          OR: [{ endDate: null }, { endDate: { gte: today } }],
        },
        _sum: { monthlyValue: true },
      }),
      prisma.contract.aggregate({
        where: {
          ...contractClientWhere,
          startDate: { gte: start, lt: end },
          status: { notIn: ["CANCELED"] },
        },
        _sum: { totalValue: true },
      }),
    ]);

  const openOf = (a: { _sum: { amount: any; paidTotal: any } }) =>
    n(a._sum.amount) - n(a._sum.paidTotal);

  const receitaPendente = openOf(pendente);
  const receitaVencida = openOf(vencido);
  const totalAberto = receitaPendente + receitaVencida;

  return {
    faturamentoEsperado: n(esperado._sum.amount),
    faturamentoRecebido: n(recebido._sum.amount),
    receitaPendente,
    receitaVencida,
    inadimplenciaTaxa: totalAberto > 0 ? receitaVencida / totalAberto : 0,
    mrrAtivo: n(mrr._sum.monthlyValue),
    tcvVendido: n(tcv._sum.totalValue),
    novosClientes: novos,
    clientesAtivos: ativos,
    clientesInadimplentes: delinq.length,
    contratosEmRenovacao: renov,
  };
}

// ===================================================================
// Séries mensais (últimos 12 meses)
// ===================================================================

export type MonthlySeries = {
  labels: string[]; // "jan.", "fev.", …
  receitas: number[];
  despesas: number[];
  lucro: number[]; // receitas − despesas pagas
  mrr: number[];
  inadimplencia: number[]; // vencido em aberto, por mês de vencimento
  folha: number[];
  folhaPct: number[]; // folha / receitas (0-100)
};

function lastMonths(count = 12): { y: number; m: number; label: string }[] {
  const now = new Date();
  const out: { y: number; m: number; label: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      y: d.getFullYear(),
      m: d.getMonth() + 1,
      label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
    });
  }
  return out;
}

export async function getMonthlySeries(f: DashboardFilters): Promise<MonthlySeries> {
  const months = lastMonths(12);
  const from = new Date(months[0].y, months[0].m - 1, 1);
  const clientWhere = f.clientId ? { clientId: f.clientId } : {};

  const [payments, looseIncomes, txReceitas, txDespesas, overdueBillings, contracts, payrollItems] =
    await Promise.all([
      prisma.payment.findMany({
        where: { status: "CONFIRMED", paidAt: { gte: from }, ...paymentBillingFilter(f) },
        select: { paidAt: true, amount: true },
      }),
      prisma.income.findMany({
        where: { ...looseIncomeWhere(f), receivedAt: { gte: from } },
        select: { receivedAt: true, amount: true },
      }),
      prisma.transaction.findMany({
        where: {
          type: "receita",
          status: { not: "cancelado" },
          date: { gte: from },
          ...clientWhere,
        },
        select: { date: true, amount: true },
      }),
      prisma.transaction.findMany({
        where: { ...expenseWhere(f), date: { gte: from } },
        select: { date: true, amount: true, status: true },
      }),
      prisma.billing.findMany({
        where: { ...billingWhere(f), status: "OVERDUE", dueDate: { gte: from } },
        select: { dueDate: true, amount: true, paidTotal: true },
      }),
      prisma.contract.findMany({
        // Só contratos MRR: a série "MRR do mês" nunca inclui TCV (sem rateio).
        where: { type: "MRR", status: { notIn: ["CANCELED", "PENDING"] }, ...clientWhere },
        select: { startDate: true, endDate: true, monthlyValue: true },
      }),
      prisma.payrollItem.findMany({
        where: { payroll: { status: { in: ["APPROVED", "PAID"] } } },
        select: { amount: true, kind: true, payroll: { select: { month: true, year: true } } },
      }),
    ]);

  const key = (y: number, m: number) => `${y}-${m}`;
  const idx = new Map(months.map((mo, i) => [key(mo.y, mo.m), i]));
  const zero = () => months.map(() => 0);

  const receitas = zero();
  const despesas = zero();
  const despesasPagas = zero();
  const inadimplencia = zero();
  const folha = zero();
  const mrr = zero();

  const bucket = (arr: number[], d: Date | null, amount: number) => {
    if (!d) return;
    const i = idx.get(key(d.getFullYear(), d.getMonth() + 1));
    if (i != null) arr[i] += amount;
  };

  for (const p of payments) bucket(receitas, p.paidAt, n(p.amount));
  for (const i of looseIncomes) bucket(receitas, i.receivedAt, n(i.amount));
  for (const t of txReceitas) bucket(receitas, t.date, n(t.amount));
  for (const t of txDespesas) {
    bucket(despesas, t.date, n(t.amount));
    if (t.status === "pago") bucket(despesasPagas, t.date, n(t.amount));
  }
  for (const b of overdueBillings)
    bucket(inadimplencia, b.dueDate, n(b.amount) - n(b.paidTotal));
  for (const item of payrollItems) {
    const i = idx.get(key(item.payroll.year, item.payroll.month));
    if (i != null) folha[i] += n(item.amount) * (item.kind === "DEDUCTION" ? -1 : 1);
  }

  // MRR do mês: Σ monthlyValue dos contratos MRR cuja vigência cobre o mês.
  months.forEach((mo, i) => {
    const monthStart = new Date(mo.y, mo.m - 1, 1);
    const monthEnd = new Date(mo.y, mo.m, 1);
    for (const c of contracts) {
      if (c.startDate < monthEnd && (c.endDate == null || c.endDate >= monthStart)) {
        mrr[i] += n(c.monthlyValue);
      }
    }
  });

  return {
    labels: months.map((m) => m.label),
    receitas,
    despesas,
    lucro: receitas.map((r, i) => r - despesasPagas[i]),
    mrr,
    inadimplencia,
    folha,
    folhaPct: receitas.map((r, i) => (r > 0 ? Math.round((folha[i] / r) * 100) : 0)),
  };
}

// ===================================================================
// Rankings do período (despesas por categoria, receita por serviço/cliente)
// ===================================================================

export type Slice = { label: string; value: number };

export type Breakdowns = {
  despesasPorCategoria: Slice[];
  receitaPorServico: Slice[];
  receitaPorCliente: Slice[];
};

function topSlices(map: Map<string, number>, top = 8): Slice[] {
  const all = Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  if (all.length <= top) return all;
  const head = all.slice(0, top - 1);
  const rest = all.slice(top - 1).reduce((s, x) => s + x.value, 0);
  return [...head, { label: "Outros", value: rest }];
}

export async function getBreakdowns(f: DashboardFilters): Promise<Breakdowns> {
  const { start, end } = f.period;

  const [categorias, payments, looseIncomes] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { ...expenseWhere(f), date: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      where: {
        status: "CONFIRMED",
        paidAt: { gte: start, lt: end },
        ...paymentBillingFilter(f),
      },
      select: { amount: true, billing: { select: { clientId: true, serviceId: true } } },
    }),
    prisma.income.findMany({
      where: { ...looseIncomeWhere(f), receivedAt: { gte: start, lt: end } },
      select: { amount: true, clientId: true },
    }),
  ]);

  const categoryIds = categorias.map((c) => c.categoryId).filter(Boolean) as string[];
  const categoryRows = categoryIds.length
    ? await prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true },
      })
    : [];
  const categoryName = new Map(categoryRows.map((c) => [c.id, c.name]));
  const catMap = new Map<string, number>();
  for (const c of categorias) {
    const label = c.categoryId ? categoryName.get(c.categoryId) ?? "—" : "Sem categoria";
    catMap.set(label, (catMap.get(label) ?? 0) + n(c._sum.amount));
  }

  const byService = new Map<string, number>();
  const byClient = new Map<string, number>();
  for (const p of payments) {
    const s = p.billing.serviceId ?? "__none__";
    const c = p.billing.clientId;
    byService.set(s, (byService.get(s) ?? 0) + n(p.amount));
    byClient.set(c, (byClient.get(c) ?? 0) + n(p.amount));
  }
  for (const i of looseIncomes) {
    if (i.clientId) byClient.set(i.clientId, (byClient.get(i.clientId) ?? 0) + n(i.amount));
  }

  // Resolve nomes (2 queries pequenas, só ids usados)
  const serviceIds = Array.from(byService.keys()).filter((id) => id !== "__none__");
  const clientIds = Array.from(byClient.keys());
  const [services, clients] = await Promise.all([
    serviceIds.length
      ? prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
    clientIds.length
      ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const serviceSlices = new Map<string, number>();
  byService.forEach((v, id) =>
    serviceSlices.set(id === "__none__" ? "Sem serviço vinculado" : serviceName.get(id) ?? "—", v)
  );
  const clientSlices = new Map<string, number>();
  byClient.forEach((v, id) => clientSlices.set(clientName.get(id) ?? "—", v));

  return {
    despesasPorCategoria: topSlices(catMap),
    receitaPorServico: topSlices(serviceSlices),
    receitaPorCliente: topSlices(clientSlices),
  };
}

// ===================================================================
// Saúde financeira
// ===================================================================

export type HealthLevel = "critica" | "atencao" | "estavel" | "saudavel" | "excelente";

export type Health = {
  score: number; // 0-100
  level: HealthLevel;
  label: string;
  fatores: { ok: boolean; text: string }[];
};

export function computeHealth(
  finance: FinanceSummary,
  cash: CashSummary,
  inadimplenciaTaxa: number
): Health {
  let score = 100;
  const fatores: { ok: boolean; text: string }[] = [];
  const hit = (penalty: number, text: string) => {
    score -= penalty;
    fatores.push({ ok: false, text });
  };
  const ok = (text: string) => fatores.push({ ok: true, text });

  if (cash.caixaDisponivel <= 0) hit(30, `Caixa disponível zerado ou negativo (${formatBRL(cash.caixaDisponivel)})`);
  else ok(`Caixa disponível de ${formatBRL(cash.caixaDisponivel)}`);

  if (cash.projecao30 < 0) hit(25, `Projeção de caixa negativa em 30 dias (${formatBRL(cash.projecao30)})`);
  else ok(`Projeção de 30 dias positiva (${formatBRL(cash.projecao30)})`);

  if (finance.lucro < 0) hit(20, `Prejuízo no período (${formatBRL(finance.lucro)})`);
  else ok(`Lucro de ${formatBRL(finance.lucro)} no período`);

  const inadPct = Math.round(inadimplenciaTaxa * 100);
  if (inadimplenciaTaxa > 0.25) hit(15, `Inadimplência alta: ${inadPct}% do que está em aberto já venceu`);
  else if (inadimplenciaTaxa > 0.1) hit(8, `Inadimplência em ${inadPct}% do aberto — atenção`);
  else ok(`Inadimplência controlada (${inadPct}%)`);

  const folhaPct = Math.round(finance.folhaSobreReceita * 100);
  if (finance.folhaSobreReceita > 0.5) hit(15, `Folha consome ${folhaPct}% da receita (limite saudável: 40%)`);
  else if (finance.folhaSobreReceita > 0.4) hit(10, `Folha em ${folhaPct}% da receita — acima do ideal de 40%`);
  else ok(`Folha em ${folhaPct}% da receita`);

  if (finance.receitas > 0 && finance.despesasFixas > finance.receitas * 0.6)
    hit(8, `Despesas fixas consomem ${Math.round((finance.despesasFixas / finance.receitas) * 100)}% da receita`);
  else ok("Despesas fixas sob controle");

  score = Math.max(0, Math.min(100, score));
  const level: HealthLevel =
    score >= 85 ? "excelente" : score >= 70 ? "saudavel" : score >= 50 ? "estavel" : score >= 30 ? "atencao" : "critica";
  const label =
    level === "excelente" ? "Excelente" :
    level === "saudavel" ? "Saudável" :
    level === "estavel" ? "Estável" :
    level === "atencao" ? "Atenção" : "Crítica";

  return { score, level, label, fatores };
}

// ===================================================================
// Alertas e próximas ações
// ===================================================================

export type AlertSeverity = "high" | "medium" | "low";
export type DashAlert = { severity: AlertSeverity; title: string; detail: string; href: string };
export type NextAction = { text: string; href: string };

// ===================================================================
// Orquestrador — uma chamada, dashboard inteiro
// ===================================================================

export type ClientsBlock = {
  ativos: number;
  pausados: number;
  perdidos: number; // total histórico (status CHURNED)
  mrrAtivos: number; // clientes MRR ativos
  tcvAtivos: number; // clientes TCV ativos
  devendoMes: number; // inadimplência do mês atual (efetiva, com override)
  pagosMes: number;
};

export type ExecutiveDashboard = {
  kpis: CommercialKpis;
  finance: FinanceSummary;
  cash: CashSummary;
  series: MonthlySeries;
  breakdowns: Breakdowns;
  health: Health;
  alerts: DashAlert[];
  actions: NextAction[];
  // ===== PARTE 2-4: faturamento MRR/TCV, renovações e perdas =====
  revenue: PeriodRevenue;
  renewalOutlook: RenewalWindow[]; // mês atual, +1, +2, +3
  losses: LossSummary;
  // ===== PARTE 7-9: clientes, upsell e despesas =====
  clients: ClientsBlock;
  upsell: UpsellKpis;
  expenses: ExpenseSummary;
  // ===== Fechamento mensal: Recebimentos + Receita Extra =====
  receipts: ReceiptsSummary;
};

/** Contadores de clientes do mês (com override manual de inadimplência). */
async function getClientsBlock(): Promise<ClientsBlock> {
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  const [ativos, pausados, perdidos, mrrAtivos, tcvAtivos, allClients] =
    await Promise.all([
      prisma.client.count({ where: { status: "ACTIVE" } }),
      prisma.client.count({ where: { status: "PAUSED" } }),
      prisma.client.count({ where: { status: "CHURNED" } }),
      prisma.client.count({ where: { status: "ACTIVE", modality: "MRR" } }),
      prisma.client.count({ where: { status: "ACTIVE", modality: "TCV" } }),
      prisma.client.findMany({
        where: { status: { notIn: ["CHURNED", "INACTIVE", "PROSPECT", "LEAD"] } },
        select: { id: true },
      }),
    ]);

  // Overrides manuais da competência corrente (histórico por mês —
  // ClientMonthDelinquency; mesma fonte do módulo Clientes).
  const [auto, overrides] = await Promise.all([
    getMonthDelinquencies(
      allClients.map((c) => c.id),
      curMonth,
      curYear
    ),
    prisma.clientMonthDelinquency.findMany({
      where: { year: curYear, month: curMonth },
      select: { clientId: true, status: true },
    }),
  ]);
  const overrideBy = new Map(overrides.map((o) => [o.clientId, o.status]));
  let devendoMes = 0;
  let pagosMes = 0;
  for (const c of allClients) {
    const value = overrideBy.get(c.id) ?? auto.get(c.id);
    if (value === "DEVENDO") devendoMes += 1;
    else if (value === "PAGO") pagosMes += 1;
  }

  return { ativos, pausados, perdidos, mrrAtivos, tcvAtivos, devendoMes, pagosMes };
}

export async function getExecutiveDashboard(f: DashboardFilters): Promise<ExecutiveDashboard> {
  const in7days = new Date();
  in7days.setDate(in7days.getDate() + 7);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const renewLimit = new Date();
  renewLimit.setDate(renewLimit.getDate() + 30);

  const revenueFilters: RevenueFilters = {
    modality: f.modality,
    salesOwner: f.salesOwner,
    serviceId: f.serviceId,
    segment: f.segment,
    clientStatus: f.clientStatus,
    clientId: f.clientId,
  };

  const [
    kpis, finance, cash, series, breakdowns, delinquents,
    revenue, renewalOutlook, losses,
    clients, upsell, expenses, receipts,
    dueSoon, renewals,
  ] =
    await Promise.all([
      getCommercialKpis(f),
      getFinanceSummary(f.period),
      getCashSummary(f.period),
      getMonthlySeries(f),
      getBreakdowns(f),
      getDelinquentClients(),
      getPeriodRevenue(f.period.start, f.period.end, revenueFilters),
      getRenewalOutlook([0, 1, 2, 3]),
      getLossSummary(),
      getClientsBlock(),
      getUpsellKpis(f.period.start, f.period.end),
      getExpenseSummary(f.period.start),
      getReceiptsSummary(f.period.start, f.period.end, revenueFilters),
      prisma.transaction.aggregate({
        where: {
          type: "despesa",
          status: { in: ["pendente", "devendo"] },
          dueDate: { gte: today, lte: in7days },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.contract.findMany({
        where: {
          status: { in: ["ACTIVE", "RENEWAL"] },
          renewalDate: { not: null, lte: renewLimit },
        },
        orderBy: { renewalDate: "asc" },
        take: 3,
        select: { title: true, renewalDate: true, client: { select: { name: true } } },
      }),
    ]);

  const health = computeHealth(finance, cash, kpis.inadimplenciaTaxa);

  // --- Alertas ---
  const alerts: DashAlert[] = [];
  if (kpis.receitaVencida > 0)
    alerts.push({
      severity: "high",
      title: "Cobranças vencidas",
      detail: `${formatBRL(kpis.receitaVencida)} em aberto de ${kpis.clientesInadimplentes} cliente(s)`,
      href: "/inadimplencia",
    });
  if (cash.projecao30 < 0)
    alerts.push({
      severity: "high",
      title: "Caixa projetado negativo",
      detail: `Projeção de 30 dias em ${formatBRL(cash.projecao30)}`,
      href: "/relatorios/financeiro-mensal",
    });
  if (dueSoon._count > 0)
    alerts.push({
      severity: "medium",
      title: "Despesas vencendo em 7 dias",
      detail: `${dueSoon._count} despesa(s) somando ${formatBRL(n(dueSoon._sum.amount))}`,
      href: "/despesas",
    });
  if (kpis.contratosEmRenovacao > 0)
    alerts.push({
      severity: "medium",
      title: "Contratos próximos da renovação",
      detail: `${kpis.contratosEmRenovacao} contrato(s) renovam nos próximos 30 dias`,
      href: "/acordos",
    });
  if (finance.folhaSobreReceita > 0.4)
    alerts.push({
      severity: "medium",
      title: "Folha acima do limite saudável",
      detail: `Folha consome ${Math.round(finance.folhaSobreReceita * 100)}% da receita (ideal: até 40%)`,
      href: "/folha",
    });

  // --- Próximas ações ---
  const actions: NextAction[] = [];
  for (const d of delinquents.slice(0, 2)) {
    actions.push({
      text: `Cobrar ${d.clientName} — ${formatBRL(d.totalOverdue)} vencido há ${d.daysOverdue} dia(s)`,
      href: "/inadimplencia",
    });
  }
  for (const r of renewals.slice(0, 2)) {
    actions.push({
      text: `Renovar contrato "${r.title}" de ${r.client.name} (vence ${r.renewalDate ? formatDateBR(r.renewalDate) : "em breve"})`,
      href: "/acordos",
    });
  }
  const topCat = breakdowns.despesasPorCategoria[0];
  if (topCat && finance.despesas > 0) {
    actions.push({
      text: `Revisar gastos em "${topCat.label}" — ${formatBRL(topCat.value)} (${Math.round((topCat.value / finance.despesas) * 100)}% das despesas do período)`,
      href: "/despesas",
    });
  }
  const mrrNow = series.mrr[series.mrr.length - 1] ?? 0;
  const mrrPrev = series.mrr[series.mrr.length - 2] ?? 0;
  if (mrrPrev > 0 && mrrNow < mrrPrev) {
    actions.push({
      text: `Acompanhar queda de MRR: ${formatBRL(mrrNow - mrrPrev)} vs mês anterior`,
      href: "/acordos",
    });
  }
  if (cash.projecao30 < 0) {
    actions.push({
      text: "Antecipar recebíveis ou renegociar prazos — caixa projetado negativo em 30 dias",
      href: "/cobrancas",
    });
  }

  return {
    kpis, finance, cash, series, breakdowns, health,
    alerts, actions: actions.slice(0, 6),
    revenue, renewalOutlook, losses,
    clients, upsell, expenses, receipts,
  };
}
