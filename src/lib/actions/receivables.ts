"use server";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBRL, parseDateBR } from "@/lib/format";

const Schema = z.object({
  id: z.string().optional(),
  personId: z.string().min(1),
  transactionId: z.string().nullable().optional(),
  amount: z.number().nonnegative(),
  dueDate: z.date(),
  status: z.enum(["aberto", "pago", "atrasado", "renegociado"]).default("aberto"),
  notes: z.string().optional().nullable(),
});

export async function saveReceivable(formData: FormData) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const dueDate = parseDateBR(String(formData.get("dueDate") || "")) ?? new Date();
  const parsed = Schema.parse({
    id: formData.get("id") || undefined,
    personId: formData.get("personId"),
    transactionId: (formData.get("transactionId") as string) || null,
    amount: parseBRL(String(formData.get("amount") || "0")),
    dueDate,
    status: formData.get("status") || "aberto",
    notes: (formData.get("notes") as string) || null,
  });
  if (parsed.id) {
    await prisma.receivable.update({
      where: { id: parsed.id },
      data: {
        personId: parsed.personId,
        transactionId: parsed.transactionId,
        amount: parsed.amount,
        dueDate: parsed.dueDate,
        status: parsed.status,
        notes: parsed.notes,
      },
    });
  } else {
    await prisma.receivable.create({
      data: {
        personId: parsed.personId,
        transactionId: parsed.transactionId,
        amount: parsed.amount,
        dueDate: parsed.dueDate,
        status: parsed.status,
        notes: parsed.notes,
      },
    });
  }
  revalidatePath("/pessoas");
  revalidatePath("/dashboard");
}

export async function markReceivablePaid(id: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  await prisma.receivable.update({
    where: { id },
    data: { status: "pago", paidAt: new Date() },
  });
  revalidatePath("/pessoas");
  revalidatePath("/dashboard");
}

export async function deleteReceivable(id: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  await prisma.receivable.delete({ where: { id } });
  revalidatePath("/pessoas");
}
