import { prisma } from "@/lib/prisma";
import { parseDataScope, type DataScope } from "@/lib/scope";
import type { Prisma } from "@prisma/client";

/**
 * APLICAÇÃO do recorte de dados nas consultas (F1.10 · 03 §1.1).
 *
 * A extensão do Prisma já filtra por DONO (multiusuário). Isto é a camada de
 * cima: dentro do mesmo dono, QUAL FATIA este usuário enxerga.
 *
 * Regra de ouro deste arquivo: o recorte é sempre um filtro POSITIVO — ele diz
 * o que entra, nunca o que sai. Filtro negativo ("tudo menos X") erra por
 * omissão quando aparece uma tabela nova, e erra calado.
 */

/**
 * Recorte do usuário da requisição. Fora de requisição, o recorte é o total.
 *
 * `getCurrentUser` é importado TARDE de propósito: ele usa o cache() do React,
 * que estoura fora de uma requisição. Import no topo quebraria a suíte e todo
 * job que precise de recorte — a mesma armadilha já documentada em
 * lib/engines/context.ts.
 */
export async function escopoAtual(): Promise<DataScope> {
  try {
    const { getCurrentUser } = await import("@/lib/auth/current-user");
    const u = await getCurrentUser();
    if (!u) return { kind: "WORKSPACE" };
    // getCurrentUser não carrega os campos de recorte (é quente, roda em toda
    // renderização) — buscamos só quando alguém realmente precisa do recorte.
    const row = await prisma.user.findUnique({
      where: { id: u.id },
      select: { role: true, dataScope: true, scopeAgencyId: true },
    });
    return parseDataScope(row ?? { role: u.role });
  } catch {
    // Job, teste ou script: sem requisição não há usuário, e o recorte total é
    // a verdade do caso (quem chama já passou pela guarda de dono).
    return { kind: "WORKSPACE" };
  }
}

/** Filtro pronto para consultas em ClientAgencyRelationship. */
export function whereDaRelacao(scope: DataScope): Prisma.ClientAgencyRelationshipWhereInput {
  return scope.kind === "AGENCY" ? { agencyId: scope.agencyId } : {};
}

/** Filtro pronto para consultas em Billing (que carrega relationshipId). */
export function whereDaCobranca(scope: DataScope): Prisma.BillingWhereInput {
  return scope.kind === "AGENCY"
    ? { relationship: { agencyId: scope.agencyId } }
    : {};
}

/**
 * Ids dos clientes visíveis, ou null quando não há recorte.
 *
 * null (e não uma lista com tudo) de propósito: quem chama distingue "sem
 * recorte" de "recorte que por acaso pegou todo mundo", e não paga uma
 * consulta de centenas de ids para não filtrar nada.
 */
export async function clientesNoEscopo(scope: DataScope): Promise<string[] | null> {
  if (scope.kind === "WORKSPACE") return null;
  const rels = await prisma.clientAgencyRelationship.findMany({
    where: { agencyId: scope.agencyId },
    select: { clientId: true },
  });
  return [...new Set(rels.map((r) => r.clientId))];
}

/** Filtro pronto para consultas em Client. */
export async function whereDoCliente(scope: DataScope): Promise<Prisma.ClientWhereInput> {
  const ids = await clientesNoEscopo(scope);
  return ids === null ? {} : { id: { in: ids } };
}

/** Nome da agência do recorte, para a barra superior dizer o que está vendo. */
export async function nomeDoEscopo(scope: DataScope): Promise<string | null> {
  if (scope.kind === "WORKSPACE") return null;
  const a = await prisma.agency.findUnique({
    where: { id: scope.agencyId },
    select: { name: true },
  });
  return a?.name ?? null;
}
