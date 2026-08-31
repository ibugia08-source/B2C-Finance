"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import { adiarPasso, encerrarSetup, reabrirSetup, retomarPasso } from "@/lib/services/setup";
import type { PassoId } from "@/lib/setup-meta";

/**
 * Gestos do setup guiado (F1.20 · 02 §3: "nada bloqueia, tudo tem fazer
 * depois").
 *
 * Guardadas por `configuracoes.editar`: adiar ou encerrar a lista muda o que
 * a equipe inteira vê na home, não é preferência pessoal.
 */

export async function adiarPassoAction(id: PassoId) {
  await requirePermission("configuracoes.editar");
  await adiarPasso(id);
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function retomarPassoAction(id: PassoId) {
  await requirePermission("configuracoes.editar");
  await retomarPasso(id);
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function encerrarSetupAction() {
  await requirePermission("configuracoes.editar");
  await encerrarSetup();
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function reabrirSetupAction() {
  await requirePermission("configuracoes.editar");
  await reabrirSetup();
  revalidatePath("/dashboard");
  return { ok: true as const };
}
