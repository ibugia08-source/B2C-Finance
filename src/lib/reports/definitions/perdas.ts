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

/** Receita perdida por mês (últimos 12 meses). */
async function buildReceitaPerdida(): Promise<ReportRow[]> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const losses = await prisma.clientLoss.findMany({
    where: { lostAt: { gte: from } },
    select: { lostAt: true, modality: true, monthlyValue: true, referenceValue: true },
  });
  const byMonth = new Map<string, { count: number; value: number }>();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    byMonth.set(`${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`, {
      count: 0,
      value: 0,
    });
  }
  for (const l of losses) {
    const key = `${String(l.lostAt.getMonth() + 1).padStart(2, "0")}/${l.lostAt.getFullYear()}`;
    const cur = byMonth.get(key);
    if (!cur) continue;
    cur.count += 1;
    cur.value +=
      l.modality === "TCV"
        ? n(l.referenceValue) || n(l.monthlyValue)
        : n(l.monthlyValue) || n(l.referenceValue);
  }
  return Array.from(byMonth.entries()).map(([mes, v]) => ({
    mes,
    clientesPerdidos: v.count,
    receitaPerdida: v.value,
  }));
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
