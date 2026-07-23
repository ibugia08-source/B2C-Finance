"use server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/viewer";
import { revalidateFinance } from "@/lib/revalidate";
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
  // ===== ERP de agência (opcionais) =====
  revenueType: z
    .enum(["MRR", "TCV", "ONE_TIME", "SETUP", "RECOVERY", "OTHER"])
    .nullable()
    .optional(),
  clientId: z.string().nullable().optional(),
  contractId: z.string().nullable().optional(),
  competenceMonth: z.number().int().min(1).max(12).nullable().optional(),
  competenceYear: z.number().int().min(2000).max(2100).nullable().optional(),
});

export async function saveIncome(formData: FormData) {
  await requirePermission("receitas.editar");
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
    revenueType: (formData.get("revenueType") as string) || null,
    clientId: (formData.get("clientId") as string) || null,
    contractId: (formData.get("contractId") as string) || null,
    ...(() => {
      // competência opcional (input month "YYYY-MM"); padrão = mês do recebimento
      const comp = String(formData.get("competence") || "");
      const [cy, cm] = comp.split("-").map(Number);
      return {
        competenceMonth: cm || receivedAt.getMonth() + 1,
        competenceYear: cy || receivedAt.getFullYear(),
      };
    })(),
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
    revenueType: parsed.revenueType ?? null,
    clientId: parsed.clientId ?? null,
    contractId: parsed.contractId ?? null,
    competenceMonth: parsed.competenceMonth ?? null,
    competenceYear: parsed.competenceYear ?? null,
    // mantém compat com campos legados
    date: parsed.receivedAt,
    source: parsed.sourceType,
  };

  if (parsed.id) {
    await prisma.income.update({ where: { id: parsed.id }, data });
  } else {
    await prisma.income.create({ data });
  }

  revalidateFinance();
}

export async function deleteIncome(id: string) {
  await requirePermission("receitas.excluir");
  await prisma.income.delete({ where: { id } });
  revalidateFinance();
}

export async function setIncomeStatus(
  id: string,
  status: (typeof STATUS)[number]
) {
  await requirePermission("receitas.editar");
  await prisma.income.update({ where: { id }, data: { status } });
  revalidateFinance();
}
