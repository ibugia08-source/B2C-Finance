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
  /**
   * Versão DESTA métrica. Ausente = 1. Quando uma fórmula muda, a entrada
   * antiga FICA (marcada com `vigenteAte`) e nasce uma nova com version+1 —
   * é isso que faz o passado continuar reportando a fórmula que usou
   * (01 §2.21-2.22). O seed grava uma linha por (chave, versão).
   */
  version?: number;
  /** Data em que esta versão deixou de valer (ISO). Ausente = vigente. */
  vigenteAte?: string;
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
    sourceEntities: ["Contract"],
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
    key: "renovacao_esperada",
    name: "Renovações esperadas do mês",
    description:
      "Quanto se espera renovar no mês: soma do valor esperado de todos os clientes com data de expectativa de renovação no mês.",
    formulaDescription:
      "Σ valor esperado dos clientes com expectativa no mês (entrada + prazo, ou agendada) — pendentes e já decididos. TCV = valor cheio do contrato; MRR = mensalidade. Desfechos usam o valor congelado no registro.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Client", "ClientRenewal", "ClientLoss"],
    filters: "clientes em atividade; desfecho conta no mês da expectativa",
    rounding: MOEDA, spec: "01 §7.1 — decisão do dono 25/09/2026",
  },
  {
    key: "faturamento_total_esperado",
    name: "Faturamento total esperado",
    description:
      "Tudo o que se espera faturar no mês: o faturamento total previsto somado ao valor esperado de renovação do mês.",
    formulaDescription:
      "Faturamento total (MRR + TCV + receita extra do mês) + Renovações esperadas do mês.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "ExtraRevenue", "Client", "ClientRenewal", "ClientLoss"],
    filters:
      "fórmula definida pelo dono; renovação MRR já tem a mensalidade dentro do MRR do mês, e renovação TCV lançada já aparece no TCV — o card mostra as duas parcelas separadas",
    rounding: MOEDA, spec: "01 §7.1 — decisão do dono 25/09/2026",
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
  // As três métricas de caixa mudaram de fórmula em 10/09/2026, quando as
  // reservas (CashBox) saíram do produto. As versões 1 continuam AQUI e no
  // banco, com `vigenteAte`: fotografia antiga tem de continuar reportando a
  // fórmula que usou (01 §2.21-2.22). O código lê sempre a versão vigente.
  {
    key: "caixa_total", version: 1, vigenteAte: "2026-09-10",
    name: "Caixa total",
    description: "Saldo somado das contas e caixas incluídos.",
    formulaDescription: "Soma dos saldos das contas bancárias e caixas marcados como incluídos.",
    grain: "POINT_IN_TIME", dateBasis: "CURRENT_STATE",
    sourceEntities: ["Account", "CashBox"],
    rounding: MOEDA, spec: "01 §7.2",
  },
  {
    key: "caixa_total", version: 2,
    name: "Caixa total",
    description: "Saldo somado das contas bancárias ativas.",
    formulaDescription: "Soma dos saldos das contas bancárias ativas.",
    grain: "POINT_IN_TIME", dateBasis: "CURRENT_STATE",
    sourceEntities: ["Account"],
    rounding: MOEDA, spec: "01 §7.2",
  },
  {
    key: "caixa_reservado", version: 1, vigenteAte: "2026-09-10",
    name: "Caixa reservado",
    description:
      "DESCONTINUADA: as reservas saíram do produto em 10/09/2026. Fica no registry para o passado continuar legível.",
    formulaDescription: "Soma das reservas marcadas como restritas/planejadas.",
    grain: "POINT_IN_TIME", dateBasis: "CURRENT_STATE",
    sourceEntities: ["CashBox"],
    rounding: MOEDA, spec: "01 §7.2",
  },
  {
    key: "liquidez_disponivel", version: 1, vigenteAte: "2026-09-10",
    name: "Liquidez disponível",
    description:
      "O dinheiro que dá para usar. É esta métrica que vai no card de caixa — nunca o saldo bruto.",
    formulaDescription: "Caixa total − caixa reservado − compromissos imediatos configurados.",
    grain: "POINT_IN_TIME", dateBasis: "CURRENT_STATE",
    sourceEntities: ["Account", "CashBox", "Transaction"],
    rounding: MOEDA, spec: "01 §7.2; 02 §5.1",
  },
  {
    key: "liquidez_disponivel", version: 2,
    name: "Liquidez disponível",
    description:
      "O dinheiro que dá para usar. É esta métrica que vai no card de caixa — nunca o saldo bruto.",
    formulaDescription:
      "Soma dos saldos das contas ativas − compromissos imediatos (contas a pagar vencidas e as que vencem dentro da janela configurada, padrão 7 dias).",
    grain: "POINT_IN_TIME", dateBasis: "CURRENT_STATE",
    sourceEntities: ["Account", "Transaction"],
    rounding: MOEDA, spec: "01 §7.2; 02 §5.1",
  },
  {
    key: "projecao_caixa_horizonte",
    name: "Projeção de caixa no horizonte",
    description:
      "Onde o caixa chega em 30, 60 ou 90 dias. É previsão de CAIXA — não é resultado nem competência.",
    formulaDescription:
      "Saldo bruto das contas ativas + cobranças que vencem DENTRO do horizonte − contas a pagar até o limite (incluindo as já vencidas) − parcelas de passivo financiado no período.",
    grain: "POINT_IN_TIME", dateBasis: "CURRENT_STATE",
    sourceEntities: ["Account", "Billing", "Transaction", "Liability"],
    filters:
      "A cobrança JÁ VENCIDA não entra como entrada: ela é reportada à parte. Contá-la seria supor que o atrasado chega dentro do prazo — foi essa hipótese que fez a projeção divergir do card de Liquidez até 11/09/2026.",
    rounding: MOEDA,
    nullPolicy: "Sem conta ativa cadastrada, a partida é zero e a tela precisa dizer isso — não é caixa zerado, é caixa não configurado.",
    spec: "01 §7.2; 02 §5.1",
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
    key: "margem_contribuicao_cliente", version: 1, vigenteAte: "2026-09-10",
    name: "Margem de contribuição do cliente",
    description:
      "Receita do cliente menos os custos diretos dele. NÃO é lucro líquido: o overhead ainda não está rateado.",
    formulaDescription: "Receita reconhecida do cliente − custos diretos e alocados a ele.",
    grain: "CLIENT", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "Transaction", "Allocation"],
    rounding: MOEDA, spec: "01 §7.4",
  },
  {
    // v2: sem o rateio de mídia (removido em 10/09/2026), o custo do cliente
    // é o DIRETO — a despesa com o cliente escrito nela. Mídia sem dono é
    // overhead e só aparece na margem totalmente alocada, que declara isso.
    key: "margem_contribuicao_cliente", version: 2,
    name: "Margem de contribuição do cliente",
    description:
      "Receita do cliente menos os custos diretos dele. NÃO é lucro líquido: o overhead não está incluído.",
    formulaDescription:
      "Receita reconhecida do cliente − despesas vinculadas manualmente a ele (Transaction.clientId).",
    grain: "CLIENT", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "Transaction"],
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
    key: "saude_financeira", version: 1, vigenteAte: "2026-09-10",
    name: "Saúde financeira",
    description:
      "Nota 0-100 com fatores, pesos e limites configuráveis e versionados — nada fixo no código como verdade estrutural.",
    formulaDescription:
      "Soma ponderada dos fatores configurados (margem, inadimplência, caixa, churn), com os penalizadores expostos na interface.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "Transaction", "CashBox", "ClientLoss"],
    rounding: "inteiro 0-100", spec: "01 §7.7",
  },
  {
    // Mesma nota, mesma fórmula: o fator "caixa" deixou de ler as reservas
    // (CashBox) e passou a ler o saldo das contas ativas. Fonte diferente é
    // contrato diferente, então é versão nova — o passado continua na v1.
    key: "saude_financeira", version: 2,
    name: "Saúde financeira",
    description:
      "Nota 0-100 com fatores, pesos e limites configuráveis e versionados — nada fixo no código como verdade estrutural.",
    formulaDescription:
      "Soma ponderada dos fatores configurados (margem, inadimplência, caixa em conta, churn), com os penalizadores expostos na interface.",
    grain: "COMPETENCE", dateBasis: "COMPETENCE",
    sourceEntities: ["Billing", "Transaction", "Account", "ClientLoss"],
    rounding: "inteiro 0-100", spec: "01 §7.7",
  },
];

/**
 * Busca a métrica VIGENTE pela chave (a interface usa para tooltip e rótulo).
 *
 * Com o registry guardando versões antigas, "a métrica" é sempre a de maior
 * versão sem `vigenteAte` — quem quiser a fórmula de uma fotografia velha lê
 * a MetricDefinition da versão gravada nela, que é o ponto de guardar as duas.
 */
export function getMetricSpec(key: string): MetricSpec | undefined {
  const daChave = METRIC_REGISTRY.filter((m) => m.key === key);
  const vigentes = daChave.filter((m) => !m.vigenteAte);
  const lista = vigentes.length > 0 ? vigentes : daChave;
  return lista.reduce<MetricSpec | undefined>(
    (melhor, m) => (!melhor || (m.version ?? 1) > (melhor.version ?? 1) ? m : melhor),
    undefined
  );
}

/** Versão vigente de uma métrica (o que vai no snapshot ao lado do valor). */
export function versaoVigenteDaMetrica(key: string): number {
  return getMetricSpec(key)?.version ?? 1;
}

/** Versão vigente do registry — vai no snapshot do fechamento (01 §4.12). */
export const METRIC_REGISTRY_VERSION = 1;
