"use server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/viewer";
import { revalidateFinance } from "@/lib/revalidate";
import { z } from "zod";
import { parseBRL } from "@/lib/format";

const CardSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  bank: z.string().optional().nullable(),
  type: z.enum(["pessoal", "empresarial", "terceiro"]).default("pessoal"),
  holderId: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
  limitTotal: z.number().nonnegative(),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
  active: z.boolean().default(true),
});

export async function saveCard(formData: FormData) {
  await requirePermission("despesas.editar");
  const parsed = CardSchema.parse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    bank: formData.get("bank") || null,
    type: formData.get("type") || "pessoal",
    holderId: formData.get("holderId") || null,
    accountId: formData.get("accountId") || null,
    limitTotal: parseBRL(String(formData.get("limitTotal") || "0")),
    closingDay: Number(formData.get("closingDay") || 1),
    dueDay: Number(formData.get("dueDay") || 10),
    active: formData.get("active") !== "false",
  });

  const data = {
    name: parsed.name,
    bank: parsed.bank,
    type: parsed.type,
    holderId: parsed.holderId || null,
    accountId: parsed.accountId || null,
    limitTotal: parsed.limitTotal,
    closingDay: parsed.closingDay,
    dueDay: parsed.dueDay,
    active: parsed.active,
  };

  if (parsed.id) {
    await prisma.creditCard.update({ where: { id: parsed.id }, data });
  } else {
    await prisma.creditCard.create({ data });
  }
  revalidateFinance();
}

// Criação rápida de conta bancária (usada na importação inline). Retorna o id.
const QuickAccountSchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  bank: z.string().optional().nullable(),
  limitTotal: z.number().nonnegative().default(0),
  closingDay: z.number().int().min(1).max(31).default(1),
  dueDay: z.number().int().min(1).max(31).default(10),
});

export async function createBankAccountQuick(
  formData: FormData
): Promise<{ id: string }> {
  await requirePermission("despesas.editar");
  const parsed = QuickAccountSchema.parse({
    name: formData.get("name"),
    bank: formData.get("bank") || null,
    limitTotal: parseBRL(String(formData.get("limitTotal") || "0")),
    closingDay: Number(formData.get("closingDay") || 1),
    dueDay: Number(formData.get("dueDay") || 10),
  });
  const created = await prisma.creditCard.create({
    data: {
      name: parsed.name,
      bank: parsed.bank,
      limitTotal: parsed.limitTotal,
      closingDay: parsed.closingDay,
      dueDay: parsed.dueDay,
    },
  });
  revalidateFinance();
  return { id: created.id };
}

export async function quickRenameCard(id: string, name: string) {
  await requirePermission("despesas.editar");
  if (!name.trim()) throw new Error("Nome obrigatório");
  await prisma.creditCard.update({ where: { id }, data: { name: name.trim() } });
  revalidateFinance({ cardId: id });
}

export async function deleteCard(id: string) {
  await requirePermission("despesas.excluir");
  await prisma.creditCard.delete({ where: { id } });
  revalidateFinance();
}
