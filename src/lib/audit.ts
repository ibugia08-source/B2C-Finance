import { prisma } from "@/lib/prisma";
import type { AuditAction, AuditOrigin, Prisma } from "@prisma/client";

/**
 * HELPER ÚNICO DE ESCRITA DA TRILHA (F1.9 · ref. 01 §4.10).
 *
 * "AuditLog append-only campo a campo (...); helper único de escrita."
 *
 * Único de propósito: se cada tela montasse a linha do seu jeito, metade
 * ficaria sem motivo, metade sem origem, e a trilha viraria um amontoado
 * que não responde pergunta nenhuma. Aqui a forma é uma só.
 *
 * A trava de append-only está no BANCO (gatilho que recusa UPDATE e
 * DELETE). Este módulo não tem — e não deve ganhar — função de apagar.
 */

/** Campos que NUNCA entram na trilha, mesmo se passarem pelo diff. */
const NUNCA_REGISTRAR = new Set([
  "updatedAt",
  "createdAt",
  "passwordHash",
  "password",
  "token",
]);

export type AuditContext = {
  origin?: AuditOrigin;
  reason?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  /** Amarra as N linhas de uma mesma operação. */
  correlationId?: string | null;
};

/** Cliente de transação ou o prisma normal — a trilha acompanha o fato. */
type Escritor = {
  auditLog: { createMany: (a: any) => Promise<any>; create: (a: any) => Promise<any> };
};

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Registra a DIFERENÇA entre dois estados, campo a campo.
 *
 * Só grava o que MUDOU: registrar campo que continuou igual enche a trilha
 * de ruído e esconde a linha que interessa.
 */
export async function auditUpdate(
  db: Escritor,
  entity: string,
  entityId: string,
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
  ctx: AuditContext = {}
): Promise<number> {
  const linhas: Prisma.AuditLogCreateManyInput[] = [];
  for (const campo of Object.keys(depois)) {
    if (NUNCA_REGISTRAR.has(campo)) continue;
    const de = texto(antes[campo]);
    const para = texto(depois[campo]);
    if (de === para) continue;
    linhas.push({
      entity,
      entityId,
      action: "UPDATE",
      field: campo,
      oldValue: de,
      newValue: para,
      origin: ctx.origin ?? "UI",
      reason: ctx.reason ?? null,
      actorId: ctx.actorId ?? null,
      actorEmail: ctx.actorEmail ?? null,
      correlationId: ctx.correlationId ?? null,
    });
  }
  if (linhas.length === 0) return 0;
  await db.auditLog.createMany({ data: linhas });
  return linhas.length;
}

/** Criação, exclusão ou estorno: a linha inteira é o fato, não um campo. */
export async function auditEvent(
  db: Escritor,
  entity: string,
  entityId: string,
  action: Exclude<AuditAction, "UPDATE">,
  ctx: AuditContext = {}
): Promise<void> {
  await db.auditLog.create({
    data: {
      entity,
      entityId,
      action,
      origin: ctx.origin ?? "UI",
      reason: ctx.reason ?? null,
      actorId: ctx.actorId ?? null,
      actorEmail: ctx.actorEmail ?? null,
      correlationId: ctx.correlationId ?? null,
    },
  });
}

/**
 * Ações que 01 §4.10 exige MOTIVO. Chamar sem motivo é erro de programação,
 * não de usuário — por isso lança em vez de devolver `{ok:false}`.
 */
const EXIGEM_MOTIVO = new Set(["REVERSE", "DELETE"]);

export function assertReason(action: AuditAction, reason?: string | null) {
  if (EXIGEM_MOTIVO.has(action) && !reason?.trim()) {
    throw new Error(`Auditoria: ${action} exige motivo (01 §4.10).`);
  }
}

/** Histórico de uma entidade, do mais recente ao mais antigo. */
export function auditTrail(entity: string, entityId: string, take = 100) {
  return prisma.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
