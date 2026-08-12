"use server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/viewer";
import { parseBRL } from "@/lib/format";
import { revalidateFinance } from "@/lib/revalidate";
import type { ActionResult } from "./clients";

/**
 * Meta anual de faturamento (bloco META ANUAL do Painel Anual).
 * Uma meta por ano por agência (upsert). Gate: configuracoes.editar —
 * permissão sensível já existente; nenhum id novo de permissão.
 */
export async function saveAnnualTarget(
  year: number,
  amountRaw: string
): Promise<ActionResult> {
  await requirePermission("configuracoes.editar");
  try {
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      return { ok: false, error: "Ano inválido." };
    const target = parseBRL(amountRaw);
    if (!Number.isFinite(target) || target <= 0)
      return { ok: false, error: "Informe uma meta maior que zero." };

    // Upsert manual: o escopo multi-tenant injeta ownerId no create e filtra
    // o find — @@unique([ownerId, year]) garante 1 registro por ano.
    const existing = await prisma.annualTarget.findFirst({ where: { year } });
    if (existing) {
      await prisma.annualTarget.update({
        where: { id: existing.id },
        data: { revenueTarget: target },
      });
    } else {
      await prisma.annualTarget.create({ data: { year, revenueTarget: target } });
    }
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao salvar a meta anual." };
  }
}
