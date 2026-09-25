import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

/**
 * Competências (ano/mês) que o período cobre. Mesma leitura do card "TCV
 * faturado" do Dashboard: o TCV pertence ao mês da COMPETÊNCIA (adesão/
 * renovação), não ao do vencimento. Antes o relatório filtrava por dueDate e
 * uma cobrança de agosto que vence em setembro saía de agosto aqui e ficava
 * em agosto no Dashboard.
 */
function competenciasDoPeriodo(q: ReportQuery): { competenceYear: number; competenceMonth: number }[] {
  const { start, end } = q.period;
  const out: { competenceYear: number; competenceMonth: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const fim = new Date(end);
  fim.setDate(fim.getDate() - 1);
  const ultimo = new Date(fim.getFullYear(), fim.getMonth(), 1);
  while (cur <= ultimo && out.length < 240) {
    out.push({ competenceYear: cur.getFullYear(), competenceMonth: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

/** Cobranças TCV do período (valor cheio no mês da adesão/renovação). */
async function buildTcv(q: ReportQuery): Promise<ReportRow[]> {
  const competencias = competenciasDoPeriodo(q);
  if (competencias.length === 0) return [];
  const billings = await prisma.billing.findMany({
    where: {
      revenueType: "TCV",
      status: { not: "CANCELED" },
      OR: competencias,
      ...(q.clientId ? { clientId: q.clientId } : {}),
    },
    orderBy: [{ competenceYear: "asc" }, { competenceMonth: "asc" }, { dueDate: "asc" }],
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
  description: "Cobranças TCV cuja competência cai no período — valor cheio no mês da adesão/renovação.",
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
