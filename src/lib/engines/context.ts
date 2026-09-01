import { randomUUID } from "crypto";
import type { AuditOrigin } from "@prisma/client";

/**
 * CONTEXTO DE UMA OPERAÇÃO DE DOMÍNIO (F1.5 · ref. 03 §4.1, §4.7).
 *
 * Carrega o que TODA etapa do pipeline precisa saber e que nenhuma delas
 * deveria ter de descobrir por conta própria: quem está agindo, de onde
 * veio a ação, por quê, e o identificador que amarra as N linhas geradas
 * (auditoria, razão, outbox) a uma operação só.
 *
 * O correlationId existe para a pergunta de suporte mais comum: "o que
 * mais aconteceu junto com isso?". Sem ele, as linhas ficam espalhadas em
 * quatro tabelas sem nada em comum além do horário aproximado.
 */
export type EngineContext = {
  actorId: string | null;
  actorEmail: string | null;
  origin: AuditOrigin;
  reason: string | null;
  correlationId: string;
};

export function newCorrelationId(): string {
  return randomUUID();
}

/** Contexto de uma ação disparada por uma pessoa na interface. */
export async function contextFromRequest(
  opts: { reason?: string | null; origin?: AuditOrigin } = {}
): Promise<EngineContext> {
  // Import PREGUIÇOSO de propósito: getCurrentUser usa o cache() do React,
  // que só existe dentro de uma request. Importar no topo quebraria todo
  // módulo que apenas passa por aqui.
  //
  // E FORA de uma request — job, script, teste — a chamada em si lança.
  // Um motor de domínio não pode quebrar por não haver usuário logado:
  // ele degrada para contexto de sistema, que é a verdade do caso (não
  // houve pessoa). O fato continua auditado, com actor nulo e origem JOB.
  try {
    const { getCurrentUser } = await import("@/lib/auth/current-user");
    const u = await getCurrentUser();
    // T7 — o id da REQUISIÇÃO (carimbado no middleware) amarra tudo o que o
    // mesmo clique tocou. Sem header (teste, chamada direta), gera um.
    let correlationId: string | null = null;
    try {
      const { headers } = await import("next/headers");
      correlationId = headers().get("x-correlation-id");
    } catch {
      /* fora de request */
    }
    return {
      actorId: u?.id ?? null,
      actorEmail: u?.email ?? null,
      origin: opts.origin ?? "UI",
      reason: opts.reason ?? null,
      correlationId: correlationId ?? newCorrelationId(),
    };
  } catch {
    return systemContext(opts.origin ?? "JOB", opts.reason);
  }
}

/** Contexto de job, import ou teste — sem pessoa por trás. */
export function systemContext(
  origin: AuditOrigin = "JOB",
  reason?: string | null
): EngineContext {
  return {
    actorId: null,
    actorEmail: null,
    origin,
    reason: reason ?? null,
    correlationId: newCorrelationId(),
  };
}
