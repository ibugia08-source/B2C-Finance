import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

/** Cobranças TCV do período (valor cheio no mês da adesão/renovação). */
async function buildTcv(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const billings = await prisma.billing.findMany({
    where: {
      revenueType: "TCV",
      status: { not: "CANCELED" },
      dueDate: { gte: start, lt: end },
      ...(q.clientId ? { clientId: q.clientId } : {}),
    },
    orderBy: { dueDate: "asc" },
    select: {
      description: true, amount: true, paidTotal: true, status: true,
      competenceMonth: true, competenceYear: true, dueDate: true,
      client: { select: { name: true, salesOwner: true } },
    },
  });
  return billings.map((b) => ({
    cliente: b.client.name,
    descricao: b.description,
    competencia: `${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear}`,
    vencimento: b.dueDate,
    responsavel: b.client.salesOwner,
    situacao: b.status === "PAID" ? "Paga" : b.status === "OVERDUE" ? "Vencida" : "Em aberto",
    valor: n(b.amount),
    recebido: n(b.paidTotal),
  }));
}

export const tcvReport: ReportDef = {
  key: "tcv",
  title: "TCV (contratos fechados)",
  description: "Cobranças TCV do período — valor cheio no mês da adesão/renovação.",
  columns: [
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "descricao", label: "Descrição", kind: "text" },
    { key: "competencia", label: "Competência", kind: "text" },
    { key: "vencimento", label: "Vencimento", kind: "date" },
    { key: "responsavel", label: "Responsável", kind: "text" },
    { key: "situacao", label: "Situação", kind: "text" },
    { key: "valor", label: "Valor", kind: "money", total: true },
    { key: "recebido", label: "Recebido", kind: "money", total: true },
  ],
  filterFields: ["periodo", "cliente"],
  groupOptions: ["cliente", "competencia", "situacao"],
  defaultSort: { key: "vencimento", dir: "asc" },
  build: buildTcv,
};
