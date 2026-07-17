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

// ===== Paginação da lista de clientes =====
// Vive aqui (módulo neutro, sem "use client") para poder ser usado tanto no
// server component (page.tsx) quanto no seletor client (page-size-select).
export const PAGE_SIZES = [20, 40, 100] as const;

// ===== Modalidade (MRR/TCV) =====
export const CLIENT_MODALITIES = ["MRR", "TCV"] as const;
export type ClientModalityValue = (typeof CLIENT_MODALITIES)[number];
export const CLIENT_MODALITY_LABEL: Record<ClientModalityValue, string> = {
  MRR: "MRR",
  TCV: "TCV",
};

// ===== Inadimplência do mês =====
export const DELINQUENCY_VALUES = ["PAGO", "DEVENDO"] as const;
export type DelinquencyValue = (typeof DELINQUENCY_VALUES)[number];
export const DELINQUENCY_LABEL: Record<DelinquencyValue | "SEM_COBRANCA", string> = {
  PAGO: "Pago",
  DEVENDO: "Devendo",
  SEM_COBRANCA: "Sem cobrança",
};

// ===== Meses (mês de renovação) =====
export const MONTHS: { value: number; label: string }[] = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];
export const MONTH_LABEL: Record<number, string> = Object.fromEntries(
  MONTHS.map((m) => [m.value, m.label])
);

/**
 * Classes de "pill" suave para os selects inline (estética Apple/macOS,
 * fundo tinta clara). Usadas nos editores inline de status/modalidade/
 * inadimplência da carteira.
 */
export function clientStatusPill(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30";
    case "RENEWAL":
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30";
    case "DELINQUENT":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30";
    case "PAUSED":
      return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30";
    case "CHURNED":
    case "INACTIVE":
      return "bg-muted text-muted-foreground border-transparent";
    default: // PROSPECT / LEAD
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30";
  }
}

export function delinquencyPill(value: DelinquencyValue | "SEM_COBRANCA"): string {
  switch (value) {
    case "PAGO":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30";
    case "DEVENDO":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30";
    default:
      return "bg-muted text-muted-foreground border-transparent";
  }
}

export function modalityPill(value: string | null): string {
  switch (value) {
    case "MRR":
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30";
    case "TCV":
      return "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30";
    default:
      return "bg-muted text-muted-foreground border-transparent";
  }
}
