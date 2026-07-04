"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBRL, parseDateBR } from "@/lib/format";

const SOURCE_TYPES = ["BANK_ACCOUNT", "PIX", "TRANSFER", "CASH"] as const;
const INCOME_TYPES = [
  "SALARY",
  "EARNINGS",
  "COMPANY_WITHDRAWAL",
  "SALE",
  "OTHER",
  // Legados (mantidos para compatibilidade com registros antigos)
  "CLIENT",
  "REIMBURSEMENT",
  "LOAN_RECEIVED",
] as const;
const STATUS = ["RECEIVED", "EXPECTED", "LATE", "CANCELED"] as const;

const Schema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, "Descrição obrigatória"),
  amount: z.number().nonnegative(),
  receivedAt: z.date(),
  sourceType: z.enum(SOURCE_TYPES),
  incomeType: z.enum(INCOME_TYPES),
  status: z.enum(STATUS),
  accountId: z.string().nullable().optional(),
  personId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function saveIncome(formData: FormData) {
  const receivedAt =
    parseDateBR(String(formData.get("receivedAt") || "")) ?? new Date();

  const parsed = Schema.parse({
    id: formData.get("id") || undefined,
    description: String(formData.get("description") || ""),
    amount: parseBRL(String(formData.get("amount") || "0")),
    receivedAt,
    sourceType: String(formData.get("sourceType") || "BANK_ACCOUNT"),
    incomeType: String(formData.get("incomeType") || "OTHER"),
    status: String(formData.get("status") || "RECEIVED"),
    accountId: (formData.get("accountId") as string) || null,
    personId: (formData.get("personId") as string) || null,
    categoryId: (formData.get("categoryId") as string) || null,
    notes: (formData.get("notes") as string) || null,
  });

  const data = {
    description: parsed.description,
    amount: parsed.amount,
    receivedAt: parsed.receivedAt,
    sourceType: parsed.sourceType,
    incomeType: parsed.incomeType,
    status: parsed.status,
    accountId: parsed.accountId,
    personId: parsed.personId,
    categoryId: parsed.categoryId,
    notes: parsed.notes,
    // mantém compat com campos legados
    date: parsed.receivedAt,
    source: parsed.sourceType,
  };

  if (parsed.id) {
    await prisma.income.update({ where: { id: parsed.id }, data });
  } else {
    await prisma.income.create({ data });
  }

  revalidatePath("/receitas");
  revalidatePath("/dashboard");
}

export async function deleteIncome(id: string) {
  await prisma.income.delete({ where: { id } });
  revalidatePath("/receitas");
  revalidatePath("/dashboard");
}

export async function setIncomeStatus(
  id: string,
  status: (typeof STATUS)[number]
) {
  await prisma.income.update({ where: { id }, data: { status } });
  revalidatePath("/receitas");
  revalidatePath("/dashboard");
}
