import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { auditEvent, auditUpdate } from "@/lib/audit";
import { type DomainContext, domainUser, inDomain } from "@/lib/engines/domain";
import { parseApiScopes } from "@/lib/api/scopes";
import { gerarToken } from "@/lib/api/tokens";

/**
 * INTEGRAÇÕES (contas de serviço da API) — 28/09/2026, docs/API_AUTHENTICATION.md.
 *
 * Gerenciar é gesto de PESSOA com `integracoes.gerenciar` (travada no ADMIN).
 * Um principal de sistema — inclusive uma conta de serviço chamando a API —
 * NUNCA gerencia integrações: uma chave não cria outra chave.
 *
 * O token completo sai daqui UMA vez (criar/rotacionar) e não é gravado em
 * lugar nenhum: nem no banco (só o hash), nem na auditoria (só o prefixo).
 */

export const PRAZOS_DE_VALIDADE = [30, 90, 180, 365] as const;

export const IntegracaoInputSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da integração.").max(80, "Nome longo demais."),
  description: z
    .string()
    .trim()
    .max(300, "Descrição longa demais.")
    .optional()
    .transform((v) => v || null),
  scopes: z.array(z.string()),
  /** null = sem expiração. */
  expiresInDays: z
    .number()
    .int()
    .nullable()
    .refine((d) => d === null || (PRAZOS_DE_VALIDADE as readonly number[]).includes(d), "Validade inválida."),
});
export type IntegracaoInput = z.input<typeof IntegracaoInputSchema>;

type Falha = { ok: false; error: string; code?: "SEM_PERMISSAO" | "NAO_ENCONTRADO" | "INVALIDO" };
export type TokenEmitido = { ok: true; id: string; token: string; tokenPrefix: string };

const SEM_PERMISSAO: Falha = {
  ok: false,
  code: "SEM_PERMISSAO",
  error: "Só o administrador pode gerenciar integrações.",
};
const NAO_ENCONTRADA: Falha = { ok: false, code: "NAO_ENCONTRADO", error: "Integração não encontrada." };

const DIA_MS = 86_400_000;

function gestor(ctx: DomainContext) {
  const u = domainUser(ctx);
  return u && hasPermission(u, "integracoes.gerenciar") ? u : null;
}

export function podeVerIntegracoes(ctx: DomainContext): boolean {
  const u = domainUser(ctx);
  return !!u && (hasPermission(u, "integracoes.visualizar") || hasPermission(u, "integracoes.gerenciar"));
}

export function podeGerenciarIntegracoes(ctx: DomainContext): boolean {
  return !!gestor(ctx);
}

function auditCtx(ctx: DomainContext, reason: string) {
  const u = domainUser(ctx);
  return {
    origin: "UI" as const,
    reason,
    actorId: u?.id ?? null,
    actorEmail: u?.email ?? null,
    correlationId: ctx.correlationId ?? null,
  };
}

export type IntegracaoResumo = {
  id: string;
  name: string;
  description: string | null;
  type: "INTEGRATION";
  status: "ACTIVE" | "REVOKED";
  tokenPrefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  rotatedAt: Date | null;
};

/** Lista do dono do contexto (nunca devolve o hash). */
export async function listarIntegracoes(ctx: DomainContext): Promise<IntegracaoResumo[]> {
  if (!podeVerIntegracoes(ctx)) return [];
  return inDomain(ctx, async () =>
    await prisma.serviceAccount.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, name: true, description: true, type: true, status: true, tokenPrefix: true,
        scopes: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true, rotatedAt: true,
      },
    })
  );
}

export async function criarIntegracao(
  ctx: DomainContext,
  entrada: IntegracaoInput,
  now: Date = new Date()
): Promise<TokenEmitido | Falha> {
  const u = gestor(ctx);
  if (!u) return SEM_PERMISSAO;
  const parsed = IntegracaoInputSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, code: "INVALIDO", error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const scopes = parseApiScopes(parsed.data.scopes);
  if (!scopes.ok) return { ok: false, code: "INVALIDO", error: scopes.error };

  const { token, tokenPrefix, tokenHash } = gerarToken();
  const expiresAt = parsed.data.expiresInDays ? new Date(now.getTime() + parsed.data.expiresInDays * DIA_MS) : null;

  const criada = await inDomain(ctx, async () =>
    await prisma.$transaction(async (tx) => {
      const sa = await tx.serviceAccount.create({
        data: {
          ownerId: ctx.ownerId,
          type: "INTEGRATION",
          status: "ACTIVE",
          name: parsed.data.name,
          description: parsed.data.description,
          tokenHash,
          tokenPrefix,
          scopes: scopes.scopes,
          expiresAt,
          createdById: u.id,
        },
        select: { id: true },
      });
      await auditEvent(tx, "ServiceAccount", sa.id, "CREATE", auditCtx(ctx, `Integração criada (${tokenPrefix}; scopes: ${scopes.scopes.join(", ")})`));
      return sa;
    })
  );
  return { ok: true, id: criada.id, token, tokenPrefix };
}

export async function revogarIntegracao(
  ctx: DomainContext,
  id: string,
  now: Date = new Date()
): Promise<{ ok: true } | Falha> {
  const u = gestor(ctx);
  if (!u) return SEM_PERMISSAO;
  return inDomain(ctx, async () => {
    // Leitura ESCOPADA antes de alterar: id de outro dono = não encontrada.
    const atual = await prisma.serviceAccount.findFirst({ where: { id }, select: { id: true, status: true, tokenPrefix: true } });
    if (!atual) return NAO_ENCONTRADA;
    if (atual.status === "REVOKED") return { ok: true as const };
    await prisma.$transaction(async (tx) => {
      // updateMany: escopado por dono pela extensão e idempotente sob corrida.
      await tx.serviceAccount.updateMany({
        where: { id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now, revokedById: u.id },
      });
      await auditUpdate(tx, "ServiceAccount", id, { status: "ACTIVE", revokedAt: null }, { status: "REVOKED", revokedAt: now },
        auditCtx(ctx, `Integração revogada (${atual.tokenPrefix})`));
    });
    return { ok: true as const };
  });
}

/**
 * Troca o token: gera outro, grava o novo hash e prefixo. O token anterior
 * para de valer NA HORA (não há período de convivência — docs). A validade
 * se renova pelo mesmo prazo que a chave tinha.
 */
export async function rotacionarIntegracao(
  ctx: DomainContext,
  id: string,
  now: Date = new Date()
): Promise<TokenEmitido | Falha> {
  const u = gestor(ctx);
  if (!u) return SEM_PERMISSAO;
  return inDomain(ctx, async () => {
    const atual = await prisma.serviceAccount.findFirst({
      where: { id },
      select: { id: true, status: true, tokenPrefix: true, createdAt: true, rotatedAt: true, expiresAt: true },
    });
    if (!atual) return NAO_ENCONTRADA;
    if (atual.status === "REVOKED") {
      return { ok: false as const, code: "INVALIDO" as const, error: "Integração revogada não pode ser rotacionada. Crie uma nova." };
    }
    const { token, tokenPrefix, tokenHash } = gerarToken();
    const prazo = atual.expiresAt ? atual.expiresAt.getTime() - (atual.rotatedAt ?? atual.createdAt).getTime() : null;
    const expiresAt = prazo ? new Date(now.getTime() + prazo) : null;
    const trocou = await prisma.$transaction(async (tx) => {
      const r = await tx.serviceAccount.updateMany({
        where: { id, status: "ACTIVE", tokenPrefix: atual.tokenPrefix },
        data: { tokenHash, tokenPrefix, rotatedAt: now, expiresAt },
      });
      if (r.count === 0) return false;
      await auditUpdate(tx, "ServiceAccount", id,
        { tokenPrefix: atual.tokenPrefix, expiresAt: atual.expiresAt },
        { tokenPrefix, expiresAt },
        auditCtx(ctx, "Chave rotacionada"));
      return true;
    });
    if (!trocou) return { ok: false as const, code: "INVALIDO" as const, error: "A integração mudou enquanto você rotacionava. Recarregue e tente de novo." };
    return { ok: true as const, id, token, tokenPrefix };
  });
}
