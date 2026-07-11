import { prisma } from "@/lib/prisma";

/**
 * Núcleo CONTÁBIL do pagamento de cobrança (fechamento mensal B2C).
 * Usado pela Server Action de Recebimentos e pelos testes de cenário —
 * a regra vive num lugar só.
 *
 * Regras:
 *  - Pagamento no mês da COMPETÊNCIA → recebimento do mês; se depois do
 *    vencimento, marca isLate (aviso "!", continua contando no mês).
 *  - Pagamento em mês POSTERIOR → o mês original permanece inadimplente
 *    no fechamento; o valor entra no mês do pagamento como RECEITA EXTRA
 *    automática (RECOVERY_OF_OVERDUE). Idempotente: originBillingId é
 *    único — parciais ACUMULAM no mesmo registro, nunca duplicam.
 *  - Income de conciliação (caixa) é criado por pagamento; receitas
 *    avulsas (billingId null) não se misturam — sem dupla contagem.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v));

const MONTH_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Descrição oficial da Receita Extra automática (formato do briefing). */
function recoveryDescription(
  clientName: string,
  refMonth: number,
  refYear: number,
  paidAt: Date
): string {
  const data = paidAt.toLocaleDateString("pt-BR");
  return `Pagamento de ${clientName} referente a ${MONTH_PT[refMonth - 1]}/${refYear}, recebido em ${data}.`;
}

export type SettleInput = {
  billingId: string;
  amount: number;
  paidAt: Date;
  method: string; // PaymentMethod
  accountId: string | null;
  notes: string | null;
};

export type SettleResult =
  | {
      ok: true;
      fullyPaid: boolean;
      isLate: boolean;
      paidInDifferentMonth: boolean;
      extraRevenueId: string | null;
      paymentId: string;
      clientId: string;
    }
  | { ok: false; error: string };

export async function settleBillingPayment(input: SettleInput): Promise<SettleResult> {
  const billing = await prisma.billing.findUnique({
    where: { id: input.billingId },
    include: {
      contract: { select: { id: true } },
      client: { select: { name: true } },
    },
  });
  if (!billing) return { ok: false, error: "Cobrança não encontrada." };
  if (billing.status === "CANCELED")
    return { ok: false, error: "Cobrança cancelada não recebe pagamento." };

  const openAmount = n(billing.amount) - n(billing.paidTotal);
  if (input.amount > openAmount + 0.01) {
    return {
      ok: false,
      error: `Valor maior que o saldo em aberto (${openAmount.toFixed(2)}).`,
    };
  }

  const wasOverdue = billing.status === "OVERDUE";
  const newPaidTotal = n(billing.paidTotal) + input.amount;
  const fullyPaid = newPaidTotal >= n(billing.amount) - 0.01;

  // ===== Classificação do fechamento mensal =====
  const compKey = billing.competenceYear * 12 + (billing.competenceMonth - 1);
  const paidKey = input.paidAt.getFullYear() * 12 + input.paidAt.getMonth();
  const inLaterMonth = paidKey > compKey;
  const lateSameMonth = !inLaterMonth && input.paidAt > billing.dueDate;

  const payment = await prisma.payment.create({
    data: {
      billingId: billing.id,
      amount: input.amount,
      paidAt: input.paidAt,
      method: input.method as any,
      accountId: input.accountId,
      notes: input.notes,
    },
  });

  // Conciliação caixa ↔ competência (Income vinculado à cobrança).
  await prisma.income.create({
    data: {
      description: `${billing.description} (${fullyPaid ? "quitação" : "parcial"})`,
      amount: input.amount,
      receivedAt: input.paidAt,
      sourceType:
        input.method === "CASH" ? "CASH" : input.method === "PIX" ? "PIX" : "BANK_ACCOUNT",
      incomeType: "SALE",
      status: "RECEIVED",
      accountId: input.accountId,
      clientId: billing.clientId,
      contractId: billing.contractId,
      billingId: billing.id,
      revenueType: wasOverdue ? "RECOVERY" : billing.revenueType,
    },
  });

  // Receita Extra automática — idempotente por cobrança (originBillingId único).
  let extraRevenueId: string | null = null;
  if (inLaterMonth) {
    const existingER = await prisma.extraRevenue.findFirst({
      where: { originBillingId: billing.id },
    });
    const erDescription = recoveryDescription(
      billing.client.name,
      billing.competenceMonth,
      billing.competenceYear,
      input.paidAt
    );
    if (existingER) {
      // Reutiliza o registro (idempotência) — parciais acumulam, nunca duplicam.
      await prisma.extraRevenue.updateMany({
        where: { id: existingER.id },
        data: {
          amount: n(existingER.amount) + input.amount,
          receivedAt: input.paidAt,
          description: erDescription,
        },
      });
      extraRevenueId = existingER.id;
    } else {
      const er = await prisma.extraRevenue.create({
        data: {
          clientId: billing.clientId,
          originBillingId: billing.id,
          sourcePaymentId: payment.id,
          type: "RECOVERY_OF_OVERDUE",
          origin: "AUTOMATIC",
          description: erDescription,
          amount: input.amount,
          receivedAt: input.paidAt,
          originalReferenceMonth: billing.competenceMonth,
          originalReferenceYear: billing.competenceYear,
        },
      });
      extraRevenueId = er.id;
    }
  }

  await prisma.billing.update({
    where: { id: billing.id },
    data: {
      paidTotal: newPaidTotal,
      status: fullyPaid ? "PAID" : "PARTIAL",
      paidAt: fullyPaid ? input.paidAt : null,
      collectionStatus: fullyPaid ? "PAID" : billing.collectionStatus,
      isLate: fullyPaid ? lateSameMonth : billing.isLate,
      paidInDifferentMonth: fullyPaid ? inLaterMonth : billing.paidInDifferentMonth,
    },
  });

  await prisma.collectionHistory.create({
    data: {
      billingId: billing.id,
      clientId: billing.clientId,
      status: fullyPaid ? "PAID" : "PROMISED",
      message: fullyPaid
        ? `Pagamento total registrado (${input.method}).${inLaterMonth ? " Pago em mês posterior à competência — valor lançado como Receita Extra." : lateSameMonth ? " Pago com atraso (dentro do mês)." : ""}`
        : `Pagamento parcial de R$ ${input.amount.toFixed(2)} registrado (${input.method}).`,
    },
  });

  return {
    ok: true,
    fullyPaid,
    isLate: fullyPaid ? lateSameMonth : false,
    paidInDifferentMonth: fullyPaid ? inLaterMonth : false,
    extraRevenueId,
    paymentId: payment.id,
    clientId: billing.clientId,
  };
}

/** Reverte um pagamento (exclusão): saldo, status, flags e Receita Extra. */
export async function revertBillingPayment(paymentId: string): Promise<
  { ok: true; clientId: string } | { ok: false; error: string }
> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { billing: true },
  });
  if (!payment) return { ok: false, error: "Pagamento não encontrado." };

  const b = payment.billing;
  const newPaidTotal = Math.max(0, n(b.paidTotal) - n(payment.amount));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const status =
    newPaidTotal <= 0.01 ? (b.dueDate < today ? "OVERDUE" : "PENDING") : "PARTIAL";

  await prisma.$transaction([
    prisma.payment.delete({ where: { id: paymentId } }),
    prisma.income.deleteMany({
      where: { billingId: b.id, amount: n(payment.amount), receivedAt: payment.paidAt },
    }),
    prisma.billing.update({
      where: { id: b.id },
      data: {
        paidTotal: newPaidTotal,
        status,
        paidAt: null,
        isLate: false,
        paidInDifferentMonth: false,
      },
    }),
  ]);

  // Reverte a Receita Extra automática correspondente.
  const compKey = b.competenceYear * 12 + (b.competenceMonth - 1);
  const paidKey = payment.paidAt.getFullYear() * 12 + payment.paidAt.getMonth();
  if (paidKey > compKey) {
    const er = await prisma.extraRevenue.findFirst({
      where: { originBillingId: b.id, origin: "AUTOMATIC" },
    });
    if (er) {
      const remaining = n(er.amount) - n(payment.amount);
      if (remaining <= 0.01) {
        await prisma.extraRevenue.deleteMany({ where: { id: er.id } });
      } else {
        await prisma.extraRevenue.updateMany({
          where: { id: er.id },
          data: { amount: remaining },
        });
      }
    }
  }

  return { ok: true, clientId: b.clientId };
}
