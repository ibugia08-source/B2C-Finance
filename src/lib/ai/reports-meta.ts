/** Tipos de relatório executivo gerados pela IA (usado pela action e pela UI). */
export const AI_REPORTS = [
  { key: "resumo-mes", label: "Resumo financeiro do mês" },
  { key: "plano-semana", label: "Plano de ação semanal" },
  { key: "inadimplencia", label: "Relatório de inadimplência" },
  { key: "saude", label: "Análise de saúde financeira" },
  { key: "projecao-caixa", label: "Projeção de caixa" },
  { key: "clientes-criticos", label: "Análise de clientes críticos" },
  { key: "despesas", label: "Análise de despesas" },
  { key: "crescimento", label: "Análise de crescimento" },
] as const;

export type AIReportKey = (typeof AI_REPORTS)[number]["key"];
