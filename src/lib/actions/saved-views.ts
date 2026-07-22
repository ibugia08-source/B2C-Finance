"use server";

import { z } from "zod";
import { revalidateFinance } from "@/lib/revalidate";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";
import type { ActionResult } from "./clients";

/**
 * Visões salvas — conjuntos de filtros nomeados por módulo.
 * Qualquer usuário logado cria visões privadas; GLOBAL fica visível para
 * todos os usuários do mesmo dono (agência). Escopo ownerId via extensão.
 */

const saveViewSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome à visão").max(80),
  module: z.string().trim().min(1).max(60),
  params: z.string().max(2000),
  visibility: z.enum(["PRIVATE", "GLOBAL"]).default("PRIVATE"),
});

export async function saveView(fd: FormData): Promise<ActionResult> {
  try {
    const viewer = await getViewer();
    const parsed = saveViewSchema.safeParse({
      name: fd.get("name"),
      module: fd.get("module"),
      params: fd.get("params") ?? "",
      visibility: fd.get("visibility") ?? "PRIVATE",
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.errors[0]?.message ?? "Dados inválidos" };
    }
    // GLOBAL só para admin (vale para a agência inteira)
    const visibility =
      parsed.data.visibility === "GLOBAL" && viewer.role !== "ADMIN"
        ? "PRIVATE"
        : parsed.data.visibility;

    const view = await prisma.savedView.create({
      data: { ...parsed.data, visibility, createdBy: viewer.id },
    });
    revalidateFinance();
    return { ok: true, id: view.id };
  } catch (e) {
    console.error("saveView", e);
    return { ok: false, error: "Não foi possível salvar a visão." };
  }
}

export async function deleteView(id: string): Promise<ActionResult> {
  try {
    const viewer = await getViewer();
    const view = await prisma.savedView.findUnique({ where: { id } });
    if (!view) return { ok: false, error: "Visão não encontrada." };
    if (view.createdBy !== viewer.id && viewer.role !== "ADMIN") {
      return { ok: false, error: "Sem permissão para excluir esta visão." };
    }
    await prisma.savedView.delete({ where: { id } });
    revalidateFinance();
    return { ok: true };
  } catch (e) {
    console.error("deleteView", e);
    return { ok: false, error: "Não foi possível excluir a visão." };
  }
}

export type SavedViewItem = {
  id: string;
  name: string;
  params: string;
  visibility: "PRIVATE" | "GLOBAL";
  mine: boolean;
};

/** Visões visíveis ao usuário no módulo: globais + as próprias privadas. */
export async function listViews(module: string): Promise<SavedViewItem[]> {
  const viewer = await getViewer();
  const views = await prisma.savedView.findMany({
    where: {
      module,
      OR: [{ visibility: "GLOBAL" }, { createdBy: viewer.id }],
    },
    orderBy: { createdAt: "asc" },
  });
  return views.map((v) => ({
    id: v.id,
    name: v.name,
    params: v.params,
    visibility: v.visibility as "PRIVATE" | "GLOBAL",
    mine: v.createdBy === viewer.id || viewer.role === "ADMIN",
  }));
}
