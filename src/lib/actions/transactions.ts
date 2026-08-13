"use server";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";
import { revalidateFinance } from "@/lib/revalidate";

function normalizeDescription(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Atribui pessoa responsável a uma transação.
 * Side-effects:
 *  - se a pessoa NÃO for o titular do cartão, marca como reembolsável e status "devendo"
 *    + cria/atualiza Receivable;
 *  - se for o titular (ou nenhuma), limpa flags;
 *  - propaga a mesma pessoa para parcelas futuras "irmãs" (mesmo cartão, mesma descrição
 *    normalizada, mesmo valor total) que ainda não tenham responsável diferente.
 */
export async function setTransactionResponsible(
  transactionId: string,
  personId: string | null
) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { card: { include: { holder: true } } },
  });
  if (!tx) return;

  const holderId = tx.card?.holderId ?? null;
  const isThirdParty = !!personId && personId !== holderId;

  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      responsibleId: personId,
      reimbursable: isThirdParty,
      // Se virou de outra pessoa: marca como devendo (a receber dela).
      // Se voltou para titular/sem responsável: volta para pendente se estava devendo.
      status: isThirdParty
        ? "devendo"
        : tx.status === "devendo"
          ? "pendente"
          : tx.status,
    },
  });

  // Sincroniza Receivable (1 por transação)
  const existingReceivable = await prisma.receivable.findFirst({
    where: { transactionId },
  });
  if (isThirdParty && personId) {
    if (existingReceivable) {
      await prisma.receivable.update({
        where: { id: existingReceivable.id },
        data: {
          personId,
          amount: tx.amount,
          status: existingReceivable.status === "pago" ? "pago" : "aberto",
        },
      });
    } else {
      await prisma.receivable.create({
        data: {
          personId,
          transactionId,
          amount: tx.amount,
          dueDate: tx.date,
          status: "aberto",
        },
      });
    }
  } else if (existingReceivable) {
    await prisma.receivable.delete({ where: { id: existingReceivable.id } });
  }

  // Propaga para parcelas "irmãs" futuras da mesma compra — tudo em LOTE.
  // Prioriza o grupo de parcelamento (installmentGroupKey); sem ele, cai no
  // match legado por descrição normalizada + valor.
  if (tx.cardId) {
    const baseWhere = tx.installmentGroupKey
      ? { installmentGroupKey: tx.installmentGroupKey }
      : { cardId: tx.cardId, amount: tx.amount };
    const candidates = await prisma.transaction.findMany({
      where: {
        ...baseWhere,
        date: { gt: tx.date },
        id: { not: tx.id },
        OR: [{ responsibleId: null }, { responsibleId: holderId }],
      },
      select: { id: true, description: true, amount: true, date: true, status: true },
    });

    const norm = normalizeDescription(tx.description);
    const siblings = tx.installmentGroupKey
      ? candidates
      : candidates.filter((c) => normalizeDescription(c.description) === norm);

    if (siblings.length > 0) {
      const ids = siblings.map((c) => c.id);
      const devendoIds = siblings
        .filter((c) => c.status === "devendo")
        .map((c) => c.id);

      const ops: any[] = [
        prisma.transaction.updateMany({
          where: { id: { in: ids } },
          data: { responsibleId: personId, reimbursable: isThirdParty },
        }),
        isThirdParty
          ? prisma.transaction.updateMany({
              where: { id: { in: ids } },
              data: { status: "devendo" },
            })
          : devendoIds.length > 0
            ? prisma.transaction.updateMany({
                where: { id: { in: devendoIds } },
                data: { status: "pendente" },
              })
            : null,
        // Recebíveis: recria em lote conforme o novo responsável
        prisma.receivable.deleteMany({ where: { transactionId: { in: ids } } }),
        isThirdParty && personId
          ? prisma.receivable.createMany({
              data: siblings.map((c) => ({
                personId,
                transactionId: c.id,
                amount: c.amount,
                dueDate: c.date,
                status: "aberto",
              })),
            })
          : null,
      ].filter(Boolean);

      await prisma.$transaction(ops);
    }
  }

  revalidateFinance({ cardId: tx.cardId });
}
