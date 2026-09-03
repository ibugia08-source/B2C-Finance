import type { BadgeVariant } from "@/lib/status-meta";
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

/**
 * Colunas do Kanban de upsell — as 4 etapas do funil do dono. PAUSED não tem
 * coluna própria: aparece na primeira com badge "pausado".
 */
export const KANBAN_COLUMNS: {
  key: UpsellStatusValue;
  label: string;
  statuses: UpsellStatusValue[];
}[] = [
  { key: "OPPORTUNITY", label: "Oportunidade de Upsell", statuses: ["OPPORTUNITY", "PAUSED"] },
  { key: "NEGOTIATION", label: "Apresentação de oportunidade", statuses: ["NEGOTIATION"] },
  { key: "WON", label: "Upsell vendido", statuses: ["WON"] },
  { key: "LOST", label: "Upsell recusado", statuses: ["LOST"] },
];



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
