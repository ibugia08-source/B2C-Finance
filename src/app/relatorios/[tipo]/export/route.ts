import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/permissions";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { getReport } from "@/lib/reports/registry";
import {
  parseReportQuery,
  parsePresentation,
  type SearchParams,
} from "@/lib/reports/query";
import { presentReport, formatCell, exportCell } from "@/lib/reports/present";

export const dynamic = "force-dynamic";

/**
 * Exportação de relatórios (?formato=csv|xlsx) com os MESMOS filtros,
 * colunas e ordenação da tela — a querystring é compartilhada.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { tipo: string } }
) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "relatorios.exportar")) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }
  const def = getReport(params.tipo);
  if (!def) return NextResponse.json({ error: "Relatório inexistente" }, { status: 404 });

  const sp: SearchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const formato = sp.formato === "xlsx" ? "xlsx" : "csv";

  await markOverdueBillings();
  const query = parseReportQuery(sp);
  const pres = parsePresentation(sp);
  const rows = await def.build(query);
  // exportação: sem agrupamento visual — linhas planas ordenadas
  const presented = presentReport(def, rows, { ...pres, agrupar: undefined });
  const flat = presented.groups.flatMap((g) => g.rows);
  const columns = presented.columns;

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${def.key}-${stamp}.${formato}`;

  if (formato === "xlsx") {
    const data = flat.map((r) =>
      Object.fromEntries(columns.map((c) => [c.label, exportCell(r[c.key], c.kind)]))
    );
    if (pres.totais && Object.keys(presented.totals).length > 0) {
      data.push(
        Object.fromEntries(
          columns.map((c, i) => [
            c.label,
            i === 0 && presented.totals[c.key] == null
              ? "TOTAL"
              : presented.totals[c.key] != null
                ? presented.totals[c.key]
                : "",
          ])
        )
      );
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, def.title.slice(0, 31));
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // CSV pt-BR: ; como separador, BOM para Excel, valores formatados
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines: string[] = [];
  lines.push(columns.map((c) => esc(c.label)).join(";"));
  for (const r of flat) {
    lines.push(columns.map((c) => esc(formatCell(r[c.key], c.kind))).join(";"));
  }
  if (pres.totais && Object.keys(presented.totals).length > 0) {
    lines.push(
      columns
        .map((c, i) =>
          i === 0 && presented.totals[c.key] == null
            ? "TOTAL"
            : presented.totals[c.key] != null
              ? esc(formatCell(presented.totals[c.key], c.kind === "int" ? "int" : "money"))
              : ""
        )
        .join(";")
    );
  }
  const csv = "\uFEFF" + lines.join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
