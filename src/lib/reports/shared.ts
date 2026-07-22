import { type ReportQuery } from "./query";

/**
 * Tipos e helpers compartilhados entre as definições de relatórios.
 * Formatação acontece na renderização e na exportação — os dados
 * originais nunca são alterados.
 */

export type ColumnKind = "text" | "money" | "int" | "percent" | "date";

export type ReportColumn = {
  key: string;
  label: string;
  kind: ColumnKind;
  /** entra na linha de totais/subtotais */
  total?: boolean;
};

export type FilterField =
  | "periodo"
  | "cliente"
  | "servico"
  | "contrato"
  | "status"
  | "categoria"
  | "responsavel"
  | "tipo"
  | "valor"
  | "vencimento"
  | "competencia"
  | "pago"
  | "situacao";

export type ReportRow = Record<string, string | number | Date | null>;

export type ReportDef = {
  key: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  filterFields: FilterField[];
  /** keys de colunas pelas quais dá para agrupar */
  groupOptions: string[];
  /** opções do select "status" (por domínio) e "tipo" quando aplicável */
  statusOptions?: { value: string; label: string }[];
  tipoOptions?: { value: string; label: string }[];
  defaultSort: { key: string; dir: "asc" | "desc" };
  /** default de período diferente de "mes" (ex.: ano p/ relatório mensal) */
  defaultPeriodo?: string;
  build: (q: ReportQuery) => Promise<ReportRow[]>;
};

export const CLIENT_STATUS_LABEL: Record<string, string> = {
  LEAD: "Lead",
  PROSPECT: "Prospect",
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  PAUSED: "Pausado",
  RENEWAL: "Renovação",
  DELINQUENT: "Inadimplente",
  CHURNED: "Perdido",
};

export const MODALITY_LABEL: Record<string, string> = { MRR: "MRR", TCV: "TCV" };

/** Meses (1º dia) que intersectam o período, cap 24. */
export function monthsInPeriod(q: ReportQuery): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  const cur = new Date(q.period.start.getFullYear(), q.period.start.getMonth(), 1);
  const endD = new Date(q.period.end);
  endD.setDate(endD.getDate() - 1);
  const last = new Date(endD.getFullYear(), endD.getMonth(), 1);
  while (cur <= last && out.length < 24) {
    out.push({ y: cur.getFullYear(), m: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}
