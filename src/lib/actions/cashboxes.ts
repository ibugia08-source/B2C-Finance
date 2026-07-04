"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBRL, parseDateBR } from "@/lib/format";

const TYPES = [
  "PERSONAL",
  "EMERGENCY",
  "INVESTMENT",
  "COMPANY",
  "GOAL",
  "OTHER",
] as const;

const Schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  currentAmount: z.number().nonnegative(),
  targetAmount: z.number().nullable().optional(),
  type: z.enum(TYPES),
  accountId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function saveCashBox(formData: FormData) {
  const targetRaw = String(formData.get("targetAmount") || "").trim();
  const parsed = Schema.parse({
    id: formData.get("id") || undefined,
    name: String(formData.get("name") || ""),
    currentAmount: parseBRL(String(formData.get("currentAmount") || "0")),
    targetAmount: targetRaw ? parseBRL(targetRaw) : null,
    type: String(formData.get("type") || "PERSONAL"),
    accountId: (formData.get("accountId") as string) || null,
    notes: (formData.get("notes") as string) || null,
  });

  const data = {
    name: parsed.name,
    currentAmount: parsed.currentAmount,
    targetAmount: parsed.targetAmount ?? null,
    type: parsed.type,
    accountId: parsed.accountId,
    notes: parsed.notes,
  };

  if (parsed.id) {
    await prisma.cashBox.update({ where: { id: parsed.id }, data });
  } else {
    await prisma.cashBox.create({ data });
  }

  revalidatePath("/caixa");
  revalidatePath("/dashboard");
}

export async function deleteCashBox(id: string) {
  await prisma.cashBox.delete({ where: { id } });
  revalidatePath("/caixa");
  revalidatePath("/dashboard");
}

const MoveSchema = z.object({
  cashBoxId: z.string().min(1),
  type: z.enum(["IN", "OUT"]),
  amount: z.number().positive(),
  date: z.date(),
  description: z.string().nullable().optional(),
});

export async function registerCashMovement(formData: FormData) {
  const date =
    parseDateBR(String(formData.get("date") || "")) ?? new Date();

  const parsed = MoveSchema.parse({
    cashBoxId: String(formData.get("cashBoxId") || ""),
    type: String(formData.get("type") || "IN"),
    amount: parseBRL(String(formData.get("amount") || "0")),
    date,
    description: (formData.get("description") as string) || null,
  });

  const box = await prisma.cashBox.findUnique({ where: { id: parsed.cashBoxId } });
  if (!box) throw new Error("Caixa não encontrado");

  const delta = parsed.type === "IN" ? parsed.amount : -parsed.amount;
  const next = box.currentAmount + delta;

  await prisma.$transaction([
    prisma.cashBoxMovement.create({
      data: {
        cashBoxId: parsed.cashBoxId,
        type: parsed.type,
        amount: parsed.amount,
        date: parsed.date,
        description: parsed.description,
      },
    }),
    prisma.cashBox.update({
      where: { id: parsed.cashBoxId },
      data: { currentAmount: next },
    }),
  ]);

  revalidatePath("/caixa");
  revalidatePath("/dashboard");
}

export async function deleteCashMovement(id: string) {
  const mov = await prisma.cashBoxMovement.findUnique({ where: { id } });
  if (!mov) return;
  const delta = mov.type === "IN" ? -mov.amount : mov.amount;
  const box = await prisma.cashBox.findUnique({ where: { id: mov.cashBoxId } });
  if (!box) return;

  await prisma.$transaction([
    prisma.cashBoxMovement.delete({ where: { id } }),
    prisma.cashBox.update({
      where: { id: mov.cashBoxId },
      data: { currentAmount: box.currentAmount + delta },
    }),
  ]);
  revalidatePath("/caixa");
  revalidatePath("/dashboard");
}
