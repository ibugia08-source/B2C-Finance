import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditEvent, auditUpdate } from "@/lib/audit";
import { type DomainContext, domainActor, inDomain } from "@/lib/engines/domain";
import { parseDateBR } from "@/lib/format";
import { todayKey } from "@/lib/competence";
import { ApiError } from "../auth";
import { dataSchema } from "../http";

/**
 * PEÇAS COMUNS DAS ESCRITAS DA API V1 (28/09/2026).
 *
 * Toda escrita passa por `defineEndpoint({ write })` — scope, Idempotency-Key,
 * trilha de atividades e dono (a execução roda no dono da conta de serviço;
 * id de outro dono = 404). A REGRA é sempre a função de domínio que a tela
 * usa; aqui só entram validação do contrato, tradução de erro e auditoria.
 */

/** Data civil "AAAA-MM-DD" → o mesmo Date que o formulário da tela grava. */
export function dataCivil(v: string): Date {
  const d = parseDateBR(v);
  if (!d) throw new ApiError(400, "validation_error", `Data inválida: ${v}`);
  return d;
}

export const hoje = () => todayKey();

/** Resultado de domínio `{ ok:false, error }` → erro HTTP com código estável. */
export function falhaDoDominio(r: { error: string; code?: string }): ApiError {
  if (r.code === "DUPLICADO_NOME") return new ApiError(409, "duplicate", r.error);
  if (/não encontrad/i.test(r.error)) return new ApiError(404, "not_found", r.error);
  if (/permiss/i.test(r.error)) return new ApiError(403, "insufficient_scope", r.error);
  if (/fechad/i.test(r.error)) return new ApiError(422, "competence_closed", r.error);
  return new ApiError(422, "unprocessable", r.error);
}

/**
 * AuditLog (trilha campo a campo) das entidades cujo domínio ainda não
 * audita sozinho (cadastro de cliente, despesa, upsell). Pagamento, status
 * e "pagar despesa" já auditam no motor — não se duplica aqui.
 */
export async function auditar(
  ctx: DomainContext,
  p:
    | { tipo: "CREATE"; entity: string; id: string; motivo: string }
    | { tipo: "UPDATE"; entity: string; id: string; antes: Record<string, unknown>; depois: Record<string, unknown>; motivo: string }
): Promise<void> {
  const ator = domainActor(ctx);
  const a = {
    origin: "API" as const,
    reason: p.motivo,
    actorId: ator.id,
    actorEmail: ator.email,
    correlationId: ctx.correlationId ?? null,
  };
  // Decimal do Prisma vira número (senão a trilha grava "\"350\"").
  const plano = (o: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, v && typeof v === "object" && "toNumber" in (v as object) ? Number(v) : v])
    );
  await inDomain(ctx, async () => {
    if (p.tipo === "CREATE") await auditEvent(prisma, p.entity, p.id, "CREATE", a);
    else await auditUpdate(prisma, p.entity, p.id, plano(p.antes), plano(p.depois), a);
  });
}

/** Campo de data opcional/anulável do corpo. */
export const dataOpcional = dataSchema.nullable().optional();

/** Dinheiro: positivo, no máximo 2 casas. */
export const valor = z
  .number()
  .positive("O valor deve ser maior que zero.")
  .max(100_000_000)
  .refine((v) => Math.round(v * 100) === Math.round(v * 100 * 1e6) / 1e6, "Use no máximo 2 casas decimais.");

/** Colaborador (responsável) do dono: id → nome. 404 se não for do dono. */
export async function colaborador(id: string): Promise<{ id: string; name: string }> {
  const emp = await prisma.employee.findFirst({ where: { id }, select: { id: true, name: true } });
  if (!emp) throw new ApiError(404, "not_found", "Responsável (colaborador) não encontrado.");
  return emp;
}
