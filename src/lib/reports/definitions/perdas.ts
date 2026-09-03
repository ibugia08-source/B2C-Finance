import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { MODALITY_LABEL, type ReportDef, type ReportRow } from "../shared";

/** Perdas de clientes no período (registros de churn). */
async function buildPerdas(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const losses = await prisma.clientLoss.findMany({
    where: {
      lostAt: { gte: start, lt: end },
      ...(q.clientId ? { clientId: q.clientId } : {}),
    },
    orderBy: { lostAt: "desc" },
    select: {
      lostAt: true, reason: true, modality: true, salesOwner: true,
      monthlyValue: true, referenceValue: true,
      client: { select: { name: true } },
    },
  });
  let rows = losses.map((l) => ({
    data: l.lostAt,
    cliente: l.client.name,
    modalidade: l.modality ? MODALITY_LABEL[l.modality] ?? l.modality : null,
    responsavel: l.salesOwner,
    motivo: l.reason,
    receitaPerdida:
      l.modality === "TCV"
        ? n(l.referenceValue) || n(l.monthlyValue)
        : n(l.monthlyValue) || n(l.referenceValue),
  }));
  if (q.responsavel)
    rows = rows.filter((r) =>
      (r.responsavel ?? "").toLowerCase().includes(q.responsavel!.toLowerCase())
    );
  return rows;
}

export const perdasReport: ReportDef = {
  key: "perdas",
  title: "Perdas de clientes",
  description: "Clientes perdidos no período: data, motivo, responsável e receita perdida.",
  columns: [
    { key: "data", label: "Data da perda", kind: "date" },
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "modalidade", label: "Modalidade", kind: "text" },
    { key: "responsavel", label: "Responsável", kind: "text" },
    { key: "motivo", label: "Motivo", kind: "text" },
    { key: "receitaPerdida", label: "Receita perdida", kind: "money", total: true },
  ],
  filterFields: ["periodo", "cliente", "responsavel"],
  groupOptions: ["responsavel", "modalidade"],
  defaultSort: { key: "data", dir: "desc" },
  build: buildPerdas,
};
