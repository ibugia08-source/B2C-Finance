/**
 * O QUE CADA EVENTO FAZ COM O TEMPO (F2.1 · ref. 01 §5.2, §5.6).
 *
 * Módulo NEUTRO: a regra de período é decidida aqui e consumida pelos motores,
 * pela tela e pelos testes, sem ninguém importar Prisma para saber se um
 * evento pode acontecer.
 *
 * A CLASSIFICAÇÃO É A REGRA. Um período fechado não bloqueia "mutações"; ele
 * bloqueia POSTAGEM ECONÔMICA NAQUELA COMPETÊNCIA. A diferença é o caso mais
 * comum do sistema, descrito em §5.6: o cliente paga em outubro uma cobrança
 * de agosto, com agosto já fechado. Isso PODE acontecer — o caixa entra em
 * outubro, o razão posta em outubro, e a fotografia de agosto continua
 * mostrando vencido, porque foi assim que agosto fechou.
 *
 * Tratar esse pagamento como "mutação em período fechado" travaria a operação
 * de cobrança inteira todo dia 6.
 */

export type CategoriaDeEvento =
  /** Muda o RESULTADO da competência. É o que o fechamento congela. */
  | "ECONOMICO"
  /** Muda o CAIXA. Posta no mês do caixa, não no da competência de origem. */
  | "CAIXA"
  /** Pendência que o próprio fechamento precisa para acontecer. */
  | "FECHAMENTO"
  /** Não toca em número nenhum. */
  | "OPERACIONAL";

/**
 * Eventos conhecidos. Os nomes são os mesmos da matriz de PostingRule
 * (01 §3.10) de propósito: um nome só entre regra contábil e guarda de
 * período evita a pergunta "este REVENUE_RECOGNIZED é o mesmo daquele?".
 */
export const CATEGORIA_DO_EVENTO: Record<string, CategoriaDeEvento> = {
  REVENUE_RECOGNIZED: "ECONOMICO",
  EXPENSE_RECOGNIZED_ON_CREDIT: "ECONOMICO",
  BILLING_ADJUSTED: "ECONOMICO",
  MANUAL_LEDGER_ENTRY: "ECONOMICO",
  PAYROLL_RECOGNIZED: "ECONOMICO",
  TAX_PROVISIONED: "ECONOMICO",

  CUSTOMER_PAYMENT_RECEIVED: "CAIXA",
  CUSTOMER_PAYMENT_REVERSED: "CAIXA",
  EXPENSE_PAID_CASH: "CAIXA",
  TRANSFER: "CAIXA",

  RECONCILIATION: "FECHAMENTO",
  CLOSING_ADJUSTMENT: "FECHAMENTO",

  MONTHLY_EVALUATION: "OPERACIONAL",
  ONBOARDING: "OPERACIONAL",
  COLLECTION_CONTACT: "OPERACIONAL",
};

/**
 * Evento desconhecido é tratado como ECONÔMICO.
 *
 * Falha para o lado seguro: quem acrescentar um evento e esquecer de
 * classificá-lo descobre na primeira competência fechada, com uma mensagem
 * clara — e não seis meses depois, ao notar que um número de um mês fechado
 * mudou sozinho.
 */
export function categoriaDe(evento: string): CategoriaDeEvento {
  return CATEGORIA_DO_EVENTO[evento] ?? "ECONOMICO";
}

/** Rótulos de tela (01 §5.2: os nomes técnicos não aparecem em lugar nenhum). */
export const ROTULO_DO_PERIODO = {
  OPEN: "Aberto",
  SOFT_CLOSED: "Em fechamento",
  CLOSED: "Fechado",
  REOPENED: "Reaberto",
} as const;

export type EstadoDePeriodo = keyof typeof ROTULO_DO_PERIODO;

/**
 * A pergunta central, em forma pura: este evento pode acontecer NESTA
 * competência, dado o estado dela?
 *
 * Separada da consulta ao banco para poder ser lida, discutida e testada sem
 * nenhum banco por perto — é a regra financeira mais delicada do fechamento.
 */
export function permiteEvento(
  estado: EstadoDePeriodo,
  evento: string
): { ok: true } | { ok: false; error: string } {
  const cat = categoriaDe(evento);
  const rotulo = ROTULO_DO_PERIODO[estado];

  // Operacional nunca depende do fechamento: avaliar um cliente ou concluir
  // uma tarefa de implantação não mexe em número nenhum.
  if (cat === "OPERACIONAL") return { ok: true };

  switch (estado) {
    case "OPEN":
    case "REOPENED":
      // Reaberto foi reaberto exatamente para ser mexido.
      return { ok: true };

    case "SOFT_CLOSED":
      // "Mutações comuns bloqueadas, pendências autorizadas seguem" (§5.2).
      if (cat === "FECHAMENTO") return { ok: true };
      return {
        ok: false,
        error: `Este mês está ${rotulo.toLowerCase()}. Só as pendências do fechamento podem ser lançadas agora.`,
      };

    case "CLOSED":
      return {
        ok: false,
        error:
          cat === "CAIXA"
            ? "Este mês está fechado. Registre o recebimento no mês em que o dinheiro entrou — a cobrança antiga é quitada do mesmo jeito."
            : "Este mês está fechado. Para alterar o resultado dele é preciso reabrir a competência, com justificativa.",
      };
  }
}
