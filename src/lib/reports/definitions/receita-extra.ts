import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

const EXTRA_TYPE_LABEL: Record<string, string> = {
  RECOVERY_OF_OVERDUE: "Recuperação de inadimplência",
  MANUAL_EXTRA_REVENUE: "Lançamento manual",
  ONE_TIME_SERVICE: "Serviço pontual",
  ADJUSTMENT: "Ajuste",
  OTHER: "Outra",
};

/** Receitas Extras do período (automáticas + manuais + avulsas). */
async function buildReceitaExtra(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const [extras, loose] = await Promise.all([
    prisma.extraRevenue.findMany({
      // Receita Extra é apenas MANUAL (automáticas legadas ficam fora).
      where: {
        receivedAt: { gte: start, lt: end },
        origin: "MANUAL",
        ...(q.clientId ? { clientId: q.clientId } : {}),
      },
      orderBy: { receivedAt: "desc" },
      select: {
        description: true, amount: true, receivedAt: true, type: true, origin: true,
        originalReferenceMonth: true, originalReferenceYear: true,
        client: { select: { name: true } },
      },
    }),
    prisma.income.findMany({
      where: {
        status: "RECEIVED",
        billingId: null,
        receivedAt: { gte: start, lt: end },
        ...(q.clientId ? { clientId: q.clientId } : {}),
      },
      orderBy: { receivedAt: "desc" },
      select: {
        description: true, amount: true, receivedAt: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  return [
    ...extras.map((e) => ({
      data: e.receivedAt,
      cliente: e.client?.name ?? null,
      descricao: e.description,
      tipo: EXTRA_TYPE_LABEL[e.type] ?? e.type,
      origem: e.origin === "AUTOMATIC" ? "Automática" : "Manual",
      competenciaOriginal: e.originalReferenceMonth
        ? `${String(e.originalReferenceMonth).padStart(2, "0")}/${e.originalReferenceYear}`
        : null,
      valor: n(e.amount),
    })),
    ...loose.map((i) => ({
      data: i.receivedAt,
      cliente: i.client?.name ?? null,
      descricao: i.description || "Receita avulsa",
      tipo: "Entrada avulsa",
      origem: "Manual",
      competenciaOriginal: null,
      valor: n(i.amount),
    })),
  ].sort((a, b) => (b.data as Date).getTime() - (a.data as Date).getTime());
}

export const receitaExtraReport: ReportDef = {
  key: "receita-extra",
  title: "Receita Extra",
  description: "Lançamentos manuais de Receita Extra e entradas avulsas do período.",
  columns: [
    { key: "data", label: "Recebida em", kind: "date" },
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "descricao", label: "Descrição", kind: "text" },
    { key: "tipo", label: "Tipo", kind: "text" },
    { key: "origem", label: "Origem", kind: "text" },
    { key: "competenciaOriginal", label: "Competência original", kind: "text" },
    { key: "valor", label: "Valor", kind: "money", total: true },
  ],
  filterFields: ["periodo", "cliente"],
  groupOptions: ["tipo", "origem", "cliente"],
  defaultSort: { key: "data", dir: "desc" },
  build: buildReceitaExtra,
};
