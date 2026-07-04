import { prisma } from "@/lib/prisma";
import type { CreditCard } from "@prisma/client";

/**
 * Determina mês/ano de fatura para uma compra em `date` num cartão com closingDay.
 * Se a data de compra é >= closingDay, vai para a próxima fatura.
 *
 * ATENÇÃO: usado apenas para transações MANUAIS de cartão. Importação de fatura
 * usa a fatura real como âncora (ensureInvoiceForReference) — nunca re-bucketiza
 * pela data da compra.
 */
export function invoiceReferenceFor(date: Date, closingDay: number) {
  const d = new Date(date);
  let year = d.getFullYear();
  let month = d.getMonth() + 1; // 1-12
  if (d.getDate() >= closingDay) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { referenceMonth: month, referenceYear: year };
}

/** Referência (mês/ano) a partir de uma data — ex.: vencimento detectado no PDF. */
export function referenceFromDate(d: Date) {
  return { referenceMonth: d.getMonth() + 1, referenceYear: d.getFullYear() };
}

export function referenceKey(refYear: number, refMonth: number): string {
  return `${refYear}-${String(refMonth).padStart(2, "0")}`;
}

export async function ensureInvoice(cardId: string, refMonth: number, refYear: number) {
  const card = await prisma.creditCard.findUnique({ where: { id: cardId } });
  if (!card) throw new Error("Cartão não encontrado");
  return ensureInvoiceForReference(card, refMonth, refYear);
}

/**
 * Busca/cria a fatura de um mês de referência (âncora de importação).
 * Recebe o cartão já carregado para evitar round-trip extra.
 * Datas reais detectadas no PDF (fechamento/vencimento/total declarado)
 * atualizam a fatura quando disponíveis.
 */
export async function ensureInvoiceForReference(
  card: CreditCard,
  refMonth: number,
  refYear: number,
  detected?: { closingDate?: Date; dueDate?: Date; declaredTotal?: number }
) {
  const existing = await prisma.creditCardInvoice.findUnique({
    where: {
      cardId_referenceYear_referenceMonth: {
        cardId: card.id,
        referenceYear: refYear,
        referenceMonth: refMonth,
      },
    },
  });

  if (existing) {
    // Enriquece com dados reais do PDF sem sobrescrever pagamento/status.
    const data: Record<string, unknown> = {};
    if (detected?.closingDate) data.closingDate = detected.closingDate;
    if (detected?.dueDate) data.dueDate = detected.dueDate;
    if (detected?.declaredTotal != null) data.declaredTotal = detected.declaredTotal;
    if (Object.keys(data).length > 0) {
      return prisma.creditCardInvoice.update({ where: { id: existing.id }, data });
    }
    return existing;
  }

  const closingDate =
    detected?.closingDate ?? new Date(refYear, refMonth - 1, card.closingDay);
  const dueDate = detected?.dueDate ?? new Date(refYear, refMonth - 1, card.dueDay);

  // Fatura importada é uma fatura já emitida pelo banco → "fechada".
  // (Faturas criadas por transações manuais continuam nascendo "aberta"
  //  via ensureInvoice/attachToInvoice — sem `detected`.)
  const status = detected ? "fechada" : "aberta";

  return prisma.creditCardInvoice.create({
    data: {
      cardId: card.id,
      referenceMonth: refMonth,
      referenceYear: refYear,
      closingDate,
      dueDate,
      declaredTotal: detected?.declaredTotal ?? null,
      total: 0,
      paid: 0,
      status,
    },
  });
}

export async function recalcInvoiceTotal(invoiceId: string) {
  // Compras (despesa) somam; estornos/créditos (ajuste/receita) abatem.
  const byType = await prisma.transaction.groupBy({
    by: ["type"],
    where: { invoiceId, status: { not: "cancelado" } },
    _sum: { amount: true },
  });
  let total = 0;
  for (const t of byType) {
    const sum = t._sum.amount ?? 0;
    total += t.type === "despesa" ? sum : -sum;
  }
  await prisma.creditCardInvoice.update({
    where: { id: invoiceId },
    data: { total },
  });
}

/**
 * Anexa UMA transação manual de cartão à fatura correspondente à data da compra.
 * Usado apenas fora da importação (a importação ancora tudo na fatura real).
 */
export async function attachToInvoice(transactionId: string) {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || !tx.cardId) return null;
  const card = await prisma.creditCard.findUnique({ where: { id: tx.cardId } });
  if (!card) return null;
  const ref = invoiceReferenceFor(tx.date, card.closingDay);
  const inv = await ensureInvoiceForReference(card, ref.referenceMonth, ref.referenceYear);
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { invoiceId: inv.id },
  });
  await recalcInvoiceTotal(inv.id);
  return inv;
}
