import { prisma } from "@/lib/prisma";
import { listarNichos } from "@/lib/services/niches";

/**
 * Opções dos filtros de carteira nos relatórios — lidas do que JÁ está
 * cadastrado, nunca digitadas: o campo livre "Responsável" exigia acertar a
 * grafia do nome e devolvia lista vazia a qualquer erro (24/09/2026).
 */

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Une listas de nomes, removendo vazios e duplicatas (sem distinguir caixa). */
export function mergeNames(...lists: (string | null | undefined)[][]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const raw of list) {
      const name = (raw ?? "").trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase("pt-BR");
      if (!seen.has(key)) seen.set(key, name);
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
