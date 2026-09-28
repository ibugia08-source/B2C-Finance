import { type DomainContext, domainUser, inDomain } from "@/lib/engines/domain";
import { canViewReport, getReport } from "./registry";
import type { ReportQuery } from "./query";
import type { ReportDef, ReportRow } from "./shared";

/**
 * EXECUÇÃO DE RELATÓRIO — domínio (27/09/2026). A página, a exportação e a
 * futura API perguntam do mesmo jeito "este principal pode ver este
 * relatório?" (canViewReport, com a regra do Contador e da folha) e executam
 * o mesmo `build`. Formatação/apresentação continua com quem chama.
 */

export type AcessoAoRelatorio =
  | { ok: true; def: ReportDef }
  | { ok: false; code: "NAO_ENCONTRADO" | "SEM_PERMISSAO"; error: string };

/** Relatório existe e o principal pode vê-lo? Sistema (job) pode todos. */
export function acessoAoRelatorio(ctx: DomainContext, key: string): AcessoAoRelatorio {
  const def = getReport(key);
  if (!def) return { ok: false, code: "NAO_ENCONTRADO", error: "Relatório inexistente." };
  const user = domainUser(ctx);
  if (ctx.principal.kind !== "system" && !canViewReport(user, def))
    return { ok: false, code: "SEM_PERMISSAO", error: "Acesso negado a este relatório." };
  return { ok: true, def };
}

/** Linhas cruas do relatório, no escopo do dono do contexto. */
export async function executarRelatorio(
  ctx: DomainContext,
  def: ReportDef,
  query: ReportQuery
): Promise<ReportRow[]> {
  return inDomain(ctx, async () => await def.build(query));
}
