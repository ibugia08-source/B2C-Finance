"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBRL, parseDateBR } from "@/lib/format";

const ORIGINS = ["debito", "pix", "dinheiro", "boleto"] as const;
const STATUS = ["pendente", "pago", "cancelado"] as const;

const Schema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, "Descrição obrigatória"),
  amount: z.number().nonnegative(),
  date: z.date(),
  origin: z.enum(ORIGINS).default("debito"),
  status: z.enum(STATUS).default("pendente"),
  dueDate: z.date().nullable().optional(),
  installments: z.number().int().min(1).max(60).default(1),
  responsibleId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

async function rebuildInstallments(
  transactionId: string,
  amount: number,
  count: number,
  firstDue: Date
) {
  await prisma.installment.deleteMany({ where: { transactionId } });
  if (count <= 1) return;
  const each = Number((amount / count).toFixed(2));
  const rows = [];
  for (let i = 1; i <= count; i++) {
    rows.push({
      transactionId,
      number: i,
      total: count,
      amount: each,
      dueDate: addMonths(firstDue, i - 1),
      paid: false,
    });
  }
  await prisma.installment.createMany({ data: rows });
}

export async function saveExpense(formData: FormData) {
  const date = parseDateBR(String(formData.get("date") || "")) ?? new Date();
  const dueRaw = String(formData.get("dueDate") || "");
  const dueDate = dueRaw ? parseDateBR(dueRaw) : null;

  const parsed = Schema.parse({
    id: formData.get("id") || undefined,
    description: String(formData.get("description") || ""),
    amount: parseBRL(String(formData.get("amount") || "0")),
    date,
    origin: String(formData.get("origin") || "debito"),
    status: String(formData.get("status") || "pendente"),
    dueDate,
    installments: Number(formData.get("installments") || 1),
    responsibleId: (formData.get("responsibleId") as string) || null,
    categoryId: (formData.get("categoryId") as string) || null,
    accountId: (formData.get("accountId") as string) || null,
    notes: (formData.get("notes") as string) || null,
  });

  const data = {
    date: parsed.date,
    description: parsed.description,
    amount: parsed.amount,
    type: "despesa",
    origin: parsed.origin,
    cardId: null, // despesa manual: nunca cartão de crédito
    accountId: parsed.accountId || null,
    categoryId: parsed.categoryId || null,
    responsibleId: parsed.responsibleId || null,
    belongsTo: "pessoal",
    status: parsed.status,
    dueDate: parsed.dueDate ?? null,
    notes: parsed.notes,
    hash: null,
  };

  let txId: string;
  if (parsed.id) {
    const tx = await prisma.transaction.update({ where: { id: parsed.id }, data });
    txId = tx.id;
  } else {
    const tx = await prisma.transaction.create({ data });
    txId = tx.id;
  }

  await rebuildInstallments(
    txId,
    parsed.amount,
    parsed.installments,
    parsed.dueDate ?? parsed.date
  );

  revalidatePath("/despesas");
  revalidatePath("/dashboard");
  revalidatePath("/transacoes");
  if (parsed.responsibleId) revalidatePath(`/pessoas/${parsed.responsibleId}`);
  revalidatePath("/pessoas");
}

export async function deleteExpense(id: string) {
  await prisma.transaction.delete({ where: { id } });
  revalidatePath("/despesas");
  revalidatePath("/dashboard");
  revalidatePath("/transacoes");
  revalidatePath("/pessoas");
}

export async function setExpenseStatus(id: string, status: (typeof STATUS)[number]) {
  await prisma.transaction.update({ where: { id }, data: { status } });
  revalidatePath("/despesas");
  revalidatePath("/dashboard");
}
