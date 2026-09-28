import { randomInt, timingSafeEqual } from "crypto";
import { z } from "zod";
import { Prisma, type PendingAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DomainContext } from "@/lib/engines/domain";
import { formatBRL } from "@/lib/format";
import { ApiError, requireApiScope, type ApiAuth } from "../auth";
import { hashDoPedido } from "../idempotency";
import {
  MAX_TENTATIVAS_DE_CODIGO, OPERACOES_BLOQUEADAS, OPERACOES_DE_ESCRITA, TTL_PADRAO_MINUTOS,
  chaveDaConfirmacao, ehOperacaoBloqueada, ehOperacaoDoAgente, type OperacaoDoAgente,
} from "./catalog";
import { CORPO_DA_OPERACAO, montarPreview } from "./preview";

/**
 * AÇÕES PENDENTES DO AGENTE (28/09/2026) — docs/N8N_AGENT_WRITE_ACTIONS.md.
 *
 * Fluxo: o agente PROPÕE (operação + alvo + corpo) → a API valida o corpo
 * com o schema da rota de escrita, lê o estado atual, monta o preview e
 * guarda a PendingAction com um código de 4 dígitos → o usuário responde
 * "SIM <código>" (WhatsApp) ou toca em Confirmar (Telegram, botão com o id
 * da ação) → a API confere que a confirmação é DESSA ação (mesmo usuário,
 * mesmo vínculo, código quando digitado, dentro da validade, estado igual ao
 * do preview) e executa o payload GUARDADO pela rota de escrita oficial, com
 * a Idempotency-Key "mensagem/update + id da ação" (wa:… ou telegram:…).
 *
 * O que o agente NÃO consegue:
 *  · confirmar sozinho: não há ferramenta de confirmação; ela nasce da
 *    mensagem do usuário, no workflow, antes da IA;
 *  · trocar o que será executado: a confirmação não leva corpo — vale o que
 *    foi guardado no preview;
 *  · ganhar permissão: a proposta e a execução exigem o scope da operação
 *    nos scopes EFETIVOS (conta ∩ RBAC do usuário do vínculo), e a rota de
 *    escrita confere de novo;
 *  · executar operação bloqueada (403 operation_blocked).
 */

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

const alvo = z
  .string()
  .trim()
  .max(200)
  .regex(/^[A-Za-z0-9:_.-]*$/, "Id inválido.")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const PropostaBody = z
  .object({
    /** Operação da API (payments.register…) ou nome da ferramenta (registrar_pagamento). */
    operation: z.string().trim().min(1).max(60),
    /** Id da entidade alvo (cobrança, cliente, despesa, oportunidade, chave da ação da rotina). */
    targetId: alvo,
    /** Corpo da rota de escrita (o mesmo contrato de POST/PATCH da API). */
    input: z.record(z.unknown()).default({}),
  })
  .strict();

export const ConfirmacaoBody = z
  .object({
    /**
     * WhatsApp: id da mensagem em que o usuário confirmou.
     * Telegram (botão): update_id do callback_query.
     */
    messageId: z.string().trim().min(1).max(200),
    /** Código que o usuário digitou ("SIM 4821" → "4821"). Obrigatório em via "code". */
    confirmationCode: z.string().trim().regex(/^\d{4}$/, "O código tem 4 dígitos.").optional(),
    /**
     * Como o usuário confirmou:
     *  · "code"   — digitou SIM + código (WhatsApp);
     *  · "button" — tocou em Confirmar na prévia (Telegram; o botão leva só o
     *    id da ação, e a API confere que a ação é do usuário do vínculo).
     */
    via: z.enum(["code", "button"]).default("code"),
  })
  .strict()
  .superRefine((b, c) => {
    if (b.via === "code" && !b.confirmationCode) {
      c.addIssue({ code: "custom", path: ["confirmationCode"], message: "Informe o código de 4 dígitos." });
    }
    if (b.via === "button" && b.confirmationCode) {
      c.addIssue({ code: "custom", path: ["confirmationCode"], message: "Confirmação por botão não leva código." });
    }
  });

export const CancelamentoBody = z
  .object({ messageId: z.string().trim().min(1).max(200).optional() })
  .strict();

// ---------------------------------------------------------------------------

export function ttlEmMinutos(): number {
  const n = Number(process.env.B2C_PENDING_ACTION_TTL_MINUTES);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : TTL_PADRAO_MINUTOS;
}

function delegacaoObrigatoria(auth: ApiAuth) {
  if (!auth.delegacao) {
    throw new ApiError(
      400,
      "identity_required",
      "Ações do agente são sempre em nome de um usuário: envie o header X-B2C-Identity (de POST /integrations/resolve-identity)."
    );
  }
  return auth.delegacao;
}

/** O usuário (via conta ∩ RBAC) pode a operação? Mensagem clara para cada caso. */
function exigirScopeDaOperacao(auth: ApiAuth, op: OperacaoDoAgente) {
  const scope = OPERACOES_DE_ESCRITA[op].scope;
  if (auth.delegacao && !auth.scopes.includes(scope) && auth.delegacao.scopesDaConta.includes(scope)) {
    throw new ApiError(403, "user_forbidden", `${auth.delegacao.userName} não tem permissão para isto no B2C Finance.`, scope);
  }
  requireApiScope(auth, scope);
}

function resolverOperacao(nome: string): OperacaoDoAgente {
  const porFerramenta = Object.entries(OPERACOES_DE_ESCRITA).find(([, o]) => o.tool === nome)?.[0];
  const op = porFerramenta ?? nome;
  if (ehOperacaoBloqueada(op)) {
    throw new ApiError(
      403,
      "operation_blocked",
      `“${OPERACOES_BLOQUEADAS[op]}” não pode ser feito pelo agente. Faça no B2C Finance, com o seu usuário.`
    );
  }
  if (!ehOperacaoDoAgente(op)) {
    throw new ApiError(400, "validation_error", `Operação desconhecida para o agente: “${nome}”.`);
  }
  return op;
}

const codigoNovo = () => String(randomInt(0, 10_000)).padStart(4, "0");

function codigosIguais(a: string, b: string): boolean {
  const x = Buffer.from(a.padEnd(8, " "));
  const y = Buffer.from(b.padEnd(8, " "));
  return x.length === y.length && timingSafeEqual(x, y) && a.length === b.length;
}

const horaLocal = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", minute: "2-digit" }).format(d);

type Resumo = { label: string; amount: number | null };

/**
 * Mensagem do preview (o texto guardado + como confirmar), por canal:
 *  · WhatsApp — responder SIM + código;
 *  · Telegram — tocar nos botões Confirmar / Cancelar (o workflow anexa o
 *    teclado; o código não aparece).
 */
export function mensagemDoPreview(a: Pick<PendingAction, "preview" | "confirmationCode" | "expiresAt"> & { channel?: string }): string {
  if (a.channel === "TELEGRAM") {
    return `${a.preview}\n\nToque em *Confirmar* ou *Cancelar*. Vale até ${horaLocal(a.expiresAt)}.`;
  }
  return `${a.preview}\n\nResponda *SIM ${a.confirmationCode}* para confirmar ou *NÃO* para cancelar. Vale até ${horaLocal(a.expiresAt)}.`;
}

export function serializarAcao(a: PendingAction) {
  const op = OPERACOES_DE_ESCRITA[a.operation as OperacaoDoAgente];
  const resumo = (a.summary ?? {}) as Resumo;
  return {
    actionId: a.id,
    operation: a.operation,
    tool: op?.tool ?? null,
    risk: "WRITE_CONFIRMATION" as const,
    status: a.status,
    channel: a.channel,
    targetId: a.targetId,
    summary: { label: resumo.label ?? null, amount: resumo.amount ?? null },
    preview: a.preview,
    // Telegram confirma por botão: o código não sai (nem para a IA repetir).
    ...(a.status === "PENDING"
      ? { ...(a.channel === "TELEGRAM" ? {} : { confirmationCode: a.confirmationCode }), message: mensagemDoPreview(a) }
      : {}),
    expiresAt: a.expiresAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
    executedAt: a.executedAt?.toISOString() ?? null,
    result: a.result ?? null,
    errorCode: a.errorCode,
  };
}

/** PENDING vencida vira EXPIRED ao ser lida (não depende de job). */
async function vencerSePreciso(a: PendingAction, agora = new Date()): Promise<PendingAction> {
  if (a.status !== "PENDING" || a.expiresAt > agora) return a;
  await prisma.pendingAction.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: "EXPIRED", decidedAt: agora } });
  return { ...a, status: "EXPIRED", decidedAt: agora };
}

// ---------------------------------------------------------------------------
// Propor
// ---------------------------------------------------------------------------

export async function proporAcao(p: {
  auth: ApiAuth;
  ctx: DomainContext;
  body: z.output<typeof PropostaBody>;
  sourceMessageId: string | null;
}) {
  const deleg = delegacaoObrigatoria(p.auth);
  const op = resolverOperacao(p.body.operation);
  const def = OPERACOES_DE_ESCRITA[op];
  exigirScopeDaOperacao(p.auth, op);

  const targetId = p.body.targetId ?? null;
  if (def.target && !targetId) {
    throw new ApiError(400, "validation_error", `A operação ${op} precisa de targetId (${def.target}).`);
  }
  if (!def.target && targetId) {
    throw new ApiError(400, "validation_error", `A operação ${op} cria um registro novo: não envie targetId.`);
  }
  const corpo = CORPO_DA_OPERACAO[op].safeParse(p.body.input);
  if (!corpo.success) {
    throw new ApiError(
      400,
      "validation_error",
      "Dados da ação inválidos.",
      undefined,
      corpo.error.issues.map((i) => ({ field: ["input", ...i.path].join("."), message: i.message }))
    );
  }

  const preview = await montarPreview(p.ctx, op, targetId, corpo.data);
  const identidade = await prisma.messagingIdentity.findFirst({ where: { id: deleg.identityId }, select: { channel: true } });
  if (!identidade) throw new ApiError(403, "invalid_identity", "Identidade não vinculada, desativada ou de outro workspace.");

  const agora = new Date();
  const texto = [preview.titulo, "", ...preview.linhas, "", def.pergunta].join("\n");
  const dados = {
    userId: deleg.userId,
    identityId: deleg.identityId,
    serviceAccountId: p.auth.serviceAccountId,
    channel: identidade.channel,
    operation: op,
    targetId,
    payload: preview.payload as Prisma.InputJsonValue,
    preview: texto,
    summary: { label: preview.rotulo, amount: preview.valor } as Prisma.InputJsonValue,
    stateFingerprint: hashDoPedido(preview.estado),
    confirmationCode: codigoNovo(),
    sourceMessageId: p.sourceMessageId,
    expiresAt: new Date(agora.getTime() + ttlEmMinutos() * 60_000),
  };

  // Uma pendente por usuário e canal: a nova substitui a anterior, na mesma
  // transação (o índice único parcial decide uma corrida entre duas).
  for (let tentativa = 0; ; tentativa++) {
    try {
      const criada = await prisma.$transaction(async (tx) => {
        await tx.pendingAction.updateMany({
          where: { userId: deleg.userId, channel: identidade.channel, status: "PENDING" },
          data: { status: "SUPERSEDED", decidedAt: agora },
        });
        return tx.pendingAction.create({ data: dados as Prisma.PendingActionUncheckedCreateInput });
      });
      return criada;
    } catch (e) {
      if (tentativa === 0 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------

export const ListaQuery = z
  .object({
    status: z.enum(["PENDING", "EXECUTING", "EXECUTED", "FAILED", "CANCELLED", "EXPIRED", "SUPERSEDED"]).optional(),
    sourceMessageId: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(5),
  })
  .strict();

/** Só as ações do usuário do vínculo (o agente nunca vê a de outra pessoa). */
export async function listarAcoes(auth: ApiAuth, q: z.output<typeof ListaQuery>) {
  const deleg = delegacaoObrigatoria(auth);
  const agora = new Date();
  const lidas = await prisma.pendingAction.findMany({
    where: { userId: deleg.userId, ...(q.sourceMessageId ? { sourceMessageId: q.sourceMessageId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const atuais = await Promise.all(lidas.map((a) => vencerSePreciso(a, agora)));
  return atuais.filter((a) => !q.status || a.status === q.status).slice(0, q.limit);
}

/** A ação, se for do usuário do vínculo (senão 404). Vencida → EXPIRED. */
export const consultarAcao = (auth: ApiAuth, id: string) => carregarDoUsuario(auth, id);

async function carregarDoUsuario(auth: ApiAuth, id: string): Promise<PendingAction> {
  const deleg = delegacaoObrigatoria(auth);
  const a = await prisma.pendingAction.findFirst({ where: { id } });
  // De outro usuário, de outro número ou de outro workspace: não existe.
  if (!a || a.userId !== deleg.userId || a.identityId !== deleg.identityId) {
    throw new ApiError(404, "not_found", "Ação pendente não encontrada.");
  }
  return vencerSePreciso(a);
}

const MOTIVO_NAO_PENDENTE: Record<string, string> = {
  EXECUTED: "Esta ação já foi executada.",
  EXECUTING: "Esta ação já está sendo executada.",
  FAILED: "Esta ação já foi tentada e não foi executada. Peça de novo, se ainda quiser.",
  CANCELLED: "Esta ação foi cancelada. Peça de novo, se ainda quiser.",
  SUPERSEDED: "Esta ação foi substituída por um pedido mais novo.",
};

function naoPendente(a: PendingAction): ApiError {
  if (a.status === "EXPIRED") {
    return new ApiError(410, "action_expired", "O prazo para confirmar esta ação acabou. Peça de novo, se ainda quiser.", undefined, { status: a.status });
  }
  return new ApiError(409, "action_not_pending", MOTIVO_NAO_PENDENTE[a.status] ?? "Esta ação não está aguardando confirmação.", undefined, { status: a.status });
}

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

export async function cancelarAcao(auth: ApiAuth, id: string, messageId: string | null) {
  const a = await carregarDoUsuario(auth, id);
  if (a.status !== "PENDING") throw naoPendente(a);
  const agora = new Date();
  const n = await prisma.pendingAction.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: agora, confirmationMessageId: messageId, errorCode: "cancelled_by_user" },
  });
  if (n.count === 0) throw naoPendente((await prisma.pendingAction.findFirst({ where: { id } }))!);
  return { ...a, status: "CANCELLED" as const, decidedAt: agora, confirmationMessageId: messageId, errorCode: "cancelled_by_user" };
}

// ---------------------------------------------------------------------------
// Confirmar e executar
// ---------------------------------------------------------------------------

type RespostaDaExecucao = { httpStatus: number; body: any };

/** Rota de escrita OFICIAL de cada operação (a mesma que a API expõe). */
const ROTAS: Record<OperacaoDoAgente, () => Promise<(req: Request, r?: any) => Promise<Response>>> = {
  "clients.create": async () => (await import("@/app/api/v1/clients/route")).POST,
  "clients.update": async () => (await import("@/app/api/v1/clients/[id]/route")).PATCH,
  "client_status.change": async () => (await import("@/app/api/v1/clients/[id]/status-changes/route")).POST,
  "payments.register": async () => (await import("@/app/api/v1/receivables/[id]/payments/route")).POST,
  "expenses.create": async () => (await import("@/app/api/v1/expenses/route")).POST,
  "expenses.update": async () => (await import("@/app/api/v1/expenses/[id]/route")).PATCH,
  "expenses.pay": async () => (await import("@/app/api/v1/expenses/[id]/pay/route")).POST,
  "upsells.create": async () => (await import("@/app/api/v1/upsells/route")).POST,
  "upsells.update": async () => (await import("@/app/api/v1/upsells/[id]/route")).PATCH,
  "routine.complete": async () => (await import("@/app/api/v1/routine/actions/[id]/complete/route")).POST,
};

/**
 * Executa pela rota de escrita — mesmo token, em nome do mesmo vínculo, com a
 * Idempotency-Key da confirmação. Scope, RBAC, validação, regra de domínio,
 * AuditLog, trilha e cache: tudo exatamente como numa chamada da API.
 */
async function executarPelaRota(req: Request, a: PendingAction, chave: string, requestId: string): Promise<RespostaDaExecucao> {
  const op = a.operation as OperacaoDoAgente;
  const def = OPERACOES_DE_ESCRITA[op];
  const caminho = `/api/v1${def.path.replace("{id}", encodeURIComponent(a.targetId ?? ""))}`;
  const headers: Record<string, string> = {
    authorization: req.headers.get("authorization") ?? "",
    "content-type": "application/json",
    "x-b2c-identity": a.identityId,
    "idempotency-key": chave,
    "x-request-id": `${requestId}.exec`.slice(0, 100),
    "x-correlation-id": `pa:${a.id}`,
  };
  const origem = req.headers.get("x-b2c-source");
  if (origem) headers["x-b2c-source"] = origem;
  const handler = await ROTAS[op]();
  const res = await handler(
    new Request(new URL(caminho, req.url), { method: def.method, headers, body: JSON.stringify(a.payload ?? {}) }),
    a.targetId ? { params: { id: a.targetId } } : undefined
  );
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { httpStatus: res.status, body };
}

/** Resultado guardado na PendingAction (sem a entidade inteira). */
function resultadoGuardado(r: RespostaDaExecucao) {
  const d = r.body?.data;
  const entidade = d?.payment?.id ?? d?.id ?? d?.expense?.id ?? d?.key ?? null;
  return {
    httpStatus: r.httpStatus,
    success: r.body?.success === true,
    entityId: entidade,
    requestId: r.body?.meta?.requestId ?? null,
    replayed: r.body?.meta?.idempotency?.replayed ?? false,
    ...(r.body?.success === true
      ? {}
      : {
          error: {
            code: r.body?.error?.code ?? "internal_error",
            message: r.body?.error?.message ?? null,
            // Recusa genérica do domínio: o motivo de verdade vem no primeiro detalhe.
            detail: Array.isArray(r.body?.error?.details) ? (r.body.error.details[0]?.message ?? null) : null,
          },
        }),
  };
}

/** Texto final para o WhatsApp — do resultado real, nunca da IA. */
export function mensagemDoResultado(a: Pick<PendingAction, "operation" | "summary" | "status" | "result">): string {
  const def = OPERACOES_DE_ESCRITA[a.operation as OperacaoDoAgente];
  const resumo = (a.summary ?? {}) as Resumo;
  const r = (a.result ?? {}) as ReturnType<typeof resultadoGuardado>;
  const rotulo = resumo.label ? ` — ${resumo.label}` : "";
  const valor = resumo.amount != null ? ` (${formatBRL(resumo.amount).replace(/\u00a0/g, " ")})` : "";
  if (a.status === "EXECUTED") return `✅ ${def?.feito ?? "Feito"}${rotulo}${valor}.`;
  if (!r.error || r.httpStatus >= 500 || r.error.code === "idempotency_in_progress") {
    return "⚠️ Não consegui concluir agora. Confira no B2C Finance antes de pedir de novo.";
  }
  const motivo = [r.error.message, r.error.detail].filter(Boolean).join(" — ");
  return `❌ Não executei${rotulo}: ${motivo || "o B2C Finance recusou o pedido."}`;
}

export async function confirmarAcao(p: {
  req: Request;
  auth: ApiAuth;
  ctx: DomainContext;
  id: string;
  body: z.output<typeof ConfirmacaoBody>;
  idempotencyKey: string | null;
  requestId: string;
}) {
  if (!p.idempotencyKey) {
    throw new ApiError(
      400,
      "idempotency_key_required",
      "Envie Idempotency-Key: wa:<messageId>:<actionId> (WhatsApp) ou telegram:<update_id>:<actionId> (Telegram)."
    );
  }

  let a = await carregarDoUsuario(p.auth, p.id);

  // A chave é derivada do CANAL da ação (gravado na proposta, pelo vínculo).
  const canal = a.channel === "TELEGRAM" ? "TELEGRAM" : "WHATSAPP";
  const esperada = chaveDaConfirmacao(p.body.messageId, p.id, canal);
  if (p.idempotencyKey !== esperada) {
    throw new ApiError(
      400,
      "validation_error",
      canal === "TELEGRAM"
        ? "A Idempotency-Key da confirmação é o update do Telegram + o id da ação (telegram:<update_id>:<actionId>)."
        : "A Idempotency-Key da confirmação é a mensagem do WhatsApp + o id da ação (wa:<messageId>:<actionId>)."
    );
  }
  // Botão só existe no Telegram; no WhatsApp a confirmação é sempre SIM + código.
  if (p.body.via === "button" && canal !== "TELEGRAM") {
    throw new ApiError(400, "validation_error", "Confirmação por botão só vale para ações do Telegram. Responda SIM + código.");
  }

  // A MESMA confirmação chegando de novo (reenvio da Meta, retry do n8n):
  // devolve o que aconteceu; se parou no meio, a Idempotency-Key da rota de
  // escrita garante que repetir não duplica.
  const mesmaConfirmacao = a.confirmationMessageId === p.body.messageId && a.idempotencyKey === esperada;
  if (mesmaConfirmacao && (a.status === "EXECUTED" || a.status === "FAILED")) return { acao: a, replayed: true };
  if (!(mesmaConfirmacao && a.status === "EXECUTING")) {
    if (a.status !== "PENDING") throw naoPendente(a);

    if (p.body.via === "code" && !codigosIguais(p.body.confirmationCode ?? "", a.confirmationCode)) {
      const tentativas = a.failedAttempts + 1;
      const esgotou = tentativas >= MAX_TENTATIVAS_DE_CODIGO;
      await prisma.pendingAction.updateMany({
        where: { id: a.id, status: "PENDING" },
        data: esgotou
          ? { failedAttempts: tentativas, status: "CANCELLED", decidedAt: new Date(), errorCode: "too_many_attempts" }
          : { failedAttempts: tentativas },
      });
      throw new ApiError(
        422,
        "confirmation_mismatch",
        esgotou
          ? "Código errado muitas vezes: a ação foi cancelada. Peça de novo, se ainda quiser."
          : "O código não confere com a ação que está aguardando confirmação.",
        undefined,
        { attemptsLeft: Math.max(0, MAX_TENTATIVAS_DE_CODIGO - tentativas) }
      );
    }

    // Permissão AGORA (pode ter mudado desde o preview).
    exigirScopeDaOperacao(p.auth, a.operation as OperacaoDoAgente);

    // Estado AGORA igual ao do preview? Senão o usuário confirmou outra coisa.
    let estadoAtual: string;
    try {
      const atual = await montarPreview(p.ctx, a.operation as OperacaoDoAgente, a.targetId, a.payload);
      estadoAtual = hashDoPedido(atual.estado);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      estadoAtual = `erro:${e.code}`;
    }
    if (estadoAtual !== a.stateFingerprint) {
      await prisma.pendingAction.updateMany({
        where: { id: a.id, status: "PENDING" },
        data: { status: "FAILED", decidedAt: new Date(), errorCode: "state_changed", confirmationMessageId: p.body.messageId },
      });
      throw new ApiError(
        409,
        "state_changed",
        "Os dados mudaram desde a prévia (alguém alterou no B2C Finance). Nada foi executado — peça de novo para ver a situação atual."
      );
    }

    const agora = new Date();
    const n = await prisma.pendingAction.updateMany({
      where: { id: a.id, status: "PENDING" },
      data: { status: "EXECUTING", decidedAt: agora, confirmationMessageId: p.body.messageId, idempotencyKey: esperada },
    });
    if (n.count === 0) throw naoPendente((await prisma.pendingAction.findFirst({ where: { id: a.id } }))!);
    a = { ...a, status: "EXECUTING", decidedAt: agora, confirmationMessageId: p.body.messageId, idempotencyKey: esperada };
  }

  let r: RespostaDaExecucao;
  try {
    r = await executarPelaRota(p.req, a, esperada, p.requestId);
  } catch (e) {
    console.error(`[api] ${p.requestId} falha ao executar a ação pendente ${a.id}`, e);
    r = { httpStatus: 500, body: { success: false, error: { code: "internal_error", message: null } } };
  }
  const resultado = resultadoGuardado(r);
  const final = await prisma.pendingAction.update({
    where: { id: a.id },
    data: {
      status: resultado.success ? "EXECUTED" : "FAILED",
      executedAt: resultado.success ? new Date() : null,
      result: resultado as Prisma.InputJsonValue,
      errorCode: resultado.success ? null : resultado.error?.code ?? "internal_error",
    },
  });
  return { acao: final, replayed: false };
}
