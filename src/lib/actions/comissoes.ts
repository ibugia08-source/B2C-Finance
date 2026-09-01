"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import { registrarComissao, type EntradaDeComissao } from "@/lib/services/commissions";

/**
 * Lançar comissão (F4.7 · decisão 19.14: valor DIGITADO).
 *
 * Exige `folha.editar` porque comissão é folha — e a folha é a única área que
 * a decisão 19.11 restringe ao gestor sênior.
 */
export async function registrarComissaoAction(input: EntradaDeComissao) {
  await requirePermission("folha.editar");
  const r = await registrarComissao(input);
  revalidatePath("/folha");
  revalidatePath("/funil/closer");
  return r;
}
