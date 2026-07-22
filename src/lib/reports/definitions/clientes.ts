import { prisma } from "@/lib/prisma";
import { getClientSummaries } from "@/lib/services/client-metrics";
import { type ReportQuery, amountRange } from "../query";
import { CLIENT_STATUS_LABEL, type ReportDef, type ReportRow } from "../shared";

async function buildClientes(q: ReportQuery): Promise<ReportRow[]> {
  const where: Record<string, unknown> = {};
  if (q.status) where.status = q.status;
  if (q.clientId) where.id = q.clientId;
  if (q.responsavel)
    where.OR = [
      { salesOwner: { contains: q.responsavel, mode: "insensitive" } },
      { opsOwner: { contains: q.responsavel, mode: "insensitive" } },
    ];
  const clients = await prisma.client.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, city: true, state: true, salesOwner: true, createdAt: true },
  });
  const summaries = await getClientSummaries(clients.map((c) => c.id));
  let rows = clients.map((c) => {
    const s = summaries.get(c.id)!;
    return {
      cliente: c.name,
      status: CLIENT_STATUS_LABEL[c.status] ?? c.status,
      cidade: c.city ? `${c.city}${c.state ? "/" + c.state : ""}` : null,
      responsavel: c.salesOwner,
      contratosAtivos: s.activeContracts,
      valorMensal: s.monthlyValue,
      receitaTotal: s.totalRevenue,
      emAberto: s.openAmount,
      vencido: s.overdueAmount,
      desde: c.createdAt,
    };
  });
  if (q.situacao === "inadimplente" || q.situacao === "vencido")
    rows = rows.filter((r) => r.vencido > 0);
  if (q.situacao === "a_vencer") rows = rows.filter((r) => r.vencido === 0 && r.emAberto > 0);
  const range = amountRange(q);
  if (range) rows = rows.filter((r) => (range.gte == null || r.receitaTotal >= range.gte) && (range.lte == null || r.receitaTotal <= range.lte));
  return rows;
}

export const clientesReport: ReportDef = {
  key: "clientes",
  title: "Clientes",
  description: "Carteira com contratos, receita, aberto e vencido por cliente.",
  columns: [
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "cidade", label: "Cidade", kind: "text" },
    { key: "responsavel", label: "Responsável", kind: "text" },
    { key: "contratosAtivos", label: "Contratos ativos", kind: "int", total: true },
    { key: "valorMensal", label: "Valor mensal", kind: "money", total: true },
    { key: "receitaTotal", label: "Receita total", kind: "money", total: true },
    { key: "emAberto", label: "Em aberto", kind: "money", total: true },
    { key: "vencido", label: "Vencido", kind: "money", total: true },
    { key: "desde", label: "Cliente desde", kind: "date" },
  ],
  filterFields: ["cliente", "status", "responsavel", "situacao", "valor"],
  groupOptions: ["status", "responsavel", "cidade"],
  statusOptions: Object.entries(CLIENT_STATUS_LABEL).map(([value, label]) => ({ value, label })),
  defaultSort: { key: "receitaTotal", dir: "desc" },
  build: buildClientes,
};
