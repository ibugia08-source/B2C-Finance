/** Metadados de cobrança compartilhados entre telas (server e client). */

export const BILLING_STATUS_LABEL: Record<string, string> = {
  PENDING: "Em aberto",
  PARTIAL: "Parcial",
  PAID: "Paga",
  OVERDUE: "Vencida",
  CANCELED: "Cancelada",
};

export const COLLECTION_STATUS_LABEL: Record<string, string> = {
  NOT_CONTACTED: "Sem contato",
  CONTACTED: "Contatado",
  PROMISED: "Prometeu pagar",
  PAID: "Pago",
  IGNORED: "Sem resposta",
  ESCALATED: "Escalado",
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  PIX: "Pix",
  TRANSFER: "Transferência",
  BOLETO: "Boleto",
  CARD: "Cartão",
  CASH: "Dinheiro",
  OTHER: "Outro",
};

export const REVENUE_TYPE_LABEL: Record<string, string> = {
  MRR: "Recorrente",
  TCV: "Contrato fechado",
  ONE_TIME: "Avulsa",
  SETUP: "Setup",
  RECOVERY: "Recuperação",
  OTHER: "Outra",
};

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "outline";

export function billingStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "PAID":
      return "success";
    case "PARTIAL":
    case "PENDING":
      return "warning";
    case "OVERDUE":
      return "destructive";
    default:
      return "secondary";
  }
}
