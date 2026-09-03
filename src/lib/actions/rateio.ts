"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  aplicarRegras,
  salvarRateio,
  type EntradaDeRateio,
} from "@/lib/services/allocation";
import type { AllocationDimension } from "@prisma/client";
import { isCompetence } from "@/lib/competence";

/**
 * Ações da tela de rateio (F3.4 · 02 §4.4).
 *
 * A permissão é conferida DUAS vezes: aqui, para a tela responder rápido e
 * com a mensagem certa, e dentro do serviço, porque a regra de 03 §4.1 é do
 * domínio — um segundo chamador (job, import) não pode entrar por baixo.
 */

export async function salvarRateioAction(input: EntradaDeRateio) {
  await requirePermission("rateios.editar");
  const r = await salvarRateio(input);
  if (r.ok) revalidar();
  return r;
}

export async function aplicarRegrasAction(competence: string) {
  await requirePermission("rateios.editar");
  if (!isCompetence(competence)) return { ok: false as const, error: "Mês inválido." };
  const r = await aplicarRegras(competence);
  revalidar();
  return { ok: true as const, ...r };
}

function revalidar() {
  revalidatePath("/rateio");
  revalidatePath("/fechamento");
  revalidatePath("/relatorios");
}
