import { prisma } from "@/lib/prisma";
import { getClientSummaries } from "@/lib/services/client-metrics";
import { type ReportQuery, amountRange } from "../query";
import {
  civilCompetenceKey, competenceShortLabel, monthBounds, parseCompetenceKey,
} from "@/lib/renewal-expectation";
import { SEM_NICHO } from "@/lib/niches";
import { CLIENT_STATUS_LABEL, MODALITY_LABEL, type ReportDef, type ReportRow } from "../shared";

/**
 * Filtros da carteira — todos COMBINÁVEIS (E lógico): responsável escolhido
 * na lista, modalidade, nicho/segmento, origem, UF e mês de renovação, além
 * de cliente, status, situação e faixa de valor. A exportação (CSV/XLSX/PDF)
 * recebe a mesma querystring da tela, então sai exatamente o que se vê.
 */
async function buildClientes(q: ReportQuery): Promise<ReportRow[]> {
  const where: Record<string, unknown> = {};
  if (q.status) where.status = q.status;
  if (q.clientId) where.id = q.clientId;
  if (q.responsavel)
    where.OR = [
      { salesOwner: { equals: q.responsavel, mode: "insensitive" } },
      { opsOwner: { equals: q.responsavel, mode: "insensitive" } },
    ];
  if (q.modalidade) where.modality = q.modalidade;
  if (q.segmento === SEM_NICHO) where.nicheId = null;
  else if (q.segmento) where.segment = { equals: q.segmento, mode: "insensitive" };
  if (q.origem) where.origin = { equals: q.origem, mode: "insensitive" };
  if (q.uf) where.state = { equals: q.uf, mode: "insensitive" };
  if (q.mesRenovacao) {
    const ym = parseCompetenceKey(q.mesRenovacao);
    if (ym) {
      const { start, end } = monthBounds(ym);
      where.expectedRenewalAt = { gte: start, lt: end };
    }
  }
  const clients = await prisma.client.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, status: true, city: true, state: true, salesOwner: true,
      opsOwner: true, modality: true, segment: true, origin: true, expectedRenewalAt: true,
      createdAt: true,
    },
  });
  const summaries = await getClientSummaries(clients.map((c) => c.id));
  let rows = clients.map((c) => {
    const s = summaries.get(c.id)!;
    return {
      cliente: c.name,
      status: CLIENT_STATUS_LABEL[c.status] ?? c.status,
      cidade: c.city ? `${c.city}${c.state ? "/" + c.state : ""}` : null,
      uf: c.state,
      responsavel: c.salesOwner,
      responsavelOperacional: c.opsOwner,
      modalidade: c.modality ? MODALITY_LABEL[c.modality] ?? c.modality : null,
      segmento: c.segment,
      origem: c.origin,
      mesRenovacao: c.expectedRenewalAt ?? null,
      // Rótulo do mês (Set/2026) — é por ele que se agrupa.
      renovacaoMes: c.expectedRenewalAt ? competenceShortLabel(civilCompetenceKey(c.expectedRenewalAt)) : null,
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
    { key: "uf", label: "UF", kind: "text" },
    { key: "responsavel", label: "Responsável", kind: "text" },
    { key: "responsavelOperacional", label: "Resp. operacional", kind: "text" },
    { key: "modalidade", label: "Modalidade", kind: "text" },
    { key: "segmento", label: "Nicho", kind: "text" },
    { key: "origem", label: "Origem", kind: "text" },
    { key: "mesRenovacao", label: "Expectativa de renovação", kind: "date" },
    { key: "renovacaoMes", label: "Mês da renovação", kind: "text" },
    { key: "contratosAtivos", label: "Contratos ativos", kind: "int", total: true },
    { key: "valorMensal", label: "Valor mensal", kind: "money", total: true },
    { key: "receitaTotal", label: "Receita total", kind: "money", total: true },
    { key: "emAberto", label: "Em aberto", kind: "money", total: true },
    { key: "vencido", label: "Vencido", kind: "money", total: true },
    { key: "desde", label: "Cliente desde", kind: "date" },
  ],
  filterFields: [
    "cliente", "status", "responsavel", "modalidade", "segmento", "origem", "uf",
    "mesRenovacao", "situacao", "valor",
  ],
  groupOptions: ["status", "responsavel", "modalidade", "segmento", "origem", "uf", "cidade", "renovacaoMes"],
  statusOptions: Object.entries(CLIENT_STATUS_LABEL).map(([value, label]) => ({ value, label })),
  defaultSort: { key: "receitaTotal", dir: "desc" },
  build: buildClientes,
};
