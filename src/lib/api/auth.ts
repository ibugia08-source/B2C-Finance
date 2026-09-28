import { prisma } from "@/lib/prisma";
import { runWithoutScope, type Principal } from "@/lib/auth/owner-scope";
import type { DomainContext } from "@/lib/engines/domain";
import { isApiScope } from "./scopes";
import { HASH_FANTASMA, hashToken, hashesIguais, prefixoDoToken } from "./tokens";

/**
 * AUTENTICAÇÃO DA API /api/v1 (28/09/2026 — docs/API_AUTHENTICATION.md).
 *
 * Credencial = `Authorization: Bearer b2c_live_…` de uma CONTA DE SERVIÇO.
 * O cookie de sessão do navegador NÃO é lido aqui em hipótese nenhuma: a
 * rota da API só conhece o token, e o dono dos dados sai da conta, não da
 * sessão (a execução roda sob `runWithPrincipal`, que fixa o dono antes de
 * qualquer query — `resolveOwnerId` nunca chega ao cookie).
 *
 * Ordem da validação: formato → conta (por prefixo) → hash (tempo
 * constante) → revogação → expiração → dono ativo → scope.
 */

/** Uma vez por minuto, no máximo, por conta: leitura não vira escrita a cada chamada. */
export const LAST_USED_JANELA_MS = 60_000;

export type ApiAuth = {
  serviceAccountId: string;
  name: string;
  ownerId: string;
  tokenPrefix: string;
  scopes: string[];
  principal: Principal;
};

export type ApiErrorCode =
  | "missing_token"
  | "invalid_token"
  | "revoked_token"
  | "expired_token"
  | "inactive_owner"
  | "insufficient_scope"
  | "validation_error"
  | "not_found"
  | "rate_limited"
  | "idempotency_key_required"
  | "idempotency_key_reused"
  | "idempotency_in_progress"
  | "unprocessable"
  | "duplicate"
  | "possible_duplicate"
  | "invalid_state"
  | "competence_closed"
  | "retroactive_requires_confirmation"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly scope?: string,
    /** Detalhes seguros para o cliente (ex.: campos inválidos). Nunca stack. */
    readonly details?: unknown
  ) {
    super(message);
  }
}

export type ApiAuthResult =
  | { ok: true; auth: ApiAuth }
  | {
      ok: false;
      error: ApiError;
      /** Só quando o token CONFERE (revogado, expirado, dono inativo): quem tentou. */
      conta?: { serviceAccountId: string; ownerId: string };
    };

const falha = (code: ApiErrorCode, msg: string, conta?: { serviceAccountId: string; ownerId: string }): ApiAuthResult => ({
  ok: false,
  error: new ApiError(401, code, msg),
  ...(conta ? { conta } : {}),
});

/** Extrai o token do header Authorization (só o esquema Bearer). */
export function tokenDoHeader(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  return m ? m[1] : null;
}

/**
 * Valida o token e devolve a identidade da conta. Não lança: 401 vira
 * resultado. O scope é conferido depois, por `requireApiScope`.
 */
export async function authenticateApiToken(
  authorization: string | null | undefined,
  now: Date = new Date()
): Promise<ApiAuthResult> {
  const token = tokenDoHeader(authorization);
  if (!token) return falha("missing_token", "Envie o token no header Authorization: Bearer <token>.");

  const tokenPrefix = prefixoDoToken(token);
  // Formato inválido não consulta o banco. (O formato não é segredo.)
  if (!tokenPrefix) return falha("invalid_token", "Token inválido.");

  // A ÚNICA leitura sem escopo de dono: ainda não sabemos de quem é a conta.
  // É por índice único de um valor público — não lista nada de ninguém.
  const conta = await runWithoutScope(async () =>
    await prisma.serviceAccount.findUnique({
      where: { tokenPrefix },
      select: {
        id: true, ownerId: true, name: true, status: true, tokenHash: true,
        scopes: true, expiresAt: true, revokedAt: true, lastUsedAt: true,
      },
    })
  );

  // Tempo constante: a comparação roda mesmo quando não há conta, contra um
  // hash fantasma, para "prefixo inexistente" e "segredo errado" custarem o
  // mesmo e responderem a mesma coisa.
  const confere = hashesIguais(hashToken(token), conta?.tokenHash ?? HASH_FANTASMA);
  if (!conta || !confere) return falha("invalid_token", "Token inválido.");

  const quem = { serviceAccountId: conta.id, ownerId: conta.ownerId };
  if (conta.status !== "ACTIVE" || conta.revokedAt) {
    return falha("revoked_token", "Esta integração foi revogada.", quem);
  }
  if (conta.expiresAt && conta.expiresAt.getTime() <= now.getTime()) {
    return falha("expired_token", "O token desta integração expirou. Rotacione a chave.", quem);
  }

  // O dono dos dados precisa existir e estar ativo: conta de um workspace
  // desativado não lê nada.
  const dono = await prisma.user.findUnique({
    where: { id: conta.ownerId },
    select: { active: true },
  });
  if (!dono?.active) return falha("inactive_owner", "O workspace desta integração está inativo.", quem);

  await marcarUso(conta.id, conta.lastUsedAt, now);

  // Scope fora do catálogo atual (ex.: removido numa versão futura) não vale.
  const scopes = conta.scopes.filter(isApiScope);
  return {
    ok: true,
    auth: {
      serviceAccountId: conta.id,
      name: conta.name,
      ownerId: conta.ownerId,
      tokenPrefix,
      scopes,
      principal: {
        kind: "system",
        name: `api:${conta.name}`,
        origin: "API",
        serviceAccount: { id: conta.id, name: conta.name, scopes },
      },
    },
  };
}

/**
 * lastUsedAt amostrado: grava só se o último registro tem mais de um minuto.
 * O `WHERE` repete a condição, então N requisições simultâneas geram no
 * máximo uma escrita efetiva. Falha aqui NUNCA derruba a requisição.
 */
async function marcarUso(id: string, ultimo: Date | null, now: Date) {
  const limite = new Date(now.getTime() - LAST_USED_JANELA_MS);
  if (ultimo && ultimo > limite) return;
  try {
    await runWithoutScope(async () =>
      await prisma.serviceAccount.updateMany({
        where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: limite } }] },
        data: { lastUsedAt: now },
      })
    );
  } catch (e) {
    console.error("[api] falha ao registrar lastUsedAt", e);
  }
}

/** Exige o scope; sem ele, 403 `insufficient_scope`. */
export function requireApiScope(auth: ApiAuth, scope: string): void {
  if (!isApiScope(scope)) throw new Error(`Scope fora do catálogo: ${scope}`); // erro de programação
  if (!auth.scopes.includes(scope)) {
    throw new ApiError(403, "insufficient_scope", `Esta integração não tem o scope “${scope}”.`, scope);
  }
}

/** Contexto de domínio da chamada — o mesmo tipo que as Server Actions usam. */
export function apiDomainContext(auth: ApiAuth, correlationId: string | null = null): DomainContext {
  return { ownerId: auth.ownerId, principal: auth.principal, correlationId };
}
