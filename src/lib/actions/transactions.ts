"use server";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBRL, parseDateBR } from "@/lib/format";
import { applyRules } from "@/lib/services/rules";
import { attachToInvoice } from "@/lib/services/invoices";
import { transactionHash } from "@/lib/services/hash";

const TxSchema = z.object({
  id: z.string().optional(),
  date: z.date(),
  description: z.string().min(1),
  amount: z.number().nonnegative(),
  type: z.enum(["despesa", "receita", "transferencia", "ajuste"]).default("despesa"),
  origin: z.enum(["cartao", "pix", "debito", "boleto", "dinheiro"]).default("cartao"),
  cardId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  responsibleId: z.string().nullable().optional(),
  payerId: z.string().nullable().optional(),
  belongsTo: z.enum(["pessoal", "empresa", "terceiro", "familiar"]).default("pessoal"),
  status: z.enum(["pendente", "pago", "devendo", "reembolsado", "cancelado"]).default("pendente"),
  reimbursable: z.boolean().default(false),
  notes: z.string().optional().nullable(),
});

function readForm(formData: FormData) {
  const dateStr = String(formData.get("date") || "");
  const date = parseDateBR(dateStr) ?? new Date();
  return TxSchema.parse({
    id: formData.get("id") || undefined,
    date,
    description: formData.get("description"),
    amount: parseBRL(String(formData.get("amount") || "0")),
    type: formData.get("type") || "despesa",
    origin: formData.get("origin") || "cartao",
    cardId: (formData.get("cardId") as string) || null,
    accountId: (formData.get("accountId") as string) || null,
    categoryId: (formData.get("categoryId") as string) || null,
    responsibleId: (formData.get("responsibleId") as string) || null,
    payerId: (formData.get("payerId") as string) || null,
    belongsTo: formData.get("belongsTo") || "pessoal",
    status: formData.get("status") || "pendente",
    reimbursable: formData.get("reimbursable") === "on" || formData.get("reimbursable") === "true",
    notes: (formData.get("notes") as string) || null,
  });
}

export async function saveTransaction(formData: FormData) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const parsed = readForm(formData);

  // Correção conceitual: receita não pode estar vinculada a cartão de crédito.
  // Cartão é meio de dívida/pagamento, não de recebimento.
  if (parsed.type === "receita" && parsed.cardId) {
    throw new Error(
      "Receita não pode ser vinculada a cartão de crédito. Use a aba Receitas para registrar entradas de dinheiro."
    );
  }
  if (parsed.type === "receita" && parsed.origin === "cartao") {
    throw new Error(
      "Receita não pode ter origem em cartão de crédito. Use Pix, transferência, débito ou dinheiro."
    );
  }

  // Aplica regras se categoria/responsável estiverem em branco
  const effects = await applyRules({
    description: parsed.description,
    cardId: parsed.cardId ?? null,
    amount: parsed.amount,
  });

  const data = {
    date: parsed.date,
    description: parsed.description,
    amount: parsed.amount,
    type: parsed.type,
    origin: parsed.origin,
    cardId: parsed.cardId || null,
    accountId: parsed.accountId || null,
    categoryId: parsed.categoryId || effects.categoryId || null,
    responsibleId: parsed.responsibleId || effects.responsibleId || null,
    payerId: parsed.payerId || null,
    belongsTo: parsed.belongsTo || effects.belongsTo || "pessoal",
    status: parsed.status || effects.status || "pendente",
    reimbursable: parsed.reimbursable || effects.reimbursable || false,
    notes: parsed.notes ?? null,
  };

  const hash = transactionHash({
    date: data.date,
    description: data.description,
    amount: data.amount,
    cardId: data.cardId,
    accountId: data.accountId,
  });

  let tx;
  if (parsed.id) {
    tx = await prisma.transaction.update({
      where: { id: parsed.id },
      data: { ...data, hash },
    });
  } else {
    tx = await prisma.transaction.create({
      data: { ...data, hash },
    });
  }

  if (tx.cardId) {
    await attachToInvoice(tx.id);
  }

  revalidatePath("/transacoes");
  revalidatePath("/dashboard");
  revalidatePath("/cartoes");
}

export async function deleteTransaction(id: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  await prisma.transaction.delete({ where: { id } });
  revalidatePath("/transacoes");
  revalidatePath("/dashboard");
  revalidatePath("/cartoes");
}

export async function setTransactionStatus(id: string, status: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  await prisma.transaction.update({ where: { id }, data: { status } });
  revalidatePath("/transacoes");
  revalidatePath("/dashboard");
}

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

  revalidatePath("/cartoes");
  revalidatePath(`/cartoes/${tx.cardId}`);
  revalidatePath("/transacoes");
  revalidatePath("/pessoas");
  revalidatePath("/dashboard");
}
