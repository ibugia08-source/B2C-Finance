import { unstable_cache } from "next/cache";
import { resolveOwnerId, runWithOwner } from "@/lib/auth/owner-scope";
import { scopeKeyParts, scopeFromSession, type CacheScope } from "@/lib/cache-scope";

/**
 * unstable_cache com escopo multiusuário correto.
 *
 * Dentro do callback do unstable_cache, cookies() lança erro — o escopo por
 * dono cairia no fail-closed "__no_owner__" e o cache serviria dados vazios
 * (bug que zerava o dashboard). Este helper resolve o ownerId NA REQUEST,
 * injeta-o como primeiro argumento do callback (entrando automaticamente na
 * chave de cache — uma entrada por usuário, sem vazamento entre contas) e
 * fixa o escopo via runWithOwner dentro do callback.
 *
 * Os demais argumentos também compõem a chave (serializados pelo Next);
 * Dates viram ISO strings de forma estável. ATENÇÃO: o RESULTADO também é
 * serializado — campos Date voltam como string em cache hit; use apenas em
 * funções cujos consumidores tolerem isso (números/strings são o ideal).
 *
 * FORA DE UMA REQUEST (scripts de conferência, testes, jobs), o
 * `unstable_cache` do Next lança "incrementalCache missing". Com
 * B2C_DISABLE_CACHE=1 o helper executa a função direto, no escopo do dono —
 * mesmo resultado, sem cache. É como a suíte de paridade consegue exercitar
 * exatamente os serviços que a tela usa.
 */
export function ownerCached<A extends unknown[], R>(
  keyBase: string,
  fn: (...args: A) => Promise<R>,
  opts: { revalidate: number; tags: string[] }
): (...args: A) => Promise<R> {
  const cached = unstable_cache(
    // F1.11 — as partes do escopo entram como ARGUMENTOS, e o Next as
    // serializa na chave. O primeiro (ownerId) também fixa o escopo do
    // Prisma; os demais existem só para SEPARAR entradas.
    (chave: string[], ownerId: string | null, ...args: A) =>
      runWithOwner(ownerId, () => fn(...args)),
    [keyBase],
    opts
  );
  return async (...args: A) => {
    if (process.env.B2C_DISABLE_CACHE === "1") return fn(...args);
    const scope = await currentCacheScope();
    return cached(scopeKeyParts(scope), scope.ownerId, ...args);
  };
}

/**
 * Escopo da request atual, a partir do TOKEN (sem tocar o banco).
 *
 * Fora de uma request — job, script — não há sessão: cai no ownerId
 * explícito do contexto, que é o que runWithOwner já fixou.
 */
async function currentCacheScope(): Promise<CacheScope> {
  try {
    const { cookies } = await import("next/headers");
    const { SESSION_COOKIE, verifySessionToken } = await import("@/lib/auth/session");
    const payload = verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
    if (payload) return scopeFromSession(payload);
  } catch {
    /* sem request: segue para o contexto explícito */
  }
  return { ...scopeFromSession(null), ownerId: await resolveOwnerId() };
}
