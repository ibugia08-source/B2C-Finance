"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer, requirePermission } from "@/lib/auth/viewer";
import { revalidateAgency } from "@/lib/revalidate";
import { nicheDisplayName, nicheSlug, type NicheOption } from "@/lib/niches";
import { listarNichos } from "@/lib/services/niches";
import type { ActionResult } from "./clients";

/**
 * NICHOS — catálogo administrado (24/09/2026).
 *
 * Só o ADMIN cadastra, renomeia, mescla ou exclui. Todo mundo com acesso a
 * clientes LÊ a lista (o select do cadastro e os filtros). Renomear
 * propaga para o texto denormalizado dos clientes (Client.segment), como o
 * nome do colaborador propaga para salesOwner.
 *
 * Só função assíncrona pode sair daqui ("use server"); vocabulário e tipos
 * moram em lib/niches.
 */

const NicheSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Informe o nome do nicho.").max(80, "Nome longo demais."),
});

async function requireAdminAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = await getViewer();
  if (v.role !== "ADMIN") {
    return { ok: false, error: "Só o administrador pode alterar o catálogo de nichos." };
  }
  return { ok: true };
}

function revalidarNichos() {
  revalidateAgency();
  for (const p of ["/configuracoes", "/clientes", "/relatorios", "/retencao"]) revalidatePath(p);
}

/** Lista para selects (qualquer um que vê clientes). */
export async function listNicheOptions(): Promise<NicheOption[]> {
  await requirePermission("clientes.visualizar");
  return listarNichos();
}

/** Cria ou renomeia. Nome que normaliza igual a outro nicho é recusado. */
export async function salvarNicho(formData: FormData): Promise<ActionResult> {
  const gate = await requireAdminAction();
  if (!gate.ok) return gate;
  try {
    const parsed = NicheSchema.parse({
      id: String(formData.get("id") ?? "").trim() || undefined,
      name: String(formData.get("name") ?? ""),
    });
    const name = nicheDisplayName(parsed.name);
    const slug = nicheSlug(name);

    const duplicado = await prisma.niche.findFirst({
      where: { slug, ...(parsed.id ? { id: { not: parsed.id } } : {}) },
      select: { id: true, name: true },
    });
    if (duplicado) {
      return {
        ok: false,
        error: `Já existe o nicho "${duplicado.name}". Nichos não se repetem — use o existente ou mescle os dois.`,
      };
    }

    if (parsed.id) {
      const atual = await prisma.niche.findFirst({ where: { id: parsed.id }, select: { id: true } });
      if (!atual) return { ok: false, error: "Nicho não encontrado." };
      await prisma.$transaction([
        prisma.niche.update({ where: { id: parsed.id }, data: { name, slug, active: true } }),
        // O texto denormalizado acompanha o nome novo.
        prisma.client.updateMany({ where: { nicheId: parsed.id }, data: { segment: name } }),
      ]);
      revalidarNichos();
      return { ok: true, id: parsed.id };
    }

    const criado = await prisma.niche.create({ data: { name, slug }, select: { id: true } });
    revalidarNichos();
    return { ok: true, id: criado.id };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o nicho." };
  }
}

/**
 * Mescla `deId` em `paraId`: os clientes do primeiro passam para o segundo
 * (com o nome padronizado) e o primeiro é apagado. É a ferramenta contra
 * duplicata que já existia antes do catálogo ("Imobiliária" × "Imobiliário").
 */
export async function mesclarNichos(deId: string, paraId: string): Promise<ActionResult> {
  const gate = await requireAdminAction();
  if (!gate.ok) return gate;
  if (!deId || !paraId || deId === paraId) return { ok: false, error: "Escolha dois nichos diferentes." };
  try {
    const [de, para] = await Promise.all([
      prisma.niche.findFirst({ where: { id: deId }, select: { id: true, name: true } }),
      prisma.niche.findFirst({ where: { id: paraId }, select: { id: true, name: true } }),
    ]);
    if (!de || !para) return { ok: false, error: "Nicho não encontrado." };
    await prisma.$transaction([
      prisma.client.updateMany({ where: { nicheId: de.id }, data: { nicheId: para.id, segment: para.name } }),
      prisma.niche.deleteMany({ where: { id: de.id } }),
    ]);
    revalidarNichos();
    return { ok: true, id: para.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao mesclar os nichos." };
  }
}

/**
 * Exclui o nicho. Clientes que o usavam ficam "Sem nicho" (segment nulo) —
 * o que a tela avisa antes de confirmar. Para não perder a classificação,
 * mesclar é o caminho.
 */
export async function excluirNicho(id: string): Promise<ActionResult> {
  const gate = await requireAdminAction();
  if (!gate.ok) return gate;
  try {
    const atual = await prisma.niche.findFirst({ where: { id }, select: { id: true } });
    if (!atual) return { ok: false, error: "Nicho não encontrado." };
    await prisma.$transaction([
      prisma.client.updateMany({ where: { nicheId: id }, data: { nicheId: null, segment: null } }),
      prisma.niche.deleteMany({ where: { id } }),
    ]);
    revalidarNichos();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o nicho." };
  }
}
