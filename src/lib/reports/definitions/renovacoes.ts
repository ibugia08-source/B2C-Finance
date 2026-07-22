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

/** Projeção financeira — próximos 6 meses (MRR + renovações TCV − despesas). */
async function buildProjecaoFinanceira(): Promise<ReportRow[]> {
  const now = new Date();
  const outlook = await getRenewalOutlook([0, 1, 2, 3, 4, 5]);
  const rows: ReportRow[] = [];
  for (let i = 0; i < 6; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const [revenue, expenseAgg] = await Promise.all([
      getPeriodRevenue(start, end, {}),
      prisma.transaction.aggregate({
        where: {
          type: "despesa",
          status: { not: "cancelado" },
          dueDate: { gte: start, lt: end },
        },
        _sum: { amount: true },
      }),
    ]);
    const window = outlook[i];
    const tcvEsperado = window
      ? window.clients.filter((c) => c.modality === "TCV").reduce((s, c) => s + c.expected, 0)
      : 0;
    const despesasPrevistas = n(expenseAgg._sum.amount);
    const receitaProjetada = revenue.mrr + Math.max(revenue.tcv, tcvEsperado);
    rows.push({
      mes: `${String(start.getMonth() + 1).padStart(2, "0")}/${start.getFullYear()}`,
      mrrPrevisto: revenue.mrr,
      tcvEsperado: Math.max(revenue.tcv, tcvEsperado),
      receitaProjetada,
      despesasPrevistas,
      resultadoProjetado: receitaProjetada - despesasPrevistas,
    });
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
