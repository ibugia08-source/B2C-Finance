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
