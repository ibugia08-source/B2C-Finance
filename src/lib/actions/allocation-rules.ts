"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/viewer";
import type { AllocationDimension, ExpenseType } from "@prisma/client";

/**
 * Regras de rateio (F3.4 · 02 §4.4, §47: "Regras de categoria e rateio").
 *
 * Uma regra SEM condição nenhuma é recusada aqui e ignorada no motor. Ela
 * casaria com toda a mídia da agência e mandaria tudo para um cliente só —
 * sem erro na tela, e com a margem de todo mundo errada no mês seguinte.
 */

export type EntradaDeRegra = {
  id?: string;
  name: string;
  priority: number;
  active: boolean;
  descriptionContains: string | null;
  categoryId: string | null;
  expenseType: ExpenseType | null;
  dimensionType: AllocationDimension;
  dimensionId: string;
};

export async function salvarRegraDeRateio(input: EntradaDeRegra) {
  await requirePermission("rateios.editar");

  const nome = input.name.trim();
  if (nome.length < 2) return { ok: false as const, error: "Dê um nome à regra." };
  if (!input.dimensionId)
    return { ok: false as const, error: "Escolha para quem a despesa vai." };
  if (!input.descriptionContains?.trim() && !input.categoryId && !input.expenseType)
    return {
      ok: false as const,
      error:
        "A regra precisa de pelo menos uma condição — sem nenhuma, ela casaria com toda a mídia.",
    };

  const data = {
    name: nome,
    priority: Number.isFinite(input.priority) ? input.priority : 100,
    active: input.active,
    descriptionContains: input.descriptionContains?.trim() || null,
    categoryId: input.categoryId || null,
    expenseType: input.expenseType,
    dimensionType: input.dimensionType,
    dimensionId: input.dimensionId,
  };

  if (input.id) await prisma.allocationRule.update({ where: { id: input.id }, data });
  else await prisma.allocationRule.create({ data });

  revalidatePath("/regras");
  revalidatePath("/rateio");
  return { ok: true as const };
}

export async function excluirRegraDeRateio(id: string) {
  await requirePermission("rateios.editar");
  // As linhas já criadas por esta regra FICAM: elas são decisões tomadas,
  // não uma projeção da regra. O que se perde é o vínculo (ruleId vira nulo),
  // e é por isso que o motivo da regra fica na trilha desde a criação.
  await prisma.allocationRule.delete({ where: { id } });
  revalidatePath("/regras");
  revalidatePath("/rateio");
  return { ok: true as const };
}

export async function alternarRegraDeRateio(id: string, active: boolean) {
  await requirePermission("rateios.editar");
  await prisma.allocationRule.update({ where: { id }, data: { active } });
  revalidatePath("/regras");
  return { ok: true as const };
}
