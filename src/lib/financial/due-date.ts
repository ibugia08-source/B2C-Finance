/**
 * Vencimento recorrente do MRR — cálculo único e seguro do dia de cobrança.
 *
 * Regra (Bloco 1 §8): o cliente MRR escolhe um dia recorrente de 1 a 31, mas
 * o vencimento de cada mês respeita a quantidade REAL de dias do mês. Se o dia
 * cadastrado for maior que o último dia do mês, usa-se o último dia válido.
 *
 *   Cliente vence dia 31, mês = abril (30 dias)  → 30/04
 *   Cliente vence dia 31, mês = fevereiro         → 28/02 (ou 29/02 bissexto)
 *   Cliente vence dia 31, mês = março             → 31/03
 *
 * Reutilizada em Recebimentos, Cobranças, Contratos e Dashboard — nunca
 * recalcular vencimento inline.
 */

/** Último dia do mês (1-12) considerando ano bissexto. */
export function lastDayOfMonth(year: number, month: number): number {
  // month é 1-12; `new Date(year, month, 0)` = último dia do mês `month`.
  return new Date(year, month, 0).getDate();
}

/**
 * Data de vencimento válida para um mês/ano a partir do dia recorrente.
 * @param year  ano (ex.: 2026)
 * @param month mês 1-12
 * @param recurringPaymentDay dia recorrente 1-31 (null/undefined → 5)
 * @returns Date no dia clampado ao último dia válido do mês (hora 00:00 local).
 */
export function getValidDueDateForMonth(
  year: number,
  month: number,
  recurringPaymentDay?: number | null
): Date {
  const desired = recurringPaymentDay == null ? 5 : Math.trunc(recurringPaymentDay);
  const clampedToRange = Math.min(Math.max(desired, 1), 31);
  const day = Math.min(clampedToRange, lastDayOfMonth(year, month));
  return new Date(year, month - 1, day);
}
