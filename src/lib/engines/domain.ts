import type { Principal, PrincipalUser } from "@/lib/auth/owner-scope";
import { hasPermission } from "@/lib/permissions";
import type { StatusCapabilities } from "@/lib/clients/status-history";

/**
 * CONTEXTO DE DOMÍNIO (27/09/2026 — preparação da API; docs/API_IMPLEMENTATION_PLAN.md).
 *
 * A mesma função de domínio é chamada pela Server Action (interface) e, no
 * futuro, pelo Route Handler da API. O que muda entre as duas é só COMO se
 * descobre quem age e de quem são os dados — isso é o DomainContext:
 *
 *   Server Action → domainContextFor(viewer) ─┐
 *   API (futuro)  → contexto da chave ─────────┼─→ salvarCliente(ctx, input)
 *                                              ┘   registerPayment(ctx, input)…
 *
 * Regras:
 *  · `ownerId` é OBRIGATÓRIO — a função roda dentro de `inDomain(ctx)`, que
 *    fixa o dono no escopo do Prisma; sem ele, nada roda.
 *  · permissão continua sendo o RBAC existente (`hasPermission`), agora
 *    consultado pelo principal do contexto, não pelo cookie.
 *  · a função de domínio NÃO lê cookie, header, nem faz redirect; e NÃO
 *    invalida cache — quem chama (action/rota) chama os revalidate* do
 *    domínio, como sempre.
 */

export type DomainContext = {
  /** Dono dos dados (escopo do Prisma). Obrigatório. */
  ownerId: string;
  /** Quem age (pessoa ou sistema). */
  principal: Principal;
  /** Amarra tudo o que o mesmo clique/chamada tocou (auditoria). */
  correlationId?: string | null;
};

/** Resultado padrão de toda função de domínio (o mesmo das actions). */
export type DomainResult<T extends object = object> =
  | ({ ok: true; id?: string; warning?: string } & T)
  | { ok: false; error: string; code?: "DUPLICADO_NOME" };

/** O principal pode fazer isto? Sistema não é pessoa: pode. */
export function domainCan(ctx: DomainContext, permission: string): boolean {
  if (ctx.principal.kind === "system") return true;
  return hasPermission(ctx.principal.user, permission);
}

/** Usuário humano do contexto (null para sistema). */
export function domainUser(ctx: DomainContext): PrincipalUser | null {
  return ctx.principal.kind === "user" ? ctx.principal.user : null;
}

/** Ator para a auditoria: pessoa, ou o sistema pelo nome. */
export function domainActor(ctx: DomainContext): { id: string | null; email: string | null } {
  return ctx.principal.kind === "user"
    ? { id: ctx.principal.user.id, email: ctx.principal.user.email }
    : { id: null, email: `sistema:${ctx.principal.name}` };
}

/** Capacidades de status (vigência) do principal — RBAC existente. */
export function statusCapabilities(ctx: DomainContext): StatusCapabilities {
  return {
    alterar: domainCan(ctx, "clientes.alterar_status"),
    programar: domainCan(ctx, "clientes.programar_status"),
    retroativo: domainCan(ctx, "clientes.alterar_status_retroativo"),
  };
}

/**
 * Roda `fn` com o dono e o principal do contexto fixados. Toda função de
 * domínio entra por aqui — é o que torna o `ownerId` obrigatório de fato.
 * Aninhar é seguro (mesmo dono, mesmo principal).
 */
export async function inDomain<T>(ctx: DomainContext, fn: () => Promise<T>): Promise<T> {
  if (!ctx?.ownerId) throw new Error("Contexto de domínio sem dono (ownerId) — operação recusada.");
  const { runWithPrincipal } = await import("@/lib/auth/owner-scope");
  return runWithPrincipal(ctx.ownerId, ctx.principal, fn);
}
