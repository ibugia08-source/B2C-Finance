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
  // módulo que apenas passa por aqui — inclusive os motores, em teste e em
  // job, onde não há request nenhuma.
  const { getCurrentUser } = await import("@/lib/auth/current-user");
  const u = await getCurrentUser();
  return {
    actorId: u?.id ?? null,
    actorEmail: u?.email ?? null,
    origin: opts.origin ?? "UI",
    reason: opts.reason ?? null,
    correlationId: newCorrelationId(),
  };
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
