/**
 * NICHOS — vocabulário do catálogo (24/09/2026).
 *
 * O nicho do cliente é uma CATEGORIA da plataforma: cadastrado uma vez pelo
 * ADMIN (tabela Niche), escolhido de lista em todo lugar que grava cliente.
 * Este módulo é puro (sem banco) para servir cliente e servidor.
 */

/**
 * Normalização que define "mesmo nicho": espaços nas pontas fora, espaços
 * internos colapsados, minúsculas. TEM de bater com o SQL do backfill da
 * migração 20260924120000_nichos_catalogo — é a chave única por dono.
 */
export function nicheSlug(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

/** Nome como fica gravado: só limpa espaços; a grafia é do ADMIN. */
export function nicheDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Valor de filtro que significa "clientes ainda sem nicho no cadastro". */
export const SEM_NICHO = "__sem_nicho__";
export const SEM_NICHO_LABEL = "Sem nicho";

export type NicheOption = { id: string; name: string };
