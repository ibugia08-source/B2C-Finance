import type { Period } from "@/lib/period";
import { getDashboardMainMetrics } from "@/lib/services/dashboard-main";
import { getMonthlyChurn, getNewClientsSummary, getMonthlyCostPerClient } from "@/lib/financial/calculations";
import { getExecutiveDashboard } from "@/lib/services/dashboard-metrics";
import { METRIC_REGISTRY, getMetricSpec, METRIC_REGISTRY_VERSION, type MetricSpec } from "./registry";

/**
 * MOTOR DE MÉTRICAS (F0.7 — ref. 01 §7; 03 §4.1).
 *
 * Ponto ÚNICO de consumo: as telas pedem métrica por CHAVE e recebem valor +
 * contrato (fórmula, base temporal, versão). Nenhuma tela recalcula inline.
 *
 * Decisão desta fase: o motor NÃO reimplementa as fórmulas. Ele orquestra as
 * funções já provadas do v1 e as expõe pelo contrato do registry. Reescrever
 * cálculo aqui mudaria número — e a exigência de F0.7 é justamente entregar
 * paridade exata. As implementações migram para dentro dos engines na Fase 1,
 * uma a uma, com a suíte de paridade como rede.
 */

export type MetricValue = {
  key: string;
  /** null = sem base para calcular (nullPolicy do contrato). */
  value: number | null;
  spec: MetricSpec;
  registryVersion: number;
};

/** Todas as métricas de período que o motor sabe calcular hoje. */
export type PeriodMetricKey =
  | "faturamento_total" | "mrr_oficial" | "tcv_faturado" | "receita_extra_reconhecida"
  | "faturamento_esperado" | "recebido_competencia" | "em_aberto" | "vencido"
  | "resultado_mes" | "margem_gerencial" | "percentual_recorrencia" | "percentual_realizacao"
  | "clientes_ativos" | "novos_clientes" | "churn_quantidade" | "churn_valor" | "churn_rate"
  | "ticket_medio" | "custo_por_cliente" | "percentual_folha";

/**
 * Calcula, de uma vez, todas as métricas do período — uma única passada nas
 * fontes pesadas. Chamar métrica a métrica repetiria as mesmas queries.
 */
export async function computePeriodMetrics(
  period: Period
): Promise<Record<PeriodMetricKey, MetricValue>> {
  // Fases sequenciais: o pool do Prisma em produção é pequeno (03 §4.4).
  // getExecutiveDashboard é a MESMA fonte que a tela já usava — é isso que
  // garante paridade exata na troca dos cálculos inline pelo motor.
  const executivo = await getExecutiveDashboard({ period });
  const main = await getDashboardMainMetrics(period);
  const [churn, novos] = await Promise.all([
    getMonthlyChurn(period.start, period.end),
    getNewClientsSummary(period.start, period.end),
  ]);

  const M = main.current;
  const finance = executivo.finance;
  const ativos = executivo.clients.ativos;
  const ativosInicio = ativos + churn.count; // quem estava no início do período

  const bruto: Record<PeriodMetricKey, number | null> = {
    faturamento_total: M.faturamentoTotal,
    mrr_oficial: M.mrr,
    tcv_faturado: M.tcv,
    receita_extra_reconhecida: M.extraManual,
    faturamento_esperado: M.faturamentoTotal,
    recebido_competencia: M.recebido,
    em_aberto: M.emAberto,
    vencido: M.vencido,
    resultado_mes: M.resultado,
    margem_gerencial: M.margem,
    percentual_recorrencia: div(M.mrr, M.faturamentoTotal),
    percentual_realizacao: div(M.recebido, M.faturamentoTotal),
    clientes_ativos: ativos,
    novos_clientes: novos.count,
    churn_quantidade: churn.count,
    churn_valor: churn.value,
    churn_rate: div(churn.count, ativosInicio),
    ticket_medio: div(M.faturamentoTotal, ativos),
    custo_por_cliente: ativos > 0 ? getMonthlyCostPerClient(finance.despesas, ativos) : null,
    percentual_folha: div(finance.folhaPeriodo, M.faturamentoTotal),
  };

  const saida = {} as Record<PeriodMetricKey, MetricValue>;
  for (const key of Object.keys(bruto) as PeriodMetricKey[]) {
    saida[key] = wrap(key, bruto[key]);
  }
  return saida;
}

/** Uma métrica isolada (para tela que precisa de um número só). */
export async function metric(
  key: PeriodMetricKey,
  period: Period
): Promise<MetricValue> {
  const todas = await computePeriodMetrics(period);
  return todas[key];
}

/**
 * Divisão com política de nulo do contrato: denominador zero vira null e a
 * interface mostra "—". Nunca Infinity, nunca NaN, nunca 0 disfarçado.
 */
export function div(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador)) return null;
  if (denominador === 0) return null;
  return numerador / denominador;
}

function wrap(key: string, value: number | null): MetricValue {
  const spec = getMetricSpec(key);
  if (!spec) throw new Error(`Métrica "${key}" não está no registry (01 §7).`);
  return { key, value, spec, registryVersion: METRIC_REGISTRY_VERSION };
}

export { METRIC_REGISTRY, getMetricSpec, METRIC_REGISTRY_VERSION };
export type { MetricSpec };
