/**
 * STATUS-META — a língua de cores da planilha, unificada.
 *
 * O dono controlava o financeiro por cores: 🟢 PAGO · 🟡 A VENCER/PENDENTE ·
 * 🔴 DEVENDO/ATRASADO. Este módulo traduz os status técnicos de cada domínio
 * (cobrança, despesa, folha, receita) para esse vocabulário único de
 * rótulo + variante de Badge + tintura de linha — em todas as telas.
 *
 * Sem "use client" e sem imports de servidor: usável em Server e Client
 * Components (mesmo padrão dos _meta.ts por módulo).
 */

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "outline";

export type StatusMeta = {
  label: string;
  variant: BadgeVariant;
  /** Tintura suave da linha da tabela (vazio = sem tintura). */
  rowClass: string;
};

// Tintura suave da linha, sempre pelo token semântico (02 §7.2: "fundo suave
// sempre com par dark"). Os tokens *-soft já trazem o par dos dois temas —
// no claro uma tintura clara, no escuro uma translúcida — então aqui não
// existe mais variante `dark:`.
export const ROW_PAID = "bg-success-soft/60";
export const ROW_SOON = "bg-warning-soft/60";
export const ROW_OVERDUE = "bg-danger-soft/60";

const META = {
  pago: (label: string): StatusMeta => ({ label, variant: "success", rowClass: ROW_PAID }),
  alerta: (label: string): StatusMeta => ({ label, variant: "warning", rowClass: ROW_SOON }),
  devendo: (label: string): StatusMeta => ({ label, variant: "destructive", rowClass: ROW_OVERDUE }),
  neutro: (label: string): StatusMeta => ({ label, variant: "secondary", rowClass: "" }),
};

// ===========================================================================
// Cobranças — status do ciclo mensal (CycleStatus de receivables-cycle.ts)
// ===========================================================================

export const CYCLE_STATUS_META: Record<string, StatusMeta> = {
  PAID: META.pago("Pago"),
  PAID_LATE: META.pago("Pago com atraso"),
  PAID_OTHER_MONTH: META.pago("Recebido em outro mês"),
  UPCOMING: META.alerta("A vencer"),
  PARTIAL: META.alerta("Parcial"),
  OVERDUE: META.devendo("Devendo"),
  DELINQUENT: META.devendo("Inadimplente"),
  REMOVED: META.neutro("Removido do mês"),
};

/** Meta do status do ciclo — cai em neutro para valores desconhecidos. */
export function cycleStatusMeta(status: string): StatusMeta {
  return CYCLE_STATUS_META[status] ?? META.neutro(status);
}

// BillingStatus cru (PENDING/PARTIAL/PAID/OVERDUE/CANCELED) — telas fora do ciclo.
export const BILLING_STATUS_META: Record<string, StatusMeta> = {
  PAID: META.pago("Paga"),
  PENDING: META.alerta("A vencer"),
  PARTIAL: META.alerta("Parcial"),
  OVERDUE: META.devendo("Devendo"),
  CANCELED: META.neutro("Cancelada"),
};

// ===========================================================================
// Despesas — Transaction.status (string) + vencimento derivado
// ===========================================================================

/**
 * Despesa não grava "vencida" no banco: DEVENDO é derivado de
 * status pendente + dueDate no passado (mesma regra de /despesas).
 */
export function expenseStatusMeta(
  status: string | null | undefined,
  dueDate: Date | null | undefined,
  today: Date = new Date()
): StatusMeta {
  if (status === "pago") return META.pago("Paga");
  if (status === "cancelado") return META.neutro("Cancelada");
  if (status === "reembolsado") return META.neutro("Reembolsada");
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (status === "devendo") return META.devendo("Devendo");
  if (dueDate && dueDate < t) return META.devendo("Devendo");
  return META.alerta("A vencer");
}

// ===========================================================================
// Folha — PayrollStatus / CommissionStatus
// ===========================================================================

export const PAYROLL_STATUS_META: Record<string, StatusMeta> = {
  DRAFT: META.neutro("Rascunho"),
  APPROVED: META.alerta("Aprovada"),
  PAID: META.pago("Paga"),
};

export function payrollStatusMeta(status: string): StatusMeta {
  return PAYROLL_STATUS_META[status] ?? META.neutro(status);
}

// ===========================================================================
// Receitas (Income.status string)
// ===========================================================================

export const INCOME_STATUS_META: Record<string, StatusMeta> = {
  RECEIVED: META.pago("Recebido"),
  EXPECTED: META.alerta("Previsto"),
  LATE: META.devendo("Devendo"),
  CANCELED: META.neutro("Cancelado"),
};

export function incomeStatusMeta(status: string): StatusMeta {
  return INCOME_STATUS_META[status] ?? META.neutro(status);
}
