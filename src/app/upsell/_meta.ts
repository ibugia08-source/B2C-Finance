/** Metadados de status de Upsell compartilhados entre telas (sem @prisma/client). */

export const UPSELL_STATUSES = [
  "OPPORTUNITY",
  "NEGOTIATION",
  "WON",
  "LOST",
  "PAUSED",
] as const;

export type UpsellStatusValue = (typeof UPSELL_STATUSES)[number];

export const UPSELL_STATUS_LABEL: Record<UpsellStatusValue, string> = {
  OPPORTUNITY: "Oportunidade",
  NEGOTIATION: "Em negociação",
  WON: "Vendido",
  LOST: "Perdido",
  PAUSED: "Pausado",
};

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "outline";

export function upsellStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "WON":
      return "success";
    case "NEGOTIATION":
      return "warning";
    case "LOST":
      return "destructive";
    case "PAUSED":
      return "secondary";
    default: // OPPORTUNITY
      return "default";
  }
}
