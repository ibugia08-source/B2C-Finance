import { prisma } from "@/lib/prisma";
import { getDelinquentClients } from "@/lib/services/billing-metrics";
import { type ReportQuery, amountRange } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

async function buildInadimplencia(q: ReportQuery): Promise<ReportRow[]> {
  let list = await getDelinquentClients();
  if (q.clientId) {
    const c = await prisma.client.findUnique({ where: { id: q.clientId }, select: { name: true } });
    list = list.filter((d) => d.clientName === c?.name);
  }
  const range = amountRange(q);
  if (range)
    list = list.filter(
      (d) => (range.gte == null || d.totalOverdue >= range.gte) && (range.lte == null || d.totalOverdue <= range.lte)
    );
  return list.map((d) => ({
    cliente: d.clientName,
    valorVencido: d.totalOverdue,
    cobrancas: d.billingCount,
    diasAtraso: d.daysOverdue,
    faixa: d.bucket,
    ultimoContato: d.lastContactAt,
    statusContato: d.lastContactStatus,
  }));
}

export const inadimplenciaReport: ReportDef = {
  key: "inadimplencia",
  title: "Inadimplência",
  description: "Clientes com valores vencidos, aging e último contato.",
  columns: [
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "valorVencido", label: "Valor vencido", kind: "money", total: true },
    { key: "cobrancas", label: "Cobranças", kind: "int", total: true },
    { key: "diasAtraso", label: "Dias em atraso", kind: "int" },
    { key: "faixa", label: "Faixa", kind: "text" },
    { key: "ultimoContato", label: "Último contato", kind: "date" },
    { key: "statusContato", label: "Retorno", kind: "text" },
  ],
  filterFields: ["cliente", "valor"],
  groupOptions: ["faixa"],
  defaultSort: { key: "valorVencido", dir: "desc" },
  build: buildInadimplencia,
};
