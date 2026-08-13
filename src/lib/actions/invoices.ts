"use server";
import { prisma } from "@/lib/prisma";
import { revalidateFinance } from "@/lib/revalidate";
import { requirePermission } from "@/lib/auth/viewer";

/**
 * Exclui uma fatura E todas as suas transações (com recebíveis vinculados).
 * Usado para desfazer uma importação de fatura inteira.
 */
export async function deleteInvoice(id: string) {
  await requirePermission("despesas.excluir");
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

  revalidateFinance({ cardId: inv.cardId });
}
