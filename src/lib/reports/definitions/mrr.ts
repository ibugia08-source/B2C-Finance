import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { CLIENT_STATUS_LABEL, type ReportDef, type ReportRow } from "../shared";

/** Clientes MRR ativos com valor mensal (base do MRR). */
async function buildMrr(q: ReportQuery): Promise<ReportRow[]> {
  const where: Record<string, unknown> = {
    modality: "MRR",
    status: { in: ["ACTIVE", "RENEWAL", "DELINQUENT"] },
  };
  if (q.clientId) where.id = q.clientId;
  if (q.responsavel)
    where.salesOwner = { contains: q.responsavel, mode: "insensitive" };
  const clients = await prisma.client.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      name: true, status: true, segment: true, salesOwner: true,
      monthlyValue: true, renewalMonth: true,
    },
  });
  return clients.map((c) => ({
    cliente: c.name,
    status: CLIENT_STATUS_LABEL[c.status] ?? c.status,
    segmento: c.segment,
    responsavel: c.salesOwner,
    mensal: n(c.monthlyValue),
    anualizado: n(c.monthlyValue) * 12,
    renovacao: c.renewalMonth ? String(c.renewalMonth).padStart(2, "0") : null,
  }));
}

export const mrrReport: ReportDef = {
  key: "mrr",
  title: "MRR (recorrência)",
  description: "Clientes MRR ativos com valor mensal e anualizado.",
  columns: [
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "segmento", label: "Segmento", kind: "text" },
    { key: "responsavel", label: "Responsável", kind: "text" },
    { key: "mensal", label: "MRR mensal", kind: "money", total: true },
    { key: "anualizado", label: "Anualizado", kind: "money", total: true },
    { key: "renovacao", label: "Mês renovação", kind: "text" },
  ],
  filterFields: ["cliente", "responsavel"],
  groupOptions: ["responsavel", "segmento", "status"],
  defaultSort: { key: "mensal", dir: "desc" },
  build: buildMrr,
};
