import { prisma } from "@/lib/prisma";
import { getPeriodRevenue, getRenewalOutlook } from "@/lib/services/revenue-metrics";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import {
  CLIENT_STATUS_LABEL,
  MODALITY_LABEL,
  type ReportDef,
  type ReportRow,
} from "../shared";

/** Renovações — mês atual até 5 meses à frente, por cliente. */
async function buildRenovacoes(q: ReportQuery): Promise<ReportRow[]> {
  const outlook = await getRenewalOutlook([0, 1, 2, 3, 4, 5]);
  const rows: ReportRow[] = [];
  for (const w of outlook) {
    for (const c of w.clients) {
      if (q.responsavel && !(c.salesOwner ?? "").toLowerCase().includes(q.responsavel.toLowerCase()))
        continue;
      rows.push({
        mes: w.label,
        cliente: c.name,
        modalidade: c.modality ? MODALITY_LABEL[c.modality] ?? c.modality : null,
        responsavel: c.salesOwner,
        status: CLIENT_STATUS_LABEL[c.status] ?? c.status,
        valorEsperado: c.expected,
      });
    }
  }
  return rows;
}

export const renovacoesReport: ReportDef = {
  key: "renovacoes",
  title: "Renovações",
  description: "Clientes com renovação do mês atual a 5 meses à frente, com valor esperado.",
  columns: [
    { key: "mes", label: "Mês", kind: "text" },
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "modalidade", label: "Modalidade", kind: "text" },
    { key: "responsavel", label: "Responsável", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "valorEsperado", label: "Valor esperado", kind: "money", total: true },
  ],
  filterFields: ["responsavel"],
  groupOptions: ["mes", "responsavel", "modalidade"],
  defaultSort: { key: "mes", dir: "asc" },
  build: buildRenovacoes,
};
