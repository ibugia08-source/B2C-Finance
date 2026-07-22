import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

const UPSELL_LABEL: Record<string, string> = {
  OPPORTUNITY: "Oportunidade",
  NEGOTIATION: "Em negociação",
  WON: "Vendido",
  LOST: "Perdido",
  PAUSED: "Pausado",
};

/** Oportunidades de upsell (pipeline + fechadas no período). */
async function buildUpsell(q: ReportQuery): Promise<ReportRow[]> {
  const upsells = await prisma.upsell.findMany({
    where: {
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.status ? { status: q.status as any } : {}),
    },
    orderBy: [{ status: "asc" }, { expectedCloseAt: "asc" }],
    select: {
      title: true, value: true, responsible: true, status: true,
      expectedCloseAt: true, closedAt: true, createdAt: true,
      client: { select: { name: true } },
      service: { select: { name: true } },
      offer: { select: { name: true } },
    },
  });
  let rows = upsells.map((u) => ({
    cliente: u.client.name,
    oportunidade: u.title ?? u.offer?.name ?? u.service?.name ?? "—",
    alvo: u.offer?.name ?? u.service?.name ?? null,
    responsavel: u.responsible,
    status: UPSELL_LABEL[u.status] ?? u.status,
    criada: u.createdAt,
    previsao: u.expectedCloseAt,
    fechada: u.closedAt,
    valor: n(u.value),
  }));
  if (q.responsavel)
    rows = rows.filter((r) =>
      (r.responsavel ?? "").toLowerCase().includes(q.responsavel!.toLowerCase())
    );
  return rows;
}

export const upsellReport: ReportDef = {
  key: "upsell",
  title: "Upsell",
  description: "Pipeline de oportunidades de venda interna e resultados.",
  columns: [
    { key: "cliente", label: "Cliente", kind: "text" },
    { key: "oportunidade", label: "Oportunidade", kind: "text" },
    { key: "alvo", label: "Serviço/Oferta", kind: "text" },
    { key: "responsavel", label: "Responsável", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "criada", label: "Criada em", kind: "date" },
    { key: "previsao", label: "Previsão", kind: "date" },
    { key: "fechada", label: "Fechada em", kind: "date" },
    { key: "valor", label: "Valor", kind: "money", total: true },
  ],
  filterFields: ["cliente", "responsavel"],
  groupOptions: ["status", "responsavel", "alvo"],
  defaultSort: { key: "valor", dir: "desc" },
  build: buildUpsell,
};
