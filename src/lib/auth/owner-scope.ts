import { AsyncLocalStorage } from "async_hooks";

/**
 * Contexto de "dono" (multiusuário) por requisição/execução.
 *
 * A extensão do Prisma (em lib/prisma.ts) usa este contexto para injetar
 * automaticamente `ownerId` em toda leitura/criação das entidades privadas —
 * garantindo que cada usuário só veja/crie os próprios dados, sem precisar
 * passar ownerId manualmente em cada query.
 *
 * Fontes do dono, nesta ordem:
 *   1. contexto explícito (runWithOwner) — usado por jobs sem sessão
 *      (WhatsApp, lembretes) e por scripts;
 *   2. sessão do usuário logado (cookie), resolvida sob demanda.
 */

export type OwnerContext = {
  ownerId: string | null;
  /** true → ignora o escopo (scripts de manutenção / seed). */
  bypass?: boolean;
};

const storage = new AsyncLocalStorage<OwnerContext>();

/** Executa `fn` com um dono fixado (jobs sem sessão, testes, migração). */
export function runWithOwner<T>(ownerId: string | null, fn: () => Promise<T>): Promise<T> {
  return storage.run({ ownerId }, fn);
}

/** Executa `fn` ignorando totalmente o escopo (acesso completo). */
export function runWithoutScope<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ ownerId: null, bypass: true }, fn);
}

export function getOwnerContext(): OwnerContext | undefined {
  return storage.getStore();
}

/**
 * Resolve o dono efetivo para a query atual:
 *   - contexto explícito (runWithOwner) tem prioridade;
 *   - senão, lê o uid do cookie de sessão (sem tocar o banco → barato e sem
 *     recursão dentro da extensão do Prisma).
 * Retorna null quando não há sessão (fora de request, build, webhook sem contexto).
 */
export async function resolveOwnerId(): Promise<string | null> {
  const ctx = storage.getStore();
  if (ctx) return ctx.ownerId; // explícito (inclui null intencional)

  try {
    const { cookies } = await import("next/headers");
    const { SESSION_COOKIE, verifySessionToken } = await import("./session");
    const token = cookies().get(SESSION_COOKIE)?.value;
    const payload = verifySessionToken(token);
    return payload?.uid ?? null;
  } catch {
    return null;
  }
}
