"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import { provisionar } from "@/lib/services/tax-provision";

/**
 * Provisão tributária (F3.3 · 01 §3.8).
 *
 * Era um par de ações — provisionar e "já transferi para a reserva". A
 * segunda saiu em 10/09/2026 com as reservas: registrar uma transferência
 * que o sistema não vê nem confere era uma anotação, não um fato.
 */
export async function provisionarAction(competence: string, legalEntityId: string) {
  const v = await requirePermission("contabil.lancar");
  const r = await provisionar(competence, legalEntityId, v.name ?? null);
  revalidatePath("/impostos");
  revalidatePath("/dre");
  return r;
}
