import { formatBRL, formatDateBR } from "@/lib/format";
import type { ReportColumn, ReportDef, ReportRow } from "./registry";
import type { ReportPresentation } from "./query";

/**
 * Apresentação de relatórios: seleção de colunas, ordenação, agrupamento e
 * totais — funções puras sobre as linhas cruas (nunca alteram os dados).
 * Usadas pela página e pelas exportações para garantir o MESMO resultado.
 */

export type PresentedGroup = {
  label: string | null; // null = sem agrupamento
  rows: ReportRow[];
  subtotals: Record<string, number>;
};

export type PresentedReport = {
  columns: ReportColumn[];
  groups: PresentedGroup[];
  totals: Record<string, number>;
  rowCount: number;
};

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulos por último
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true });
}

function sumTotals(rows: ReportRow[], columns: ReportColumn[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const col of columns) {
    if (!col.total) continue;
    totals[col.key] = rows.reduce((s, r) => s + (typeof r[col.key] === "number" ? (r[col.key] as number) : 0), 0);
  }
  return totals;
}

export function presentReport(
  def: ReportDef,
  rows: ReportRow[],
  pres: ReportPresentation
): PresentedReport {
  // 1. colunas (subset na ordem da definição)
  const columns = pres.colunas?.length
    ? def.columns.filter((c) => pres.colunas!.includes(c.key))
    : def.columns;

  // 2. ordenação
  const sortKey = pres.ordenar ?? def.defaultSort.key;
  const dir = pres.ordenar ? pres.dir : def.defaultSort.dir;
  const sorted = [...rows].sort((a, b) => {
    const c = compare(a[sortKey], b[sortKey]);
    return dir === "desc" ? -c : c;
  });

  // 3. agrupamento (com subtotais por grupo)
  let groups: PresentedGroup[];
  const groupKey = pres.agrupar && def.groupOptions.includes(pres.agrupar) ? pres.agrupar : undefined;
  if (groupKey) {
    const map = new Map<string, ReportRow[]>();
    for (const r of sorted) {
      const label = formatCell(r[groupKey], def.columns.find((c) => c.key === groupKey)?.kind ?? "text") || "—";
      const arr = map.get(label) ?? [];
      arr.push(r);
      map.set(label, arr);
    }
    groups = Array.from(map.entries())
      .map(([label, groupRows]) => ({
        label,
        rows: groupRows,
        subtotals: sumTotals(groupRows, columns),
      }))
      .sort((a, b) => {
        // grupos ordenados pelo maior subtotal da 1ª coluna monetária, senão alfabético
        const moneyCol = columns.find((c) => c.total)?.key;
        if (moneyCol) return (b.subtotals[moneyCol] ?? 0) - (a.subtotals[moneyCol] ?? 0);
        return a.label!.localeCompare(b.label!, "pt-BR");
      });
  } else {
    groups = [{ label: null, rows: sorted, subtotals: {} }];
  }

  return {
    columns,
    groups,
    totals: sumTotals(sorted, columns),
    rowCount: rows.length,
  };
}

/** Formata um valor cru para exibição/CSV segundo o tipo da coluna. */
export function formatCell(value: unknown, kind: ReportColumn["kind"]): string {
  if (value == null || value === "") return "";
  switch (kind) {
    case "money":
      return formatBRL(Number(value));
    case "percent":
      return `${Number(value)}%`;
    case "int":
      return String(value);
    case "date":
      return value instanceof Date ? formatDateBR(value) : formatDateBR(new Date(String(value)));
    default:
      return String(value);
  }
}

/** Valor "plano" para exportação XLSX (números como números, datas como dd/mm/aaaa). */
export function exportCell(value: unknown, kind: ReportColumn["kind"]): string | number {
  if (value == null) return "";
  if (kind === "money" || kind === "int" || kind === "percent") return Number(value);
  if (kind === "date") return formatCell(value, "date");
  return String(value);
}
