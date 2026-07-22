import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery, amountRange, dueDateRange } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  FIXED: "Fixa",
  VARIABLE: "Variável",
  PAYROLL: "Folha",
  TAX: "Imposto",
  TOOL: "Ferramenta",
  ADS: "Mídia/Ads",
  LOAN: "Empréstimo",
  CARD: "Cartão",
  OTHER: "Outra",
};

async function buildDespesas(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const where: Record<string, unknown> = {
    type: "despesa",
    status: { not: "cancelado" },
    date: { gte: start, lt: end },
  };
  if (q.clientId) where.clientId = q.clientId;
  if (q.serviceId) where.serviceId = q.serviceId;
  if (q.categoryId) where.categoryId = q.categoryId;
  if (q.tipo) where.expenseType = q.tipo;
  if (q.pago === true) where.status = "pago";
  if (q.pago === false) where.status = { in: ["pendente", "devendo"] };
  const range = amountRange(q);
  if (range) where.amount = range;
  const due = dueDateRange(q);
  if (due) where.dueDate = due;

  const txs = await prisma.transaction.findMany({
    where,
    orderBy: { date: "desc" },
    take: 1000,
    select: {
      date: true, description: true, amount: true, status: true,
      dueDate: true, expenseType: true,
      category: { select: { name: true } },
      client: { select: { name: true } },
    },
  });
  return txs.map((t) => ({
    data: t.date,
    descricao: t.description,
    categoria: t.category?.name ?? null,
    tipo: t.expenseType ? EXPENSE_TYPE_LABEL[t.expenseType] ?? t.expenseType : null,
    cliente: t.client?.name ?? null,
    situacao: t.status === "pago" ? "Paga" : t.status === "pendente" ? "Pendente" : t.status,
    vencimento: t.dueDate,
    valor: n(t.amount),
  }));
}

export const despesasReport: ReportDef = {
  key: "despesas",
  title: "Despesas",
  description: "Despesas do período com categoria e tipo.",
  columns: [
    { key: "data", label: "Data", kind: "date" },
    { key: "descricao", label: "Descrição", kind: "text" },
    { key: "categoria", label: "Categoria", kind: "text" },
    { key: "tipo", label: "Tipo", kind: "text" },
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "situacao", label: "Situação", kind: "text" },
    { key: "vencimento", label: "Vencimento", kind: "date" },
    { key: "valor", label: "Valor", kind: "money", total: true },
  ],
  filterFields: ["periodo", "cliente", "servico", "categoria", "tipo", "valor", "vencimento", "pago"],
  groupOptions: ["categoria", "tipo", "cliente", "situacao"],
  tipoOptions: Object.entries(EXPENSE_TYPE_LABEL).map(([value, label]) => ({ value, label })),
  defaultSort: { key: "data", dir: "desc" },
  build: buildDespesas,
};
