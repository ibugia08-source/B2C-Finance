import type { ClientStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithOwner, runWithoutScope } from "@/lib/auth/owner-scope";
import { REVENUE_ACTIVE_STATUSES } from "@/lib/client-status";
import {
  type Competence, type DateKey,
  addDays, addMonths, competenceLabel, competenceReferenceDate, dateKeyToDate, dateToDateKey,
  formatDateKey, getCompetenceKey, getEndOfCompetence, getStartOfCompetence, isDateKey,
  parseCompetence, todayKey,
} from "@/lib/competence";

/**
 * STATUS DO CLIENTE COM VIGÊNCIA — camada central (26/09/2026).
 *
 * Fonte oficial: ClientStatusHistory (intervalos de datas civis, sem
 * sobreposição). Client.status é só o status VIGENTE HOJE, materializado.
 * Toda pergunta temporal passa por aqui — nenhum componente React, página ou
 * relatório decide sozinho "qual era o status em setembro".
 *
 *  · STATUS ATUAL     = o intervalo que cobre HOJE (calendário da Bahia).
 *  · STATUS HISTÓRICO = o intervalo que cobre a data consultada; para
 *    indicadores MENSAIS, o encerramento da competência (último dia) — ou
 *    hoje, se a competência está em curso (o fim do mês ainda não chegou).
 *  · STATUS FUTURO    = intervalo que começa depois de hoje: alteração
 *    PROGRAMADA. Não muda o status atual, a rotina, o MRR vigente nem o
 *    número de clientes de hoje; só entra em projeções.
 *
 * Escrita: o algoritmo de vigência mora UMA vez, no banco (b2c_status_apply /
 * b2c_status_cancel, migration 20260926090000). Aqui ficam as regras de
 * negócio em volta: permissão, competência fechada, retroativo, auditoria e
 * o acompanhamento do status atual.
 *
 * Documentação: docs/STATUS_TEMPORAL_CLIENTES.md.
 */

export type StatusInterval = {
  id: string;
  clientId: string;
  status: ClientStatus;
  from: DateKey;
  /** Último dia (inclusivo). Nulo = em diante. */
  to: DateKey | null;
  reason: string | null;
  origin: string;
  needsReview: boolean;
  changedById: string | null;
  createdAt: Date;
};

export class StatusTimelineConflictError extends Error {
  constructor(public clientId: string, public day: DateKey) {
    super(`Linha do tempo inconsistente: dois status válidos em ${formatDateKey(day)} para o cliente ${clientId}.`);
  }
}

export class StatusChangeError extends Error {
  constructor(
    public code:
      | "SEM_PERMISSAO" | "RETROATIVO" | "PROGRAMAR" | "COMPETENCIA_FECHADA" | "DATA_INVALIDA"
      | "CLIENTE" | "NADA_A_CANCELAR" | "NAO_E_FUTURA" | "INCONSISTENTE",
    message: string
  ) {
    super(message);
  }
}

export const COMPETENCIA_FECHADA_MSG =
  "Esta competência está encerrada. Para alterar informações históricas, é necessário reabrir o período.";

const SELECT = {
  id: true, clientId: true, status: true, effectiveFrom: true, effectiveTo: true, reason: true,
  origin: true, needsReview: true, changedById: true, createdAt: true,
} as const;

function toInterval(r: {
  id: string; clientId: string; status: ClientStatus; effectiveFrom: Date; effectiveTo: Date | null;
  reason: string | null; origin: string; needsReview: boolean; changedById: string | null; createdAt: Date;
}): StatusInterval {
  return {
    id: r.id,
    clientId: r.clientId,
    status: r.status,
    from: dateToDateKey(r.effectiveFrom),
    to: r.effectiveTo ? dateToDateKey(r.effectiveTo) : null,
    reason: r.reason,
    origin: r.origin,
    needsReview: r.needsReview,
    changedById: r.changedById,
    createdAt: r.createdAt,
  };
}

// ============================================================================
// Funções PURAS (sem banco) — a regra temporal em forma testável
// ============================================================================

/** O intervalo cobre o dia? (limites inclusivos) */
export function covers(i: Pick<StatusInterval, "from" | "to">, day: DateKey): boolean {
  return i.from <= day && (i.to == null || i.to >= day);
}

/**
 * Status válido no dia. Dois intervalos cobrindo a mesma data é
 * inconsistência: lança, em vez de escolher um silenciosamente.
 * Nenhum intervalo = null (antes da entrada, ou histórico não determinável).
 */
export function statusAtDate(timeline: StatusInterval[], day: DateKey): ClientStatus | null {
  const hits = timeline.filter((i) => covers(i, day));
  if (hits.length > 1) throw new StatusTimelineConflictError(hits[0].clientId, day);
  return hits[0]?.status ?? null;
}

/** Status no encerramento da competência (hoje, se ela está em curso). */
export function statusForCompetence(
  timeline: StatusInterval[],
  competence: Competence,
  today: DateKey = todayKey()
): ClientStatus | null {
  return statusAtDate(timeline, competenceReferenceDate(competence, today));
}

/** Próxima alteração programada (começa depois de hoje). */
export function nextScheduledChange(timeline: StatusInterval[], today: DateKey = todayKey()): StatusInterval | null {
  return [...timeline].sort((a, b) => a.from.localeCompare(b.from)).find((i) => i.from > today) ?? null;
}

/**
 * Erros de integridade da linha do tempo: fim antes do começo e
 * sobreposição. Lista vazia = íntegra. (O banco também recusa as duas.)
 */
export function validateTimeline(timeline: StatusInterval[]): string[] {
  const erros: string[] = [];
  const ord = [...timeline].sort((a, b) => a.from.localeCompare(b.from));
  for (let k = 0; k < ord.length; k++) {
    const i = ord[k];
    if (!i.clientId) erros.push("Registro sem cliente.");
    if (i.to != null && i.to < i.from)
      erros.push(`Fim antes do começo: ${formatDateKey(i.from)} → ${formatDateKey(i.to)}.`);
    const prox = ord[k + 1];
    if (prox && (i.to == null || i.to >= prox.from))
      erros.push(`Intervalos sobrepostos em ${formatDateKey(prox.from)}.`);
  }
  return erros;
}

// ============================================================================
// Leitura (sempre em lote — nada de 1 consulta por cliente)
// ============================================================================

/** Linhas do tempo de vários clientes numa consulta (escopo do dono). */
export async function getTimelines(clientIds?: string[]): Promise<Map<string, StatusInterval[]>> {
  const rows = await prisma.clientStatusHistory.findMany({
    where: clientIds ? { clientId: { in: clientIds } } : {},
    select: SELECT,
    orderBy: [{ clientId: "asc" }, { effectiveFrom: "asc" }],
  });
  const out = new Map<string, StatusInterval[]>();
  for (const r of rows) {
    const i = toInterval(r as any);
    const l = out.get(i.clientId);
    if (l) l.push(i);
    else out.set(i.clientId, [i]);
  }
  return out;
}

export async function getClientStatusTimeline(clientId: string): Promise<StatusInterval[]> {
  return (await getTimelines([clientId])).get(clientId) ?? [];
}

/**
 * Status de TODOS os clientes (ou dos informados) num dia — uma consulta só.
 * Cliente com dois intervalos no mesmo dia é registrado como erro e fica de
 * fora (sem status), nunca com um dos dois escolhido ao acaso.
 */
export async function getStatusesAtDate(day: DateKey, clientIds?: string[]): Promise<Map<string, ClientStatus>> {
  const d = dateKeyToDate(day);
  const rows = await prisma.clientStatusHistory.findMany({
    where: {
      ...(clientIds ? { clientId: { in: clientIds } } : {}),
      effectiveFrom: { lte: d },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }],
    },
    select: { clientId: true, status: true },
  });
  const out = new Map<string, ClientStatus>();
  const conflito = new Set<string>();
  for (const r of rows) {
    if (out.has(r.clientId)) conflito.add(r.clientId);
    else out.set(r.clientId, r.status);
  }
  for (const id of conflito) {
    console.error(`[status-history] ${new StatusTimelineConflictError(id, day).message}`);
    out.delete(id);
  }
  return out;
}

export async function getClientStatusAtDate(clientId: string, day: DateKey): Promise<ClientStatus | null> {
  return (await getStatusesAtDate(day, [clientId])).get(clientId) ?? null;
}

/** Status de cada cliente no encerramento da competência. */
export async function getClientStatusesForCompetence(
  competence: Competence,
  opts: { clientIds?: string[]; today?: DateKey } = {}
): Promise<Map<string, ClientStatus>> {
  return getStatusesAtDate(competenceReferenceDate(competence, opts.today ?? todayKey()), opts.clientIds);
}

export async function getClientStatusForCompetence(
  clientId: string,
  year: number,
  month: number,
  opts: { today?: DateKey } = {}
): Promise<ClientStatus | null> {
  const comp = getCompetenceKey(year, month);
  return (await getClientStatusesForCompetence(comp, { clientIds: [clientId], today: opts.today })).get(clientId) ?? null;
}

export async function getCurrentClientStatus(clientId: string, today: DateKey = todayKey()): Promise<ClientStatus | null> {
  return getClientStatusAtDate(clientId, today);
}

const REVENUE = new Set<string>(REVENUE_ACTIVE_STATUSES);

/** Ids dos clientes ATIVOS (geram receita) no encerramento da competência. */
export async function getActiveClientsForCompetence(
  competence: Competence,
  opts: { clientIds?: string[]; today?: DateKey } = {}
): Promise<Set<string>> {
  const m = await getClientStatusesForCompetence(competence, opts);
  return new Set([...m].filter(([, s]) => REVENUE.has(s)).map(([id]) => id));
}

/** Composição da carteira na competência: status → ids. */
export async function getClientsByStatusForCompetence(
  competence: Competence,
  opts: { today?: DateKey } = {}
): Promise<Record<string, string[]>> {
  const m = await getClientStatusesForCompetence(competence, opts);
  const out: Record<string, string[]> = {};
  for (const [id, s] of m) (out[s] ??= []).push(id);
  return out;
}

/**
 * Status de cada cliente no encerramento de VÁRIAS competências — uma
 * consulta para a janela toda (séries mensais, painel anual, projeções).
 */
export async function getStatusesForCompetences(
  competences: Competence[],
  opts: { clientIds?: string[]; today?: DateKey } = {}
): Promise<Map<Competence, Map<string, ClientStatus>>> {
  const today = opts.today ?? todayKey();
  const refs = competences.map((c) => [c, competenceReferenceDate(c, today)] as const);
  const out = new Map<Competence, Map<string, ClientStatus>>(competences.map((c) => [c, new Map()]));
  if (refs.length === 0) return out;
  const min = refs.reduce((a, [, d]) => (d < a ? d : a), refs[0][1]);
  const max = refs.reduce((a, [, d]) => (d > a ? d : a), refs[0][1]);
  const rows = await prisma.clientStatusHistory.findMany({
    where: {
      ...(opts.clientIds ? { clientId: { in: opts.clientIds } } : {}),
      effectiveFrom: { lte: dateKeyToDate(max) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateKeyToDate(min) } }],
    },
    select: { clientId: true, status: true, effectiveFrom: true, effectiveTo: true },
  });
  for (const [comp, ref] of refs) {
    const m = out.get(comp)!;
    const conflito = new Set<string>();
    for (const r of rows) {
      if (!covers({ from: dateToDateKey(r.effectiveFrom), to: r.effectiveTo ? dateToDateKey(r.effectiveTo) : null }, ref))
        continue;
      if (m.has(r.clientId)) conflito.add(r.clientId);
      else m.set(r.clientId, r.status);
    }
    for (const id of conflito) {
      console.error(`[status-history] ${new StatusTimelineConflictError(id, ref).message}`);
      m.delete(id);
    }
  }
  return out;
}

/**
 * BASE DO MRR (fonte única): ids dos clientes ATIVOS no encerramento de cada
 * competência. Passado = histórico; competência em curso = hoje; futuro =
 * projeção com as alterações programadas. Uma consulta para a janela toda.
 */
export async function getActiveClientsByCompetences(
  competences: Competence[],
  opts: { clientIds?: string[]; today?: DateKey } = {}
): Promise<Map<Competence, Set<string>>> {
  const por = await getStatusesForCompetences(competences, opts);
  const out = new Map<Competence, Set<string>>();
  for (const [comp, m] of por)
    out.set(comp, new Set([...m].filter(([, s]) => REVENUE.has(s)).map(([id]) => id)));
  return out;
}

/** Próxima alteração programada de um cliente. */
export async function getNextScheduledStatusChange(
  clientId: string,
  today: DateKey = todayKey()
): Promise<StatusInterval | null> {
  return (await getScheduledStatusChanges([clientId], today)).get(clientId) ?? null;
}

/** Próxima alteração programada de cada cliente (lista, carteira). */
export async function getScheduledStatusChanges(
  clientIds?: string[],
  today: DateKey = todayKey()
): Promise<Map<string, StatusInterval>> {
  const rows = await prisma.clientStatusHistory.findMany({
    where: {
      ...(clientIds ? { clientId: { in: clientIds } } : {}),
      effectiveFrom: { gt: dateKeyToDate(today) },
    },
    select: SELECT,
    orderBy: { effectiveFrom: "asc" },
  });
  const out = new Map<string, StatusInterval>();
  for (const r of rows) if (!out.has(r.clientId)) out.set(r.clientId, toInterval(r as any));
  return out;
}

/** Clientes com histórico reconstruído que precisa de conferência manual. */
export async function getClientsNeedingStatusReview(): Promise<Set<string>> {
  const rows = await prisma.clientStatusHistory.findMany({
    where: { needsReview: true },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  return new Set(rows.map((r) => r.clientId));
}

// ============================================================================
// Escrita
// ============================================================================

export type StatusCapabilities = {
  /** clientes.alterar_status */
  alterar: boolean;
  /** clientes.programar_status — vigência depois de hoje. */
  programar: boolean;
  /** clientes.alterar_status_retroativo — vigência antes do mês corrente. */
  retroativo: boolean;
};

export type ChangeStatusInput = {
  clientId: string;
  status: ClientStatus;
  effectiveFrom: DateKey;
  reason?: string | null;
  actor?: { id: string | null; email?: string | null } | null;
  origin?: "USUARIO" | "SISTEMA" | "IMPORTACAO";
  today?: DateKey;
  /** Perda: competência da renovação frustrada (módulo Renovações). */
  renewalCompetence?: string | null;
};

export type ChangeStatusResult = {
  /** Vigência futura: registrada, sem mexer no status atual. */
  programada: boolean;
  /** O status VIGENTE HOJE mudou (e os efeitos rodaram). */
  statusAtualMudou: boolean;
  /** Efeitos da troca atual falharam depois de gravar a vigência. */
  aviso?: string;
};

/** Tipo da vigência pela data de início. */
export function classifyEffectiveDate(
  effectiveFrom: DateKey,
  today: DateKey = todayKey()
): "RETROATIVA" | "COMPETENCIA_ATUAL" | "FUTURA" {
  if (effectiveFrom > today) return "FUTURA";
  if (effectiveFrom < getStartOfCompetence(today.slice(0, 7))) return "RETROATIVA";
  return "COMPETENCIA_ATUAL";
}

/**
 * Competências FECHADAS (ou em fechamento) que uma mudança a partir de
 * `from` alteraria: de `from` até a véspera da próxima mudança já registrada
 * (que é preservada). Futuro nunca está fechado — basta olhar até hoje.
 */
async function competenciasFechadasAfetadas(
  timeline: StatusInterval[],
  from: DateKey,
  today: DateKey
): Promise<string[]> {
  const proxima = [...timeline].sort((a, b) => a.from.localeCompare(b.from)).find((i) => i.from > from);
  const fimAfetado = proxima ? addDays(proxima.from, -1) : null;
  const ultimo = [fimAfetado ?? today, today].sort()[0];
  if (ultimo < from) return [];
  const comps: string[] = [];
  for (let c = from.slice(0, 7); c <= ultimo.slice(0, 7) && comps.length < 600; c = addMonths(c, 1)) comps.push(c);
  const { periodosDe } = await import("@/lib/services/closing-period");
  const { permiteEvento } = await import("@/lib/periods/events");
  const estados = await periodosDe(comps);
  return comps.filter((c) => {
    const p = estados.get(c);
    return p ? !permiteEvento(p.estado, "CLIENT_STATUS_CHANGED").ok : false;
  });
}

async function auditar(
  db: any,
  input: {
    clientId: string; ownerId: string | null; antes: ClientStatus | null; depois: ClientStatus | "CANCELADA";
    effectiveFrom: DateKey; effectiveTo: DateKey | null; reason: string | null;
    actor: { id: string | null; email?: string | null } | null; field: string; origin: string;
  }
) {
  await db.auditLog.create({
    data: {
      entity: "Client",
      entityId: input.clientId,
      action: "UPDATE",
      field: input.field,
      oldValue: input.antes,
      newValue: JSON.stringify({
        status: input.depois,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        competence: input.effectiveFrom.slice(0, 7),
      }),
      origin: input.origin === "IMPORTACAO" ? "IMPORT" : input.origin === "SISTEMA" ? "JOB" : "UI",
      reason: input.reason,
      actorId: input.actor?.id ?? null,
      actorEmail: input.actor?.email ?? null,
      ownerId: input.ownerId,
    },
  });
}

/**
 * MUDA O STATUS A PARTIR DE UMA DATA — o caminho oficial.
 *
 *  1. valida data, permissão (retroativa / programada) e competência fechada;
 *  2. numa TRANSAÇÃO: aplica a vigência (b2c_status_apply), confere a
 *     integridade da linha do tempo e audita — falhou, nada fica gravado;
 *  3. se o status VIGENTE HOJE mudou (mudança de hoje ou retroativa),
 *     acompanha: perda registrada, relação/termo, cobranças futuras e
 *     Client.status. Vigência futura NÃO mexe em nada disso — quem faz a
 *     troca no dia é o job diário (materializarStatusProgramados).
 */
export async function changeClientStatus(
  input: ChangeStatusInput,
  caps: StatusCapabilities
): Promise<ChangeStatusResult> {
  const today = input.today ?? todayKey();
  if (!caps.alterar) throw new StatusChangeError("SEM_PERMISSAO", "Você não tem permissão para alterar o status de clientes.");
  if (!isDateKey(input.effectiveFrom))
    throw new StatusChangeError("DATA_INVALIDA", "Informe o início da vigência.");

  const tipo = classifyEffectiveDate(input.effectiveFrom, today);
  if (tipo === "FUTURA" && !caps.programar)
    throw new StatusChangeError("PROGRAMAR", "Você não tem permissão para programar alterações de status.");
  if (tipo === "RETROATIVA" && !caps.retroativo)
    throw new StatusChangeError(
      "RETROATIVO",
      `Alterar o status a partir de ${formatDateKey(input.effectiveFrom)} reescreve ${competenceLabel(input.effectiveFrom.slice(0, 7))}, que já passou. É preciso a permissão de alteração retroativa.`
    );

  // Escopo do dono: cliente de outro dono volta nulo.
  const cliente = await prisma.client.findFirst({
    where: { id: input.clientId },
    select: { id: true, ownerId: true, status: true },
  });
  if (!cliente) throw new StatusChangeError("CLIENTE", "Cliente não encontrado.");

  const antesTimeline = await getClientStatusTimeline(input.clientId);
  const fechadas = await competenciasFechadasAfetadas(antesTimeline, input.effectiveFrom, today);
  if (fechadas.length > 0)
    throw new StatusChangeError(
      "COMPETENCIA_FECHADA",
      `${COMPETENCIA_FECHADA_MSG} (${fechadas.map((c) => competenceLabel(c)).join(", ")})`
    );

  const antes = statusAtDate(antesTimeline, input.effectiveFrom);
  const reason = (input.reason ?? "").trim() || null;
  const origin = input.origin ?? "USUARIO";

  await prisma.$transaction(async (tx) => {
    // Os gatilhos de Client não duplicam o que esta transação já registra.
    await tx.$executeRaw`SELECT set_config('b2c.status_manual', '1', true)`;
    await tx.$executeRaw`SELECT b2c_status_apply(${input.clientId}, ${input.status}::"ClientStatus", ${input.effectiveFrom}::date, ${reason}, ${input.actor?.id ?? null}, ${origin}, false)`;
    const depois = (
      await tx.clientStatusHistory.findMany({ where: { clientId: input.clientId }, select: SELECT })
    ).map((r: any) => toInterval(r));
    const erros = validateTimeline(depois);
    if (erros.length > 0) throw new StatusChangeError("INCONSISTENTE", erros.join(" "));
    const novo = depois.find((i) => covers(i, input.effectiveFrom));
    await auditar(tx, {
      clientId: input.clientId,
      ownerId: cliente.ownerId,
      antes,
      depois: input.status,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: novo?.to ?? null,
      reason,
      actor: input.actor ?? null,
      field: tipo === "FUTURA" ? "status_programado" : "status_vigencia",
      origin,
    });
  });

  if (tipo === "FUTURA") return { programada: true, statusAtualMudou: false };
  const sync = await sincronizarStatusAtual(input.clientId, {
    today,
    reason,
    renewalCompetence: input.renewalCompetence ?? null,
  });
  return { programada: false, statusAtualMudou: sync.mudou, aviso: sync.aviso };
}

/** Programa uma alteração (vigência obrigatoriamente depois de hoje). */
export async function scheduleClientStatusChange(
  input: ChangeStatusInput,
  caps: StatusCapabilities
): Promise<ChangeStatusResult> {
  const today = input.today ?? todayKey();
  if (!isDateKey(input.effectiveFrom) || input.effectiveFrom <= today)
    throw new StatusChangeError("NAO_E_FUTURA", "Uma alteração programada precisa começar depois de hoje.");
  return changeClientStatus({ ...input, today }, caps);
}

/**
 * Cancela a alteração PROGRAMADA que começa em `effectiveFrom`: a linha sai e
 * o intervalo anterior volta a cobrir o período. Só antes da vigência.
 */
export async function cancelScheduledStatusChange(
  input: { clientId: string; effectiveFrom: DateKey; reason?: string | null; actor?: { id: string | null; email?: string | null } | null; today?: DateKey },
  caps: StatusCapabilities
): Promise<void> {
  const today = input.today ?? todayKey();
  if (!caps.programar) throw new StatusChangeError("SEM_PERMISSAO", "Você não tem permissão para cancelar alterações programadas.");
  if (!isDateKey(input.effectiveFrom) || input.effectiveFrom <= today)
    throw new StatusChangeError("NAO_E_FUTURA", "Só é possível cancelar uma alteração que ainda não começou a valer.");
  const cliente = await prisma.client.findFirst({ where: { id: input.clientId }, select: { id: true, ownerId: true } });
  if (!cliente) throw new StatusChangeError("CLIENTE", "Cliente não encontrado.");
  const timeline = await getClientStatusTimeline(input.clientId);
  const alvo = timeline.find((i) => i.from === input.effectiveFrom);
  if (!alvo) throw new StatusChangeError("NADA_A_CANCELAR", "Não há alteração programada nessa data.");

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('b2c.status_manual', '1', true)`;
    await tx.$executeRaw`SELECT b2c_status_cancel(${input.clientId}, ${input.effectiveFrom}::date)`;
    const depois = (
      await tx.clientStatusHistory.findMany({ where: { clientId: input.clientId }, select: SELECT })
    ).map((r: any) => toInterval(r));
    const erros = validateTimeline(depois);
    if (erros.length > 0) throw new StatusChangeError("INCONSISTENTE", erros.join(" "));
    await auditar(tx, {
      clientId: input.clientId,
      ownerId: cliente.ownerId,
      antes: alvo.status,
      depois: "CANCELADA",
      effectiveFrom: alvo.from,
      effectiveTo: alvo.to,
      reason: (input.reason ?? "").trim() || null,
      actor: input.actor ?? null,
      field: "status_programado_cancelado",
      origin: "USUARIO",
    });
  });
}

/**
 * Acompanha o status VIGENTE HOJE: se a linha do tempo diz X hoje e
 * Client.status diz Y, roda a transição Y → X (perda, relação, termo,
 * cobranças futuras) e materializa X. A data dos efeitos é o início da
 * vigência — uma perda retroativa a 01/09 é perda de setembro.
 */
export async function sincronizarStatusAtual(
  clientId: string,
  opts: { today?: DateKey; reason?: string | null; renewalCompetence?: string | null } = {}
): Promise<{ mudou: boolean; aviso?: string }> {
  const today = opts.today ?? todayKey();
  const timeline = await getClientStatusTimeline(clientId);
  const vigente = timeline.find((i) => covers(i, today));
  if (!vigente) return { mudou: false };
  const existing = await prisma.client.findFirst({ where: { id: clientId } });
  if (!existing || existing.status === vigente.status) return { mudou: false };
  try {
    const { transicionarStatus } = await import("@/lib/services/client-status-transition");
    // Meio-dia da Bahia (15:00Z): a data civil lida por qualquer regra do
    // sistema cai no dia da vigência.
    const efeito = new Date(`${vigente.from}T15:00:00.000Z`);
    await transicionarStatus(existing, vigente.status, {
      reason: opts.reason ?? vigente.reason,
      lostAt: efeito,
      renewalCompetence: opts.renewalCompetence ?? null,
    });
    return { mudou: true };
  } catch (e: any) {
    return {
      mudou: false,
      aviso: `A vigência foi registrada, mas o status atual não pôde ser atualizado agora (${e?.message ?? "erro"}). O job diário tenta de novo.`,
    };
  }
}

/**
 * JOB DIÁRIO: materializa as alterações programadas que começaram a valer
 * (e corrige qualquer divergência entre Client.status e a linha do tempo).
 * Idempotente. Roda FORA de leitura de página — nunca num Server Component.
 */
export async function materializarStatusProgramados(
  today: DateKey = todayKey(),
  /** Só os clientes deste dono (ação manual). Omitido = todos (job). */
  ownerId?: string | null,
  /** Como rodar cada cliente sob o dono dele (o job declara principal de sistema). */
  comDono: <T>(ownerId: string | null, fn: () => Promise<T>) => Promise<T> = (o, fn) => runWithOwner(o, fn)
): Promise<{
  verificados: number;
  atualizados: number;
  falhas: { clientId: string; erro: string }[];
}> {
  const divergentes = await runWithoutScope(async () =>
    prisma.$queryRaw<{ id: string; ownerId: string | null }[]>`
      SELECT c."id", c."ownerId"
        FROM "Client" c
        JOIN "ClientStatusHistory" h ON h."clientId" = c."id"
       WHERE h."effectiveFrom" <= ${today}::date
         AND (h."effectiveTo" IS NULL OR h."effectiveTo" >= ${today}::date)
         AND h."status" <> c."status"`
  ).then((rows) => (ownerId === undefined ? rows : rows.filter((r) => r.ownerId === ownerId)));
  let atualizados = 0;
  const falhas: { clientId: string; erro: string }[] = [];
  for (const c of divergentes) {
    const r = await comDono(c.ownerId, () => sincronizarStatusAtual(c.id, { today }));
    if (r.mudou) atualizados++;
    else if (r.aviso) falhas.push({ clientId: c.id, erro: r.aviso });
  }
  return { verificados: divergentes.length, atualizados, falhas };
}

// ============================================================================
// Apresentação (rótulos — a regra continua aqui, não no componente)
// ============================================================================

export function describeInterval(i: Pick<StatusInterval, "from" | "to">): string {
  if (i.to == null) return `a partir de ${formatDateKey(i.from)}`;
  if (i.to === i.from) return `em ${formatDateKey(i.from)}`;
  return `${formatDateKey(i.from)} até ${formatDateKey(i.to)}`;
}

/** Início de vigência sugerido para a competência em exibição. */
export function suggestedEffectiveFrom(competence: Competence, today: DateKey = todayKey()): DateKey {
  if (!parseCompetence(competence)) return today;
  if (competence === today.slice(0, 7)) return today;
  return getStartOfCompetence(competence);
}

export { getEndOfCompetence };
