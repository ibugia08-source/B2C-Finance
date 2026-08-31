"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import { marcarReservaFeita, provisionar } from "@/lib/services/tax-provision";

/**
 * Provisão e reserva (F3.3 · 01 §3.8) — duas ações, nunca uma.
 */
export async function provisionarAction(competence: string, legalEntityId: string) {
  const v = await requirePermission("contabil.lancar");
  const r = await provisionar(competence, legalEntityId, v.name ?? null);
  revalidatePath("/impostos");
  revalidatePath("/dre");
  return r;
}

export async function marcarReservaFeitaAction(competence: string, legalEntityId: string) {
  const v = await requirePermission("contabil.lancar");
  const r = await marcarReservaFeita(competence, legalEntityId, v.name ?? null);
  revalidatePath("/impostos");
  revalidatePath("/dashboard");
  return r;
}
