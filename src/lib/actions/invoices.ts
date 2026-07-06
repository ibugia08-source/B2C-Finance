"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { parseBRL } from "@/lib/format";
import { getViewer } from "@/lib/auth/viewer";

export async function payInvoice(formData: FormData) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const id = String(formData.get("id"));
  const amount = parseBRL(String(formData.get("amount") || "0"));
  const inv = await prisma.creditCardInvoice.findUnique({ where: { id } });
  if (!inv) return;
  const newPaid = inv.paid + amount;
  let status = "parcial";
  if (newPaid >= inv.total) status = "paga";
  if (newPaid <= 0) status = inv.status;
  await prisma.creditCardInvoice.update({
    where: { id },
    data: { paid: newPaid, status },
  });
  revalidatePath("/cartoes");
  revalidatePath("/dashboard");
}

export async function setInvoiceStatus(id: string, status: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  await prisma.creditCardInvoice.update({ where: { id }, data: { status } });
  revalidatePath("/cartoes");
}

/**
 * Exclui uma fatura E todas as suas transações (com recebíveis vinculados).
 * Usado para desfazer uma importação de fatura inteira.
 */
export async function deleteInvoice(id: string) {
  await getViewer();
  const inv = await prisma.creditCardInvoice.findUnique({
    where: { id },
    select: { id: true, cardId: true },
  });
  if (!inv) return;

  const txs = await prisma.transaction.findMany({
    where: { invoiceId: id },
    select: { id: true },
  });
  const txIds = txs.map((t) => t.id);

  await prisma.$transaction([
    prisma.receivable.deleteMany({ where: { transactionId: { in: txIds } } }),
    prisma.transaction.deleteMany({ where: { id: { in: txIds } } }),
    prisma.importBatch.updateMany({
      where: { invoiceId: id },
      data: { invoiceId: null },
    }),
    prisma.creditCardInvoice.delete({ where: { id } }),
  ]);

  revalidatePath("/cartoes");
  revalidatePath("/transacoes");
  revalidatePath("/cartoes");
  revalidatePath(`/cartoes/${inv.cardId}`);
  revalidatePath("/dashboard");
}
