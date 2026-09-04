/**
 * RECEITA EXTRA — vocabulário compartilhado entre tela, action e relatório.
 * Arquivo neutro (sem "use server") para poder exportar constantes.
 */

/** Tipos que o dono pode ESCOLHER ao lançar (RECOVERY_OF_OVERDUE é legado
 *  automático e não se cadastra à mão). */
export const EXTRA_REVENUE_MANUAL_TYPES = [
  "MANUAL_EXTRA_REVENUE",
  "ONE_TIME_SERVICE",
  "ADJUSTMENT",
  "OTHER",
] as const;

export type ExtraRevenueManualType = (typeof EXTRA_REVENUE_MANUAL_TYPES)[number];

export const EXTRA_REVENUE_TYPE_LABEL: Record<string, string> = {
  MANUAL_EXTRA_REVENUE: "Lançamento manual",
  ONE_TIME_SERVICE: "Serviço pontual",
  ADJUSTMENT: "Ajuste positivo",
  OTHER: "Outra origem",
  RECOVERY_OF_OVERDUE: "Recuperação de inadimplência", // legado
};
