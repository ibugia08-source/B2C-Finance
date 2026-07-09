/**
 * Metadados de despesas compartilhados entre server e client.
 * IMPORTANTE: sem "use client" — server components (page.tsx) precisam
 * acessar estes objetos diretamente; exports de módulos client viram
 * referências opacas no servidor e quebram em runtime.
 */

export const EXPENSE_TYPE_LABEL: Record<string, string> = {
  FIXED: "Fixa",
  VARIABLE: "Variável",
  CARD: "Cartão de crédito",
  TAX: "Imposto",
  PAYROLL: "Folha",
  TOOL: "Ferramenta",
  ADS: "Mídia / Ads",
  LOAN: "Empréstimo",
  OTHER: "Outros",
};

export const RECURRENCE_LABEL: Record<string, string> = {
  NONE: "Não recorrente",
  MONTHLY: "Mensal",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
  CUSTOM: "Personalizada",
};
