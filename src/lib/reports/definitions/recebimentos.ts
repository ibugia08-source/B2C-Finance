import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

// ===== Fechamento mensal: recebimentos, atrasados, outro mês, receita extra =====

/** Pagamentos do período classificados pela regra de fechamento mensal. */
async function paymentsWithClosing(q: ReportQuery) {
  const { start, end } = q.period;
  const payments = await prisma.payment.findMany({
    where: {
      status: "CONFIRMED",
      paidAt: { gte: start, lt: end },
      billing: {
        status: { not: "CANCELED" },
        ...(q.clientId ? { clientId: q.clientId } : {}),
      },
    },
    orderBy: { paidAt: "desc" },
    select: {
      amount: true,
      paidAt: true,
      method: true,
      billing: {
        select: {
          description: true, dueDate: true, revenueType: true,
          competenceMonth: true, competenceYear: true, collector: true,
          client: { select: { name: true, salesOwner: true } },
        },
      },
    },
  });
  return payments.map((p) => {
    const b = p.billing;
    const compKey = b.competenceYear * 12 + (b.competenceMonth - 1);
    const paidKey = p.paidAt.getFullYear() * 12 + p.paidAt.getMonth();
    return {
      cliente: b.client.name,
      descricao: b.description,
      modalidade: b.revenueType,
      competencia: `${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear}`,
      vencimento: b.dueDate,
      pagoEm: p.paidAt,
      responsavel: b.collector ?? b.client.salesOwner,
      situacao:
        paidKey > compKey
          ? "Pago em outro mês (Receita Extra)"
          : p.paidAt > b.dueDate
            ? "Pago com atraso"
            : "Pago no prazo",
      _late: paidKey === compKey && p.paidAt > b.dueDate,
      _otherMonth: paidKey > compKey,
      valor: n(p.amount),
    };
  });
}

/** Recebimentos do período (pagamentos, com a classificação do fechamento). */
async function buildRecebimentos(q: ReportQuery): Promise<ReportRow[]> {
  const rows = await paymentsWithClosing(q);
  return rows.map(({ _late, _otherMonth, ...r }) => r);
}

/** Só os pagos com atraso (dentro do mês de competência). */
async function buildPagamentosAtrasados(q: ReportQuery): Promise<ReportRow[]> {
  const rows = await paymentsWithClosing(q);
  return rows.filter((r) => r._late).map(({ _late, _otherMonth, ...r }) => r);
}

/** Só os pagos em mês diferente da competência (viraram Receita Extra). */
async function buildPagosOutroMes(q: ReportQuery): Promise<ReportRow[]> {
  const rows = await paymentsWithClosing(q);
  return rows.filter((r) => r._otherMonth).map(({ _late, _otherMonth, ...r }) => r);
}

export const recebimentosReport: ReportDef = {
  key: "recebimentos",
  title: "Recebimentos do período",
  description: "Pagamentos recebidos com a classificação do fechamento mensal (no prazo, com atraso, em outro mês).",
  columns: [
    { key: "pagoEm", label: "Pago em", kind: "date" },
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "descricao", label: "Descrição", kind: "text" },
    { key: "modalidade", label: "Modalidade", kind: "text" },
    { key: "competencia", label: "Competência", kind: "text" },
    { key: "vencimento", label: "Vencimento", kind: "date" },
    { key: "situacao", label: "Situação", kind: "text" },
    { key: "responsavel", label: "Responsável", kind: "text" },
    { key: "valor", label: "Valor", kind: "money", total: true },
  ],
  filterFields: ["periodo", "cliente"],
  groupOptions: ["situacao", "modalidade", "cliente", "competencia"],
  defaultSort: { key: "pagoEm", dir: "desc" },
  build: buildRecebimentos,
};
