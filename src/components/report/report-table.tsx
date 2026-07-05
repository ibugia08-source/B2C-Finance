import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { PresentedReport } from "@/lib/reports/present";
import { formatCell } from "@/lib/reports/present";
import { cn } from "@/lib/utils";

/** Tabela de relatório: grupos com subtotais + linha de totais gerais. */
export function ReportTable({
  presented,
  showTotals,
}: {
  presented: PresentedReport;
  showTotals: boolean;
}) {
  const { columns, groups, totals, rowCount } = presented;
  const grouped = groups.length > 0 && groups[0].label !== null;

  if (rowCount === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        Nenhum registro com os filtros aplicados.
      </p>
    );
  }

  const numericAlign = (kind: string) =>
    kind === "money" || kind === "int" || kind === "percent" ? "text-right" : "";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.key} className={numericAlign(c.kind)}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group, gi) => (
          <GroupRows
            key={gi}
            group={group}
            columns={columns}
            grouped={grouped}
            showTotals={showTotals}
          />
        ))}
        {showTotals && Object.keys(totals).length > 0 && (
          <TableRow className="bg-muted/60">
            {columns.map((c, i) => (
              <TableCell key={c.key} className={cn("font-bold", numericAlign(c.kind))}>
                {i === 0 && totals[c.key] == null
                  ? `Total (${rowCount} linhas)`
                  : totals[c.key] != null
                    ? formatCell(totals[c.key], c.kind === "int" ? "int" : c.kind === "percent" ? "percent" : "money")
                    : ""}
              </TableCell>
            ))}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function GroupRows({
  group,
  columns,
  grouped,
  showTotals,
}: {
  group: PresentedReport["groups"][number];
  columns: PresentedReport["columns"];
  grouped: boolean;
  showTotals: boolean;
}) {
  const numericAlign = (kind: string) =>
    kind === "money" || kind === "int" || kind === "percent" ? "text-right" : "";
  return (
    <>
      {grouped && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={columns.length} className="font-semibold text-sm py-2">
            {group.label} <span className="text-xs text-muted-foreground font-normal">({group.rows.length})</span>
          </TableCell>
        </TableRow>
      )}
      {group.rows.map((row, ri) => (
        <TableRow key={ri}>
          {columns.map((c) => {
            const raw = row[c.key];
            const negative = c.kind === "money" && typeof raw === "number" && raw < 0;
            return (
              <TableCell
                key={c.key}
                className={cn(
                  numericAlign(c.kind),
                  c.kind === "money" && "tabular-nums",
                  negative && "text-red-600"
                )}
              >
                {formatCell(raw, c.kind) || "—"}
              </TableCell>
            );
          })}
        </TableRow>
      ))}
      {grouped && showTotals && Object.keys(group.subtotals).length > 0 && (
        <TableRow className="border-b-2">
          {columns.map((c, i) => (
            <TableCell key={c.key} className={cn("text-xs font-semibold text-muted-foreground", numericAlign(c.kind))}>
              {i === 0 && group.subtotals[c.key] == null
                ? "Subtotal"
                : group.subtotals[c.key] != null
                  ? formatCell(group.subtotals[c.key], c.kind === "int" ? "int" : "money")
                  : ""}
            </TableCell>
          ))}
        </TableRow>
      )}
    </>
  );
}
