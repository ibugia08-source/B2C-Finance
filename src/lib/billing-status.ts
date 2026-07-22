/**
 * Constantes de domínio para status de cobrança (Billing) e comparação
 * monetária — fonte única das listas que antes viviam como strings mágicas
 * espalhadas por services/actions.
 */

/** Cobrança com QUALQUER pendência de pagamento (aberta). */
export const BILLING_OPEN_STATUSES = ["PENDING", "PARTIAL", "OVERDUE"] as const;

/**
 * Cobrança pendente ainda não marcada como vencida — combine sempre com um
 * filtro de dueDate (ex.: `dueDate: { lt: hoje }` para achar atrasadas que o
 * job de marcação ainda não viu).
 */
export const BILLING_AWAITING_STATUSES = ["PENDING", "PARTIAL"] as const;

/**
 * Tolerância única para comparação de valores monetários (ruído de ponto
 * flutuante em centavos). Antes havia 0.01 e 0.005 coexistindo no código.
 */
export const MONEY_EPSILON = 0.01;
