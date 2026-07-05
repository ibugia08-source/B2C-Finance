/** Metadados de contratos compartilhados entre telas (server e client). */

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  ACTIVE: "Ativo",
  RENEWAL: "Em renovação",
  OVERDUE: "Vencido",
  ENDED: "Encerrado",
  CANCELED: "Cancelado",
};

export const CONTRACT_TYPE_LABEL: Record<string, string> = {
  MRR: "Recorrente (MRR)",
  TCV: "Contrato fechado (TCV)",
  ONE_TIME: "Projeto avulso",
  SETUP: "Setup / implantação",
  CUSTOM: "Personalizado",
};

export const RECURRENCE_LABEL: Record<string, string> = {
  NONE: "Sem recorrência",
  MONTHLY: "Mensal",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
  CUSTOM: "Personalizada",
};

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "outline";

export function contractStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "RENEWAL":
      return "warning";
    case "OVERDUE":
      return "destructive";
    case "PENDING":
      return "secondary";
    default:
      return "outline";
  }
}
