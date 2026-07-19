/**
 * CAMADA CENTRAL DE CÁLCULOS FINANCEIROS (PARTE 13 do briefing).
 *
 * Ponto único de importação para todo cálculo de negócio da B2C.
 * Dashboard, Relatórios, Rotina, Projeções e IA consomem DAQUI —
 * nunca reimplementam regra em componente.
 *
 * Mapa de responsabilidades:
 *  - revenue-metrics ..... MRR do mês/período, TCV (valor cheio no mês da
 *    adesão/renovação, SEM rateio), faturamento total, clientes MRR/TCV,
 *    renovações por janela (valor esperado: TCV = última adesão; MRR =
 *    mensal atual), perdas de clientes e receita perdida.
 *  - client-metrics ...... resumo financeiro por cliente e inadimplência
 *    do mês (Pago/Devendo, com override manual).
 *  - upsell-metrics ...... pipeline aberto, ganho, conversão, rankings.
 *  - expense-metrics ..... despesas do mês (pagas/pendentes/vencidas/
 *    recorrentes), débitos de fatura, limites de cartão.
 *  - billing-metrics ..... cobranças vencidas, aging e fila de inadimplência.
 *  - finance-metrics ..... resultado (lucro/margem), caixa e projeções 30/60/90.
 *  - dashboard-metrics ... orquestrador (uma chamada → dashboard inteiro).
 *  - projections ......... cenários e metas (funções puras, sem banco).
 *
 * Todos os cálculos respeitam período (mês/ano/personalizado) e, quando
 * aplicável, os filtros de responsável, modalidade, serviço, segmento e
 * status do cliente (RevenueFilters / DashboardFilters).
 */

// ===== MÉTRICAS OFICIAIS DO MÊS (fórmulas do dicionário) =====
// Em aberto = Falta receber = Faturamento total previsto − Recebido (clamp 0).
// Vencido = parte do em aberto com vencimento passado (Vencido ⊂ Em aberto).
// Dashboard, Rotina e relatórios usam ESTAS funções — nunca recalculam.
import { getReceiptsSummary as _receipts } from "@/lib/services/revenue-metrics";

/** Faturamento total previsto do período (Σ cobranças da competência). */
export async function getMonthlyExpectedRevenue(start: Date, end: Date) {
  return (await _receipts(start, end)).expectedTotal;
}
/** Recebido no período (pagos dentro do mês de competência + adiantamentos). */
export async function getMonthlyReceivedRevenue(start: Date, end: Date) {
  return (await _receipts(start, end)).receiptsCorrectMonth;
}
/** Em aberto / Falta receber = max(previsto − recebido, 0). */
export async function getMonthlyOpenRevenue(start: Date, end: Date) {
  return (await _receipts(start, end)).openMonth;
}
/** Vencido = em aberto com vencimento passado (subconjunto do Em aberto). */
export async function getMonthlyOverdueRevenue(start: Date, end: Date) {
  return (await _receipts(start, end)).overdueOpenAmount;
}
/** Resultado do mês = Recebido − Despesas do mês (regra do Dashboard). */
export function computeMonthlyResult(received: number, monthExpenses: number) {
  return received - monthExpenses;
}
/** Alias com o nome oficial do dicionário. */
export const getMonthlyResult = computeMonthlyResult;
/** Margem Operacional = Resultado / Recebido (0 quando nada recebido). */
export function computeOperationalMargin(result: number, received: number) {
  return received > 0 ? result / received : 0;
}

// ===== Indicadores gerenciais do mês (Bloco 2 do Dashboard) =====
// Assíncronos consultam a camada de serviços; os puros recebem valores já
// centralizados e apenas protegem contra divisão por zero.
import {
  getMonthlyChurn as _churn,
  getNewClientsSummary as _newClients,
} from "@/lib/services/revenue-metrics";

/** Faturamento MRR do mês = parte MRR do Recebido. */
export async function getMonthlyMrrRevenue(start: Date, end: Date) {
  return (await _receipts(start, end)).mrrReceived;
}
/** Faturamento TCV do mês = parte TCV do Recebido (valor cheio, sem rateio). */
export async function getMonthlyTcvRevenue(start: Date, end: Date) {
  return (await _receipts(start, end)).tcvReceived;
}
/** Ticket médio = Recebido / clientes pagos no mês (0 se ninguém pagou). */
export function getMonthlyAverageTicket(received: number, paidClients: number) {
  return paidClients > 0 ? received / paidClients : 0;
}
/** Custo por cliente = Despesas do mês / clientes ativos (0 se nenhum). */
export function getMonthlyCostPerClient(monthExpenses: number, activeClients: number) {
  return activeClients > 0 ? monthExpenses / activeClients : 0;
}
/** % Folha no faturamento = Folha do mês / Recebido (dinheiro que entrou). */
export function getPayrollPercentageOfRevenue(payroll: number, received: number) {
  return received > 0 ? payroll / received : 0;
}
/** Qtd. de clientes perdidos (churn) no período filtrado. */
export async function getMonthlyChurnCount(start: Date, end: Date) {
  return (await _churn(start, end)).count;
}
/** Receita perdida no período (MRR = mensal; TCV = última adesão). */
export async function getMonthlyLostRevenue(start: Date, end: Date) {
  return (await _churn(start, end)).value;
}
/** Qtd. de novos clientes no período (startedAt, fallback createdAt). */
export async function getMonthlyNewClientsCount(start: Date, end: Date) {
  return (await _newClients(start, end)).count;
}
/** Receita dos novos clientes (MRR = mensal; TCV = total do contrato). */
export async function getMonthlyNewClientsRevenue(start: Date, end: Date) {
  return (await _newClients(start, end)).revenue;
}
/** Total inadimplência = parte vencida do Em Aberto do período (⊂ Em Aberto). */
export async function getMonthlyDelinquencyTotal(start: Date, end: Date) {
  return (await _receipts(start, end)).overdueOpenAmount;
}

export { getMonthlyChurn, getNewClientsSummary } from "@/lib/services/revenue-metrics";
export type { MonthlyChurn, NewClientsSummary } from "@/lib/services/revenue-metrics";

// ===== Faturamento MRR/TCV, recebimentos/receita extra, renovações, perdas =====
export {
  getPeriodRevenue,
  getReceiptsSummary,
  getRenewalOutlook,
  getLossSummary,
  computeLossSnapshots,
  type PeriodRevenue,
  type ReceiptsSummary,
  type RevenueFilters,
  type RenewalWindow,
  type RenewalClient,
  type LossSummary,
  type LossItem,
} from "@/lib/services/revenue-metrics";

// ===== Clientes (resumo e inadimplência do mês) =====
export {
  getClientSummaries,
  getMonthDelinquencies,
  type ClientSummary,
  type MonthDelinquency,
} from "@/lib/services/client-metrics";

// ===== Upsell =====
export {
  getUpsellKpis,
  type UpsellKpis,
} from "@/lib/services/upsell-metrics";

// ===== Despesas e cartões =====
export {
  getExpenseSummary,
  type ExpenseSummary,
} from "@/lib/services/expense-metrics";
export {
  limitesUsadosPorCartao,
  limiteUsado,
  limiteDisponivel,
} from "@/lib/services/calculations";

// ===== Cobrança e inadimplência =====
export {
  markOverdueBillings,
  getDelinquentClients,
} from "@/lib/services/billing-metrics";

// ===== Resultado, caixa e saúde =====
export {
  getFinanceSummary,
  getCashSummary,
  type FinanceSummary,
  type CashSummary,
} from "@/lib/services/finance-metrics";

// ===== Orquestrador do dashboard =====
export {
  getExecutiveDashboard,
  getCommercialKpis,
  getMonthlySeries,
  type ExecutiveDashboard,
  type DashboardFilters,
  type ClientsBlock,
} from "@/lib/services/dashboard-metrics";

// ===== Dashboard (redesign): métricas principais, séries anuais, detalhes,
// resumo determinístico, composição e comparativo com mês anterior. =====
export {
  getDashboardMainMetrics,
  getYearlySeries, // Faturamento/Despesas/Resultado do ano (getYearly*Series)
  getPreviousMonthComparison,
  buildDashboardSummary,
  getResultLaunchedForMonth,
  resultLaunchTag,
  previousPeriodRange,
  getOpenByClient,
  getReceivedDetail,
  getExpensesDetail,
  getExpensesByCategory,
  getMrrClientsDetail,
  getTcvClientsDetail,
  getNewClientsDetail,
  getRenewalClientsDetail,
  type DashboardMainMetrics,
  type DashboardMainResult,
  type YearlySeries,
  type MetricDelta,
  type SummaryInput,
  type NamedValue,
  type ClientOpenItem,
  type ReceivedItem,
  type ExpenseItem,
  type ExpenseCategorySlice,
} from "@/lib/services/dashboard-main";

// ===== Projeções e cenários (puro) =====
export {
  currentScenario,
  projectScenario,
  analyzeGaps,
  buildNarrative,
  type Baseline,
  type ScenarioInput,
  type Goals,
  type Projected,
  type GapAnalysis,
} from "@/lib/financial/projections";
