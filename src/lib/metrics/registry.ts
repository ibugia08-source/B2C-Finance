/**
 * REGISTRY DE MÉTRICAS — versão 1 (01 §7; 03 §4.1).
 *
 * Cada métrica é um CONTRATO: chave estável, fórmula em português, grão,
 * base temporal, arredondamento e política de nulo. Este arquivo é a fonte
 * única — o seed grava no banco e a interface lê daqui para o tooltip.
 *
 * Regra que isso protege (01 §2.21-2.22): quando uma fórmula mudar, nasce a
 * VERSÃO 2 e o passado continua reportando a versão que usou. Nenhuma tela
 * recalcula métrica inline; consome por chave.
 *
 * A base temporal é o campo que mais evita discussão: "Recebido em caixa" e
 * "Recebido da competência" são números DIFERENTES e legítimos — o que os
 * separa é o dateBasis.
 */

export type MetricGrain = "COMPETENCE" | "PERIOD" | "POINT_IN_TIME" | "CLIENT";
export type MetricDateBasis = "COMPETENCE" | "CASH" | "CURRENT_STATE" | "SNAPSHOT";

export type MetricSpec = {
  key: string;
  name: string;
  description: string;
  formulaDescription: string;
  grain: MetricGrain;
  dateBasis: MetricDateBasis;
  sourceEntities: string[];
  filters?: string;
  rounding?: string;
  nullPolicy?: string;
  /** Seção do arquivo 01 que define a métrica (rastreabilidade). */
  spec: string;
};

const MOEDA = "half-up, 2 casas (01 §3.14)";
const PCT = "half-up, 1 casa; exibido em %";
const DIV0 = "denominador zero → null (a interface mostra —)";

export const METRIC_REGISTRY: MetricSpec[] = [
  // ===================== 7.1 FINANCEIRAS =====================
  {
    key: "mrr_oficial",
    name: "MRR oficial",
    description: "Receita recorrente mensal contratada e vigente na competência.",
    formulaDescription:
      "Soma do valor mensal dos termos comerciais MRR vigentes na competência, das relações ativas elegíveis.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["CommercialTerm", "ClientAgencyRelationship"],
    filters: "modalidade MRR; relação ativa na competência",
    rounding: MOEDA, spec: "01 §7.1",
  },
  {
    key: "tcv_vendido",
    name: "TCV vendido",
    description: "Valor integral dos contratos TCV fechados no período comercial.",
    formulaDescription: "Soma do valor total dos contratos TCV com fechamento no período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["Contract", "Opportunity"],
    filters: "modalidade TCV; nunca rateado",
    rounding: MOEDA, spec: "01 §7.1, §3.2",
  },
  {
    key: "tcv_faturado",
    name: "TCV faturado",
    description: "Parcela de TCV reconhecida como receita na competência.",
    formulaDescription:
      "Soma das cobranças TCV com reconhecimento de receita (recognitionMode REVENUE) da competência.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing"],
    filters: "revenueType TCV; não cancelada",
    rounding: MOEDA, spec: "01 §7.1, §3.7",
  },
  {
    key: "receita_extra_reconhecida",
    name: "Receita Extra reconhecida",
    description: "Receita manual da competência, sem cobrança a cliente.",
    formulaDescription: "Soma das receitas extras manuais lançadas na competência.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["ExtraRevenue"],
    filters: "origem manual (a automática foi removida — 01 §3.6)",
    rounding: MOEDA, spec: "01 §7.1, §3.6",
  },
  {
    key: "faturamento_total",
    name: "Faturamento total",
    description: "Tudo que a competência reconhece como receita.",
    formulaDescription:
      "MRR + TCV faturado + Setup + Avulso + Upsell + Receita Extra reconhecida, na competência.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "ExtraRevenue", "CommercialTerm"],
    rounding: MOEDA, spec: "01 §7.1",
  },
  {
    key: "faturamento_esperado",
    name: "Faturamento esperado",
    description: "Quanto a Gestão do Mês espera receber. É operação/projeção — NÃO é DRE.",
    formulaDescription:
      "Soma das cobranças de liquidação da competência mais as previstas elegíveis.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing"],
    filters: "não cancelada",
    rounding: MOEDA, spec: "01 §7.1",
  },
  {
    key: "recebido_competencia",
    name: "Recebido da competência",
    description: "Dinheiro aplicado às cobranças daquela competência.",
    formulaDescription:
      "Soma do caixa aplicado a cobranças cuja competência é a analisada, conforme o corte.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Payment", "PaymentApplication", "Billing"],
    rounding: MOEDA, spec: "01 §7.1",
  },
  {
    key: "recuperacao",
    name: "Recuperação",
    description:
      "Caixa do período que quitou cobrança de competência ANTERIOR — inadimplência regularizada.",
    formulaDescription:
      "Soma do caixa do período aplicado a cobranças de competências anteriores.",
    grain: "PERIOD", dateBasis: "CASH",
    sourceEntities: ["Payment", "Billing"],
    filters: "mês do pagamento posterior à competência da cobrança",
    rounding: MOEDA, spec: "01 §7.1, §3.3",
  },
  {
    key: "recebido_caixa",
    name: "Recebido em caixa no período",
    description: "Dinheiro que efetivamente entrou no período, venha de onde vier.",
    formulaDescription:
      "Entradas de clientes + recuperação + adiantamentos + extras − reembolsos, chargebacks e estornos.",
    grain: "PERIOD", dateBasis: "CASH",
    sourceEntities: ["Payment", "Income"],
    rounding: MOEDA, spec: "01 §7.1",
  },
  {
    key: "em_aberto",
    name: "Em aberto",
    description: "O que a competência ainda tem a receber.",
    formulaDescription:
      "Soma de max(0, valor ajustado − aplicações válidas) das cobranças elegíveis em aberto.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "PaymentApplication"],
    filters: "não cancelada; saldo positivo",
    rounding: MOEDA, spec: "01 §7.1",
  },
  {
    key: "vencido",
    name: "Vencido",
    description: "Parte do em aberto que já passou do vencimento (inadimplência do mês).",
    formulaDescription: "Parcela do Em aberto cujo vencimento é anterior a hoje, no escopo.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing"],
    rounding: MOEDA, spec: "01 §7.1",
  },
  {
    key: "resultado_mes",
    name: "Resultado do mês",
    description: "Sobra de caixa do período (visão do Painel).",
    formulaDescription: "Recebido em caixa − saídas operacionais de caixa do período.",
    grain: "PERIOD", dateBasis: "CASH",
    sourceEntities: ["Payment", "Income", "Transaction"],
    rounding: MOEDA, spec: "01 §7.1",
  },
  {
    key: "projecao_mes",
    name: "Projeção do mês",
    description: "O que sobra se tudo que é esperado entrar (visão da Gestão do Mês).",
    formulaDescription: "Faturamento esperado − despesas previstas/da competência.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "Transaction"],
    rounding: MOEDA, spec: "01 §7.1; 02 §5.2",
  },
  {
    key: "margem_gerencial",
    name: "Margem gerencial",
    description: "Quanto do que entrou virou resultado.",
    formulaDescription: "Resultado ÷ receita operacional reconhecida.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "Transaction"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.1",
  },
  {
    key: "percentual_recorrencia",
    name: "% Recorrência",
    description: "Quanto do faturamento é previsível.",
    formulaDescription: "MRR ÷ Faturamento total.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["CommercialTerm", "Billing"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.1",
  },
  {
    key: "percentual_realizacao",
    name: "% Realização",
    description: "Quanto do previsto do mês virou dinheiro.",
    formulaDescription: "Recebido da competência ÷ Faturamento esperado.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "Payment"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.1; 02 §5.2",
  },

  // ===================== 7.2 CAIXA E LIQUIDEZ =====================
  {
    key: "caixa_total",
    name: "Caixa total",
    description: "Saldo somado das contas e caixas incluídos.",
    formulaDescription: "Soma dos saldos das contas bancárias e caixas marcados como incluídos.",
    grain: "POINT_IN_TIME", dateBasis: "CURRENT_STATE",
    sourceEntities: ["Account", "CashBox"],
    rounding: MOEDA, spec: "01 §7.2",
  },
  {
    key: "caixa_reservado",
    name: "Caixa reservado",
    description: "Parte do caixa comprometida com reservas restritas ou planejadas.",
    formulaDescription: "Soma das reservas marcadas como restritas/planejadas.",
    grain: "POINT_IN_TIME", dateBasis: "CURRENT_STATE",
    sourceEntities: ["CashBox"],
    rounding: MOEDA, spec: "01 §7.2",
  },
  {
    key: "liquidez_disponivel",
    name: "Liquidez disponível",
    description:
      "O dinheiro que dá para usar. É esta métrica que vai no card de caixa — nunca o saldo bruto.",
    formulaDescription: "Caixa total − caixa reservado − compromissos imediatos configurados.",
    grain: "POINT_IN_TIME", dateBasis: "CURRENT_STATE",
    sourceEntities: ["Account", "CashBox", "Transaction"],
    rounding: MOEDA, spec: "01 §7.2; 02 §5.1",
  },

  // ===================== 7.3 CARTEIRA E RETENÇÃO =====================
  {
    key: "clientes_ativos",
    name: "Clientes ativos",
    description: "Relações ativas na competência.",
    formulaDescription: "Contagem das relações cliente×agência ativas na competência.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["ClientAgencyRelationship"],
    rounding: "inteiro", spec: "01 §7.3",
  },
  {
    key: "novos_clientes",
    name: "Novos clientes",
    description: "Relações iniciadas no período.",
    formulaDescription: "Contagem das relações com início dentro do período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["ClientAgencyRelationship"],
    rounding: "inteiro", spec: "01 §7.3",
  },
  {
    key: "churn_quantidade",
    name: "Churn (quantidade)",
    description: "Clientes perdidos no período.",
    formulaDescription: "Contagem de perdas (ClientLoss) registradas no período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["ClientLoss"],
    rounding: "inteiro", spec: "01 §7.3",
  },
  {
    key: "churn_valor",
    name: "Churn (valor)",
    description: "MRR perdido nas saídas do período.",
    formulaDescription: "Soma do MRR registrado em cada evento de perda do período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["ClientLoss"],
    rounding: MOEDA, spec: "01 §7.3",
  },
  {
    key: "churn_rate",
    name: "Taxa de churn",
    description: "Ritmo de perda da carteira.",
    formulaDescription: "Clientes perdidos no período ÷ clientes ativos no início do período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["ClientLoss", "ClientAgencyRelationship"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.3",
  },
  {
    key: "revenue_churn",
    name: "Revenue churn",
    description: "Ritmo de perda de receita recorrente.",
    formulaDescription: "MRR perdido no período ÷ MRR no início do período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["ClientLoss", "CommercialTerm"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.3",
  },
  {
    key: "nrr",
    name: "NRR",
    description: "Receita líquida retida da base existente.",
    formulaDescription: "(MRR inicial + expansão − contração − churn de MRR) ÷ MRR inicial.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["CommercialTerm", "ClientLoss"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.3",
  },
  {
    key: "tenure",
    name: "Tenure",
    description: "Meses ativos acumulados da relação.",
    formulaDescription:
      "Meses entre o início da relação e hoje (ou a saída), descontadas as pausas conforme política.",
    grain: "CLIENT", dateBasis: "CURRENT_STATE",
    sourceEntities: ["ClientAgencyRelationship"],
    rounding: "inteiro (meses)", spec: "01 §7.3",
  },
  {
    key: "receita_acumulada_realizada",
    name: "Receita acumulada realizada",
    description:
      "Tudo que o cliente já pagou. Substitui o antigo 'LTV recebido' — é caixa, não estimativa.",
    formulaDescription: "Soma do caixa recebido do cliente em toda a história da relação.",
    grain: "CLIENT", dateBasis: "CASH",
    sourceEntities: ["Payment", "Billing"],
    rounding: MOEDA, spec: "01 §7.3",
  },
  {
    key: "ltv_estimado",
    name: "LTV estimado",
    description: "Projeção de valor futuro. SEMPRE rotulada como estimativa.",
    formulaDescription: "Ticket médio × vida média esperada da relação.",
    grain: "CLIENT", dateBasis: "CURRENT_STATE",
    sourceEntities: ["CommercialTerm", "ClientLoss"],
    rounding: MOEDA, nullPolicy: "sem base suficiente → null", spec: "01 §7.3",
  },

  // ===================== 7.4 RENTABILIDADE =====================
  {
    key: "ticket_medio",
    name: "Ticket médio",
    description: "Faturamento médio por cliente ativo.",
    formulaDescription: "Faturamento total ÷ clientes ativos na competência.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "ClientAgencyRelationship"],
    rounding: MOEDA, nullPolicy: DIV0, spec: "01 §7.4",
  },
  {
    key: "custo_por_cliente",
    name: "Custo por cliente",
    description: "Despesa média por cliente ativo.",
    formulaDescription: "Total de despesas ÷ clientes ativos na competência.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Transaction", "ClientAgencyRelationship"],
    rounding: MOEDA, nullPolicy: DIV0, spec: "01 §7.4",
  },
  {
    key: "margem_contribuicao_cliente",
    name: "Margem de contribuição do cliente",
    description:
      "Receita do cliente menos os custos diretos dele. NÃO é lucro líquido: o overhead ainda não está rateado.",
    formulaDescription: "Receita reconhecida do cliente − custos diretos e alocados a ele.",
    grain: "CLIENT", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "Transaction", "Allocation"],
    rounding: MOEDA, spec: "01 §7.4",
  },
  {
    key: "percentual_folha",
    name: "% Folha",
    description: "Peso da folha sobre a base configurada.",
    formulaDescription: "Folha elegível ÷ base configurada (padrão: faturamento total).",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Payroll", "Billing"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.4",
  },

  // ===================== 7.5 COMERCIAL =====================
  {
    key: "cac",
    name: "CAC",
    description: "Custo de aquisição por cliente novo.",
    formulaDescription: "Custos comerciais definidos ÷ novos clientes do período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["Transaction", "ClientAgencyRelationship"],
    rounding: MOEDA, nullPolicy: DIV0, spec: "01 §7.5",
  },
  {
    key: "roas",
    name: "ROAS",
    description:
      "Retorno sobre o investimento em anúncios. A base que valoriza o MRR é parâmetro OBRIGATÓRIO.",
    formulaDescription:
      "Valor das vendas ganhas (pela base de valoração configurada) ÷ gasto em anúncios.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["Opportunity", "GastoAdsDiario"],
    filters: "base de valoração do MRR: primeiro mês | valor contratual | outra",
    rounding: "half-up, 2 casas", nullPolicy: DIV0, spec: "01 §7.5",
  },
  {
    key: "cpl",
    name: "CPL",
    description: "Custo por lead gerado.",
    formulaDescription: "Gasto em anúncios do período ÷ leads criados no período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["GastoAdsDiario", "Lead"],
    rounding: MOEDA, nullPolicy: DIV0, spec: "01 §7.5",
  },
  {
    key: "cpmql",
    name: "CPMQL",
    description: "Custo por lead qualificado — o que passou da triagem.",
    formulaDescription:
      "Gasto em anúncios do período ÷ leads que chegaram a qualificado, reunião marcada ou conversão.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["GastoAdsDiario", "Lead"],
    rounding: MOEDA, nullPolicy: DIV0, spec: "01 §7.5",
  },
  {
    key: "custo_por_agendamento",
    name: "Custo por agendamento",
    description: "Quanto custou marcar uma reunião.",
    formulaDescription: "Gasto em anúncios do período ÷ agendamentos registrados pelos SDRs.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["GastoAdsDiario", "AtividadeDiaria"],
    rounding: MOEDA, nullPolicy: DIV0, spec: "01 §7.5",
  },
  {
    key: "custo_por_reuniao",
    name: "Custo por reunião",
    description:
      "Quanto custou uma reunião que ACONTECEU. Difere do custo por agendamento pelo no-show.",
    formulaDescription: "Gasto em anúncios do período ÷ reuniões realizadas.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["GastoAdsDiario", "AtividadeDiaria"],
    rounding: MOEDA, nullPolicy: DIV0, spec: "01 §7.5",
  },
  {
    key: "comparecimento",
    name: "Comparecimento",
    description: "Quanto do que foi marcado realmente aconteceu.",
    formulaDescription: "Reuniões realizadas ÷ (realizadas + no-shows).",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["AtividadeDiaria"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.5",
  },
  {
    key: "conversao_reuniao",
    name: "Conversão de reunião",
    description: "Das reuniões que aconteceram, quantas viraram venda.",
    formulaDescription: "Oportunidades ganhas no período ÷ reuniões realizadas no período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["Opportunity", "AtividadeDiaria"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.5",
  },
  {
    key: "tcv_comercial",
    name: "TCV comercial",
    description: "Valor de contrato fechado vendido no período. É o TCV VENDIDO, não o faturado.",
    formulaDescription: "Soma do valor das oportunidades TCV ganhas no período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["Opportunity"],
    rounding: MOEDA, spec: "01 §7.5",
  },
  {
    key: "novo_mrr",
    name: "Novo MRR",
    description: "Mensalidade que COMEÇOU no período — expansão de base não entra.",
    formulaDescription: "Soma do valor mensal das oportunidades MRR ganhas no período.",
    grain: "PERIOD", dateBasis: "COMPETENCE",
    sourceEntities: ["Opportunity"],
    rounding: MOEDA, spec: "01 §7.5",
  },
  {
    key: "pipeline_coverage",
    name: "Pipeline coverage",
    description:
      "Quantas vezes a meta o funil aberto cobre, ponderado pela etapa. Sem meta cadastrada não existe.",
    formulaDescription:
      "Pipeline ponderado (valor × probabilidade da etapa) ÷ meta de valor do período.",
    grain: "PERIOD", dateBasis: "CURRENT_STATE",
    sourceEntities: ["Opportunity", "CommercialGoal"],
    filters: "peso por etapa declarado em lib/commercial/funil (não configurável nesta versão)",
    rounding: "half-up, 2 casas", nullPolicy: DIV0, spec: "01 §7.5",
  },
  {
    key: "tempo_por_etapa",
    name: "Tempo por etapa",
    description:
      "Média de dias que a venda passa em cada etapa. Conta só passagens concluídas.",
    formulaDescription:
      "Média de (saída − entrada) por etapa, reconstruída dos eventos do funil.",
    grain: "PERIOD", dateBasis: "CURRENT_STATE",
    sourceEntities: ["PipelineEvent"],
    rounding: "half-up, 1 casa (dias)", nullPolicy: "sem passagem concluída → null",
    spec: "01 §7.5",
  },
  {
    key: "conversao_upsell",
    name: "Conversão de upsell",
    description: "Aproveitamento das oportunidades de upsell no mês.",
    formulaDescription: "Upsells ganhos ÷ total de upsells do mês.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Upsell"],
    rounding: PCT, nullPolicy: DIV0, spec: "01 §7.5",
  },

  // ===================== 7.7 SAÚDE =====================
  {
    key: "saude_financeira",
    name: "Saúde financeira",
    description:
      "Nota 0-100 com fatores, pesos e limites configuráveis e versionados — nada fixo no código como verdade estrutural.",
    formulaDescription:
      "Soma ponderada dos fatores configurados (margem, inadimplência, caixa, churn), com os penalizadores expostos na interface.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "Transaction", "CashBox", "ClientLoss"],
    rounding: "inteiro 0-100", spec: "01 §7.7",
  },
];

/** Busca uma métrica pela chave (a interface usa para tooltip e rótulo). */
export function getMetricSpec(key: string): MetricSpec | undefined {
  return METRIC_REGISTRY.find((m) => m.key === key);
}

/** Versão vigente do registry — vai no snapshot do fechamento (01 §4.12). */
export const METRIC_REGISTRY_VERSION = 1;
