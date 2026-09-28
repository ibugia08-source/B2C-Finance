import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isRevenueActiveStatus } from "@/lib/client-status";
import { SEM_NICHO } from "@/lib/niches";
import {
  currentYearMonth, monthBounds, monthIndex, parseCompetenceKey, type YearMonth,
} from "@/lib/renewal-expectation";
import { getMonthDelinquencies, type MonthDelinquency } from "./client-metrics";

/**
 * CONSULTA DA CARTEIRA DE CLIENTES (28/09/2026) — fonte ÚNICA dos filtros da
 * lista de Clientes, usada pela tela (/clientes) e pela API (/api/v1/clients).
 * Extraída da página sem mudar o comportamento dela.
 *
 * Status é SEMPRE o da competência (linha do tempo de ClientStatusHistory,
 * `getClientStatusesForCompetence`), nunca `Client.status`: quem entra no
 * `where.id` é decidido pelo mapa de status da competência que o chamador
 * passa. Cliente sem status na competência (ainda não existia) fica fora.
 */

/** "YYYY-MM" → esse mês; "1".."12" (link antigo) → próxima ocorrência. */
export function mesDaExpectativa(v: string): YearMonth | null {
  const ym = parseCompetenceKey(v);
  if (ym) return ym;
  const m = Number(v);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  const hoje = currentYearMonth();
  const candidato = { year: hoje.year, month: m };
  return monthIndex(candidato) < monthIndex(hoje) ? { year: hoje.year + 1, month: m } : candidato;
}

export type FiltroDeClientes = {
  /**
   * undefined → carteira da competência (todos menos Perdido/CHURNED);
   * "ativos" → os que geram receita; "todos" → qualquer status;
   * um ClientStatus → só esse.
   */
  status?: string;
  /** Só estes ids (ex.: "perdidos no mês" = perdas registradas no mês). */
  somenteIds?: string[];
  /** Entrada (startedAt; sem ele, createdAt) dentro do intervalo. */
  entradaEntre?: { start: Date; end: Date };
  /** Id do nicho, nome do nicho ou o sentinela SEM_NICHO. */
  segmento?: string;
  modalidade?: "MRR" | "TCV";
  responsavel?: string;
  /** Expectativa de renovação no mês "YYYY-MM" (ou "1".."12", link antigo). */
  mesRenovacao?: string;
  q?: string;
  /** Com contrato ATIVO que tem este serviço. */
  servico?: string;
};

export function whereDeClientes(
  statusDaComp: Map<string, string>,
  f: FiltroDeClientes
): Prisma.ClientWhereInput {
  const ids = (pred: (s: string) => boolean) => [...statusDaComp].filter(([, s]) => pred(s)).map(([id]) => id);
  const AND: Prisma.ClientWhereInput[] = [];
  const where: Prisma.ClientWhereInput = {};

  if (f.somenteIds) where.id = { in: f.somenteIds };
  else if (f.status === "ativos") where.id = { in: ids(isRevenueActiveStatus) };
  else if (f.status === "todos") where.id = { in: [...statusDaComp.keys()] };
  else if (f.status) where.id = { in: ids((s) => s === f.status) };
  // Carteira da competência: quem tinha status nela, menos os perdidos.
  else where.id = { in: ids((s) => s !== "CHURNED") };

  if (f.entradaEntre) {
    const { start, end } = f.entradaEntre;
    AND.push({
      OR: [
        { startedAt: { gte: start, lt: end } },
        { startedAt: null, createdAt: { gte: start, lt: end } },
      ],
    });
  }
  // Nicho: id do catálogo, o sentinela "sem nicho", ou o nome (texto).
  if (f.segmento === SEM_NICHO) where.nicheId = null;
  else if (f.segmento) {
    AND.push({ OR: [{ nicheId: f.segmento }, { segment: { equals: f.segmento, mode: "insensitive" } }] });
  }
  if (f.modalidade) where.modality = f.modalidade;
  if (f.responsavel) where.salesOwner = { equals: f.responsavel, mode: "insensitive" };
  if (f.mesRenovacao) {
    const alvo = mesDaExpectativa(f.mesRenovacao);
    if (alvo) {
      const { start, end } = monthBounds(alvo);
      where.expectedRenewalAt = { gte: start, lt: end };
    }
  }
  if (f.q?.trim()) {
    const q = f.q.trim();
    const like = { contains: q, mode: "insensitive" as const };
    AND.push({
      OR: [
        { name: like }, { legalName: like }, { document: like }, { email: like }, { segment: like },
        { city: like }, { salesOwner: like }, { opsOwner: like }, { tags: { has: q.toLowerCase() } },
      ],
    });
  }
  if (f.servico) {
    where.contracts = { some: { status: "ACTIVE", services: { some: { serviceId: f.servico } } } };
  }
  if (AND.length) where.AND = AND;
  return where;
}

export type InadimplenciaEfetiva = {
  value: "PAGO" | "DEVENDO" | "SEM_COBRANCA";
  /** true = ajuste manual da competência (ClientMonthDelinquency). */
  manual: boolean;
  by: string | null;
};

/**
 * Inadimplência EFETIVA de cada cliente na competência: o ajuste manual do
 * mês vence o cálculo pelas cobranças. Duas consultas para qualquer
 * quantidade de clientes.
 */
export async function inadimplenciaEfetiva(
  clientIds: string[],
  month: number,
  year: number
): Promise<Map<string, InadimplenciaEfetiva>> {
  const out = new Map<string, InadimplenciaEfetiva>();
  if (clientIds.length === 0) return out;
  const [auto, overrides] = await Promise.all([
    getMonthDelinquencies(clientIds, month, year),
    prisma.clientMonthDelinquency.findMany({
      where: { year, month, clientId: { in: clientIds } },
      select: { clientId: true, status: true, setBy: true },
    }),
  ]);
  const ov = new Map(overrides.map((o) => [o.clientId, o]));
  for (const id of clientIds) {
    const o = ov.get(id);
    out.set(
      id,
      o
        ? { value: o.status as "PAGO" | "DEVENDO", manual: true, by: o.setBy ?? null }
        : { value: (auto.get(id) ?? "SEM_COBRANCA") as MonthDelinquency, manual: false, by: null }
    );
  }
  return out;
}
