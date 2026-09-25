import { prisma } from "@/lib/prisma";
import { listarNichos } from "@/lib/services/niches";

/**
 * Opções dos filtros de carteira nos relatórios — lidas do que JÁ está
 * cadastrado, nunca digitadas: o campo livre "Responsável" exigia acertar a
 * grafia do nome e devolvia lista vazia a qualquer erro (24/09/2026).
 */

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Quantas letras maiúsculas a grafia tem — "Ana Paula" (2) > "ana paula" (0). */
function capitals(name: string): number {
  let n = 0;
  for (const ch of name) if (ch !== ch.toLocaleLowerCase("pt-BR")) n++;
  return n;
}

/**
 * Une listas de nomes, removendo vazios e duplicatas (sem distinguir caixa).
 * Quando a mesma pessoa aparece com grafias diferentes, a escolha é
 * DETERMINÍSTICA — independe da ordem em que o banco devolve as linhas:
 * vence a grafia com mais maiúsculas ("Ana Paula" sobre "ana paula") e, no
 * empate, a primeira em ordem alfabética.
 */
export function mergeNames(...lists: (string | null | undefined)[][]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const raw of list) {
      const name = (raw ?? "").trim().replace(/\s+/g, " ");
      if (!name) continue;
      const key = name.toLocaleLowerCase("pt-BR");
      const atual = seen.get(key);
      if (
        atual === undefined ||
        capitals(name) > capitals(atual) ||
        (capitals(name) === capitals(atual) && name < atual)
      ) {
        seen.set(key, name);
      }
    }
  }
  return Array.from(seen.values()).sort(collator.compare);
}

/**
 * Responsáveis cadastrados na plataforma: colaboradores ativos (fonte da
 * verdade do responsável comercial) + nomes já gravados em clientes
 * (salesOwner/opsOwner, que a importação preenche sem colaborador).
 */
export async function responsaveisCadastrados(): Promise<string[]> {
  const [employees, sales, ops] = await Promise.all([
    prisma.employee.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } }),
    prisma.client.findMany({
      where: { salesOwner: { not: null } },
      distinct: ["salesOwner"],
      select: { salesOwner: true },
    }),
    prisma.client.findMany({
      where: { opsOwner: { not: null } },
      distinct: ["opsOwner"],
      select: { opsOwner: true },
    }),
  ]);
  return mergeNames(
    employees.map((e) => e.name),
    sales.map((c) => c.salesOwner),
    ops.map((c) => c.opsOwner)
  );
}

export type CarteiraOptions = { segmentos: string[]; origens: string[]; ufs: string[] };

/** Nichos do catálogo; origem e UF distintas presentes na carteira. */
export async function opcoesDaCarteira(): Promise<CarteiraOptions> {
  const [nichos, ori, uf] = await Promise.all([
    listarNichos(),
    prisma.client.findMany({ where: { origin: { not: null } }, distinct: ["origin"], select: { origin: true } }),
    prisma.client.findMany({ where: { state: { not: null } }, distinct: ["state"], select: { state: true } }),
  ]);
  return {
    segmentos: nichos.map((n) => n.name),
    origens: mergeNames(ori.map((c) => c.origin)),
    ufs: mergeNames(uf.map((c) => c.state?.toUpperCase())),
  };
}
