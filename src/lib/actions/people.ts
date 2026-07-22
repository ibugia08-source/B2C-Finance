"use server";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";
import { revalidateFinance } from "@/lib/revalidate";
import { z } from "zod";
import { parseBRL, parseDateBR, formatBRL } from "@/lib/format";

const PersonSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: z.enum(["pessoal", "empresa", "terceiro", "familiar"]).default("pessoal"),
  notes: z.string().optional().nullable(),
});

export async function savePerson(formData: FormData) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const parsed = PersonSchema.parse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    type: formData.get("type") || "pessoal",
    notes: formData.get("notes") || null,
  });
  if (parsed.id) {
    await prisma.person.update({
      where: { id: parsed.id },
      data: { name: parsed.name, type: parsed.type, notes: parsed.notes ?? null },
    });
  } else {
    await prisma.person.create({
      data: { name: parsed.name, type: parsed.type, notes: parsed.notes ?? null },
    });
  }
  revalidateFinance();
}

export async function deletePerson(id: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  await prisma.person.delete({ where: { id } });
  revalidateFinance();
}

const PaymentSchema = z.object({
  personId: z.string().min(1),
  amount: z.number().positive(),
  paidAt: z.date(),
  method: z.enum(["PIX", "TRANSFER", "CASH", "OTHER"]),
  accountId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Registra pagamento da pessoa e amortiza Receivables abertos por ordem de vencimento.
 * O valor pago reduz primeiro o vencimento mais antigo. Se sobra, distribui no próximo.
 * Receivables totalmente quitados viram "pago"; parcialmente quitados são reduzidos.
 */
export async function registerPersonPayment(formData: FormData) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const paidAt =
    parseDateBR(String(formData.get("paidAt") || "")) ?? new Date();
  const parsed = PaymentSchema.parse({
    personId: String(formData.get("personId") || ""),
    amount: parseBRL(String(formData.get("amount") || "0")),
    paidAt,
    method: String(formData.get("method") || "PIX"),
    accountId: (formData.get("accountId") as string) || null,
    notes: (formData.get("notes") as string) || null,
  });

  const payment = await prisma.personPayment.create({
    data: {
      personId: parsed.personId,
      amount: parsed.amount,
      paidAt: parsed.paidAt,
      method: parsed.method,
      accountId: parsed.accountId,
      notes: parsed.notes,
    },
  });

  // Amortizar Receivables abertos
  let remaining = parsed.amount;
  const open = await prisma.receivable.findMany({
    where: {
      personId: parsed.personId,
      status: { in: ["aberto", "atrasado", "renegociado"] },
    },
    orderBy: { dueDate: "asc" },
    include: { transaction: true },
  });

  // Prepare batch updates
  const paidIds: string[] = [];
  const paidTxIds: string[] = [];
  const partialUpdates: { id: string; newAmount: number }[] = [];

  for (const r of open) {
    if (remaining <= 0) break;
    if (r.amount <= remaining) {
      remaining -= r.amount;
      paidIds.push(r.id);
      if (r.transactionId) paidTxIds.push(r.transactionId);
    } else {
      partialUpdates.push({ id: r.id, newAmount: r.amount - remaining });
      remaining = 0;
    }
  }

  // Execute batch updates
  if (paidIds.length > 0) {
    await prisma.receivable.updateMany({
      where: { id: { in: paidIds } },
      data: { status: "pago", paidAt: parsed.paidAt },
    });
    if (paidTxIds.length > 0) {
      await prisma.transaction.updateMany({
        where: { id: { in: paidTxIds } },
        data: { status: "reembolsado" },
      });
    }
  }

  // Partial updates need individual calls (conditions vary)
  for (const upd of partialUpdates) {
    await prisma.receivable.update({
      where: { id: upd.id },
      data: { amount: upd.newAmount },
    });
  }

  revalidateFinance({ personId: parsed.personId });

  return { ok: true, paymentId: payment.id, leftover: remaining };
}

export async function deletePersonPayment(id: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const p = await prisma.personPayment.findUnique({ where: { id } });
  if (!p) return;
  await prisma.personPayment.delete({ where: { id } });
  revalidateFinance({ personId: p.personId });
}

const TxStatusSchema = z.enum([
  "pendente",
  "pago",
  "devendo",
  "reembolsado",
  "cancelado",
]);

export async function setPersonTxStatus(transactionId: string, status: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const s = TxStatusSchema.parse(status);
  const tx = await prisma.transaction.update({
    where: { id: transactionId },
    data: { status: s },
  });

  // Se virou "pago" ou "reembolsado", encerra Receivable se houver
  if (s === "pago" || s === "reembolsado") {
    const r = await prisma.receivable.findFirst({ where: { transactionId } });
    if (r && r.status !== "pago") {
      await prisma.receivable.update({
        where: { id: r.id },
        data: { status: "pago", paidAt: new Date() },
      });
    }
  }

  revalidateFinance({ personId: tx.responsibleId, cardId: tx.cardId });
}

export async function setPersonTxCategory(
  transactionId: string,
  categoryId: string | null
) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const tx = await prisma.transaction.update({
    where: { id: transactionId },
    data: { categoryId: categoryId || null },
  });
  revalidateFinance({ personId: tx.responsibleId, cardId: tx.cardId });
}

/**
 * Gera texto de cobrança WhatsApp-friendly.
 * Lista Receivables em aberto + sugestão de data de pagamento (5 dias úteis aproximados).
 */
export async function generateBillingText(personId: string): Promise<string> {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) return "";

  const open = await prisma.receivable.findMany({
    where: {
      personId,
      status: { in: ["aberto", "atrasado", "renegociado"] },
    },
    orderBy: { dueDate: "asc" },
    include: { transaction: true },
  });

  const total = open.reduce((s, r) => s + r.amount, 0);

  const suggested = new Date();
  suggested.setDate(suggested.getDate() + 5);
  const suggestedStr = suggested.toLocaleDateString("pt-BR");

  if (open.length === 0) {
    return `Olá, ${person.name}. No momento não há valores em aberto. ✅`;
  }

  const lines = open
    .map((r) => {
      const desc = r.transaction?.description ?? r.notes ?? "Pendência";
      return `- ${desc} — ${formatBRL(r.amount)}`;
    })
    .join("\n");

  return [
    `Olá, ${person.name}. Segue o resumo dos valores pendentes:`,
    "",
    lines,
    "",
    `Total em aberto: ${formatBRL(total)}`,
    `Sugestão de pagamento até: ${suggestedStr}`,
    "",
    "Pode enviar por Pix/transferência quando possível. Obrigado!",
  ].join("\n");
}
