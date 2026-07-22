import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery, amountRange } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

const CONTRACT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  ACTIVE: "Ativo",
  RENEWAL: "Em renovação",
  OVERDUE: "Vencido",
  ENDED: "Encerrado",
  CANCELED: "Cancelado",
};

async function buildContratos(q: ReportQuery): Promise<ReportRow[]> {
  const where: Record<string, unknown> = {};
  if (q.clientId) where.clientId = q.clientId;
  if (q.status) where.status = q.status;
  if (q.tipo) where.type = q.tipo;
  const contracts = await prisma.contract.findMany({
    where,
    orderBy: { startDate: "desc" },
    select: {
      title: true, type: true, recurrence: true, status: true,
      monthlyValue: true, totalValue: true, startDate: true, endDate: true,
      renewalDate: true, client: { select: { name: true } },
    },
  });
  let rows = contracts.map((c) => ({
    cliente: c.client.name,
    contrato: c.title,
    tipo: c.type,
    status: CONTRACT_STATUS_LABEL[c.status] ?? c.status,
    valorMensal: n(c.monthlyValue),
    valorTotal: n(c.totalValue),
    inicio: c.startDate,
    fim: c.endDate,
    renovacao: c.renewalDate,
  }));
  const range = amountRange(q);
  if (range)
    rows = rows.filter(
      (r) => (range.gte == null || r.valorTotal >= range.gte) && (range.lte == null || r.valorTotal <= range.lte)
    );
  if (q.situacao === "vencido") rows = rows.filter((r) => r.status === CONTRACT_STATUS_LABEL.OVERDUE);
  return rows;
}

export const contratosReport: ReportDef = {
  key: "contratos",
  title: "Acordos comerciais",
  description: "Acordos comerciais (contratos MRR/TCV) com valores, vigência e renovação.",
  columns: [
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "contrato", label: "Contrato", kind: "text" },
    { key: "tipo", label: "Tipo", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "valorMensal", label: "Valor mensal", kind: "money", total: true },
    { key: "valorTotal", label: "Valor total (TCV)", kind: "money", total: true },
    { key: "inicio", label: "Início", kind: "date" },
    { key: "fim", label: "Fim", kind: "date" },
    { key: "renovacao", label: "Renovação", kind: "date" },
  ],
  filterFields: ["cliente", "status", "tipo", "valor", "situacao"],
  groupOptions: ["cliente", "tipo", "status"],
  statusOptions: Object.entries(CONTRACT_STATUS_LABEL).map(([value, label]) => ({ value, label })),
  tipoOptions: [
    { value: "MRR", label: "Recorrente (MRR)" },
    { value: "TCV", label: "Fechado (TCV)" },
    { value: "ONE_TIME", label: "Avulso" },
    { value: "SETUP", label: "Setup" },
  ],
  defaultSort: { key: "inicio", dir: "desc" },
  build: buildContratos,
};
