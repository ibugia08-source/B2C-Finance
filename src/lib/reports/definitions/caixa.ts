import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery, amountRange } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

async function buildCaixa(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const [incomes, txs] = await Promise.all([
    prisma.income.findMany({
      where: {
        status: "RECEIVED",
        receivedAt: { gte: start, lt: end },
        ...(q.clientId ? { clientId: q.clientId } : {}),
      },
      select: { receivedAt: true, description: true, amount: true, client: { select: { name: true } } },
    }),
    prisma.transaction.findMany({
      where: {
        date: { gte: start, lt: end },
        status: { not: "cancelado" },
        type: { in: ["receita", "despesa"] },
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      },
      take: 2000,
      select: { date: true, description: true, amount: true, type: true, status: true },
    }),
  ]);
  const rows: ReportRow[] = [];
  for (const i of incomes) {
    rows.push({
      data: i.receivedAt,
      descricao: i.description || "Receita",
      origem: i.client?.name ?? "Receita",
      tipo: "Entrada",
      valor: n(i.amount),
    });
  }
  for (const t of txs) {
    if (t.type === "despesa" && t.status !== "pago") continue; // caixa = realizado
    rows.push({
      data: t.date,
      descricao: t.description,
      origem: t.type === "receita" ? "Receita (mov.)" : "Despesa",
      tipo: t.type === "receita" ? "Entrada" : "Saída",
      valor: t.type === "receita" ? n(t.amount) : -n(t.amount),
    });
  }
  const range = amountRange(q);
  return rows
    .filter((r) => {
      if (!range) return true;
      const abs = Math.abs(r.valor as number);
      return (range.gte == null || abs >= range.gte) && (range.lte == null || abs <= range.lte);
    })
    .sort((a, b) => (b.data as Date).getTime() - (a.data as Date).getTime());
}

export const caixaReport: ReportDef = {
  key: "caixa",
  title: "Fluxo de caixa",
  description: "Entradas e saídas realizadas no período (saldo nos totais).",
  columns: [
    { key: "data", label: "Data", kind: "date" },
    { key: "descricao", label: "Descrição", kind: "text" },
    { key: "origem", label: "Origem", kind: "text" },
    { key: "tipo", label: "Tipo", kind: "text" },
    { key: "valor", label: "Valor", kind: "money", total: true },
  ],
  filterFields: ["periodo", "cliente", "categoria", "valor"],
  groupOptions: ["tipo", "origem"],
  defaultSort: { key: "data", dir: "desc" },
  build: buildCaixa,
};
