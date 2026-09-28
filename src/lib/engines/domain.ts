import type { Principal, PrincipalUser } from "@/lib/auth/owner-scope";
import { hasPermission } from "@/lib/permissions";
import { scopePermite } from "@/lib/api/scopes";
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

/**
 * O principal pode fazer isto? Sistema não é pessoa: pode — exceto a CONTA DE
 * SERVIÇO da API, que pode só o que os scopes dela cobrem (fail-closed).
 */
export function domainCan(ctx: DomainContext, permission: string): boolean {
  if (ctx.principal.kind === "system") {
    const sa = ctx.principal.serviceAccount;
    return sa ? scopePermite(sa.scopes, permission) : true;
  }
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
 * Aninhar é seguro (mesmo dono, mesmo principal). `fn` deve ser `async` e
 * dar `await` nas consultas — PrismaPromise devolvida crua roda FORA do escopo.
 */
export async function inDomain<T>(ctx: DomainContext, fn: () => Promise<T>): Promise<T> {
  if (!ctx?.ownerId) throw new Error("Contexto de domínio sem dono (ownerId) — operação recusada.");
  const { runWithPrincipal } = await import("@/lib/auth/owner-scope");
  return runWithPrincipal(ctx.ownerId, ctx.principal, fn);
}

/**
 * DONO DO REGISTRO (D5 do plano da API). A extensão do Prisma filtra por dono
 * nas leituras e em updateMany/deleteMany, mas `update`/`delete` por id único
 * NÃO conferem o dono. Toda função de domínio que recebe um id de fora
 * (formulário, API) carrega o registro por leitura ESCOPADA antes de alterar;
 * este helper é a forma explícita disso para quem não precisa do registro.
 * Id de outro dono = "não encontrado" (nunca "proibido": não confirma que existe).
 */
export async function exigirDoDono(
  ctx: DomainContext,
  model: "client" | "billing" | "payment" | "transaction" | "contract" | "upsell" | "account",
  id: string,
  rotulo = "Registro"
): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  // `await` DENTRO do callback: PrismaPromise devolvida sem await executa fora
  // do contexto do dono (armadilha documentada em auth/owner-scope.ts).
  const achado = await inDomain(ctx, async () =>
    await (prisma as any)[model].findFirst({ where: { id }, select: { id: true } })
  );
  if (!achado) throw new DomainNotFoundError(`${rotulo} não encontrado.`);
}

export class DomainNotFoundError extends Error {
  readonly code = "NAO_ENCONTRADO" as const;
}
