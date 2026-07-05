/**
 * Metadados de status de Cliente compartilhados entre telas (server e client).
 * Mantido livre de imports de @prisma/client para poder ser usado com segurança
 * dentro de componentes client (o enum real vive nas Server Actions).
 */

export const CLIENT_STATUSES = [
  "PROSPECT",
  "ACTIVE",
  "PAUSED",
  "RENEWAL",
  "DELINQUENT",
  "CHURNED",
  "INACTIVE",
  "LEAD", // legado — preferir PROSPECT
] as const;

export type ClientStatusValue = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABEL: Record<ClientStatusValue, string> = {
  PROSPECT: "Prospecção",
  LEAD: "Lead / Prospecção",
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  PAUSED: "Pausado",
  RENEWAL: "Em renovação",
  DELINQUENT: "Inadimplente",
  CHURNED: "Perdido / Cancelado",
};

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "outline";

export function clientStatusVariant(status: string): BadgeVariant {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "RENEWAL":
      return "warning";
    case "DELINQUENT":
      return "destructive";
    case "CHURNED":
      return "outline";
    default:
      return "secondary";
  }
}
