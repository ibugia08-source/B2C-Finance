import { prisma } from "@/lib/prisma";
import { nicheDisplayName, nicheSlug, type NicheOption } from "@/lib/niches";

/**
 * Catálogo de nichos — leitura e resolução por nome (escopo do dono vem da
 * extensão do Prisma). As ações administrativas ficam em lib/actions/niches.
 */

/** Nichos ativos, em ordem alfabética pt-BR. */
export async function listarNichos(): Promise<NicheOption[]> {
  const rows = await prisma.niche.findMany({
    where: { active: true },
    select: { id: true, name: true },
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Encontra o nicho pelo nome (normalizado); com `criar`, cadastra quando
 * não existe. Importação e funil recebem o nicho como TEXTO de fora da
 * plataforma — entram no catálogo pela grafia recebida, sem duplicar o que
 * já existe ("Clínica" e "clínica " são o mesmo). Nome vazio → null.
 */
export async function resolverNicho(
  nome: string | null | undefined,
  opts: { criar?: boolean } = {}
): Promise<NicheOption | null> {
  const display = nicheDisplayName(nome ?? "");
  if (!display) return null;
  const slug = nicheSlug(display);
  const existente = await prisma.niche.findFirst({
    where: { slug },
    select: { id: true, name: true },
  });
  if (existente) return existente;
  if (!opts.criar) return null;
  const criado = await prisma.niche.create({
    data: { name: display, slug },
    select: { id: true, name: true },
  });
  return criado;
}

/** Nicho por id, dentro do escopo do dono (null se não existe). */
export async function nichoPorId(id: string | null | undefined): Promise<NicheOption | null> {
  if (!id) return null;
  return prisma.niche.findFirst({ where: { id }, select: { id: true, name: true } });
}
