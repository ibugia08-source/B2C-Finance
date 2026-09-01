"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import { definirBaseDeValoracao, type BaseDeValoracao } from "@/lib/metrics/commercial";

export async function definirBaseDeValoracaoAction(base: BaseDeValoracao) {
  await requirePermission("comercial.metas");
  const r = await definirBaseDeValoracao(base);
  revalidatePath("/funil/metricas");
  return r;
}
