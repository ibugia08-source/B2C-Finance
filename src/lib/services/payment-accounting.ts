import { MONEY_EPSILON } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { toNumber as n } from "@/lib/format";

/**
 * Núcleo CONTÁBIL do pagamento de cobrança (fechamento mensal B2C).
 * Usado pela Server Action de Recebimentos e pelos testes de cenário —
 * a regra vive num lugar só.
 *
 * Regras:
 *  - Pagamento no mês da COMPETÊNCIA → recebimento do mês; se depois do
 *    vencimento, marca isLate (aviso "!", continua contando no mês).
 *  - Pagamento em mês POSTERIOR → o mês original permanece inadimplente
 *    no fechamento; o pagamento fica registrado como INADIMPLÊNCIA
 *    REGULARIZADA (flag paidInDifferentMonth) e conta no faturamento do
 *    mês do pagamento pela camada de recebimentos (getReceiptsSummary).
 *    NÃO cria Receita Extra automática — Receita Extra é SÓ manual.
 *  - Income de conciliação (caixa) é criado por pagamento; receitas
 *    avulsas (billingId null) não se misturam — sem dupla contagem.
 */


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

/**
 * paidTotal DERIVADO das aplicações (F1.4 · ref. 01 §4.5).
 *
 * A coluna continua existindo — a listagem do mês precisa do saldo sem
 * juntar tabela —, mas ela deixou de ser a VERDADE: a verdade é a soma das
 * PaymentApplication. Somar e subtrair na mão é o que produz saldo que não
 * fecha depois de um estorno no meio de dois parciais.
 *
 * Recebe o cliente da transação de propósito: recalcular fora dela leria um
 * estado que ainda pode ser desfeito.
 */
async function recomputePaidTotal(
  tx: { paymentApplication: { aggregate: (a: any) => Promise<any> } },
  billingId: string
): Promise<number> {
  const soma = await tx.paymentApplication.aggregate({
    where: { billingId },
    _sum: { amount: true },
  });
  return n(soma._sum.amount);
}

/** Erro de negócio do fechamento — vira `{ ok:false }`, nunca 500. */
class SettleError extends Error {}

export async function settleBillingPayment(input: SettleInput): Promise<SettleResult> {
  try {
    // TRANSAÇÃO ÚNICA (auditoria 2026-08-13): Payment + Income de conciliação
    // + saldo/status da cobrança são gravados de forma atômica. A releitura do
    // saldo acontece DENTRO da transação e o update é guardado pelo paidTotal
    // lido — dois cliques "Pago" quase simultâneos não pagam em dobro: o
    // segundo falha na guarda e recebe erro amigável.
    return await prisma.$transaction(async (tx) => {
      const billing = await tx.billing.findUnique({
        where: { id: input.billingId },
        include: {
          contract: { select: { id: true } },
          client: { select: { name: true } },
        },
      });
      if (!billing) throw new SettleError("Cobrança não encontrada.");
      if (billing.status === "CANCELED")
        throw new SettleError("Cobrança cancelada não recebe pagamento.");

      const openAmount = n(billing.amount) - n(billing.paidTotal);
      if (input.amount > openAmount + MONEY_EPSILON) {
        throw new SettleError(
          `Valor maior que o saldo em aberto (${openAmount.toFixed(2)}).`
        );
      }

      const fullyPaidPrevisto = n(billing.paidTotal) + input.amount >= n(billing.amount) - MONEY_EPSILON;

      // ===== Classificação do fechamento mensal =====
      const compKey = billing.competenceYear * 12 + (billing.competenceMonth - 1);
      const paidKey = input.paidAt.getFullYear() * 12 + input.paidAt.getMonth();
      const inLaterMonth = paidKey > compKey;
      const lateSameMonth = !inLaterMonth && input.paidAt > billing.dueDate;

      const payment = await tx.payment.create({
        data: {
          billingId: billing.id,
          amount: input.amount,
          paidAt: input.paidAt,
          method: input.method as any,
          accountId: input.accountId,
          notes: input.notes,
        },
      });

      // F1.4 — a APLICAÇÃO é o fato que liga dinheiro e cobrança (01 §4.5).
      // paidTotal deixou de ser somado na mão: agora é derivado daqui.
      await tx.paymentApplication.create({
        data: {
          paymentId: payment.id,
          billingId: billing.id,
          amount: input.amount,
          appliedAt: input.paidAt,
        },
      });

      const newPaidTotal = await recomputePaidTotal(tx, billing.id);
      const fullyPaid = newPaidTotal >= n(billing.amount) - MONEY_EPSILON;

      // Conciliação caixa ↔ competência (Income vinculado à cobrança E ao
      // pagamento — a reversão apaga por paymentId, nunca por coincidência
      // de valor/data). RECOVERY é SÓ pagamento em mês posterior à
      // competência; atraso dentro do próprio mês é isLate, não recuperação.
      await tx.income.create({
        data: {
          description: `${billing.description} (${fullyPaidPrevisto ? "quitação" : "parcial"})`,
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
          paymentId: payment.id,
          revenueType: inLaterMonth ? "RECOVERY" : billing.revenueType,
        },
      });

      // Guarda otimista: só atualiza se o saldo ainda for o lido acima.
      // runWithoutScope: a extensão multi-tenant injeta ownerId no where de
      // updateMany, e cobrança legada com ownerId NULL nunca casaria (o
      // pagamento falharia para sempre com a mensagem de concorrência). A
      // posse já foi validada no findUnique acima — o bypass aqui é seguro.
      const updated = await runWithoutScope(() =>
        tx.billing.updateMany({
          where: { id: billing.id, paidTotal: billing.paidTotal },
          data: {
            paidTotal: newPaidTotal,
            status: fullyPaid ? "PAID" : "PARTIAL",
            paidAt: fullyPaid ? input.paidAt : null,
            collectionStatus: fullyPaid ? "PAID" : billing.collectionStatus,
            isLate: fullyPaid ? lateSameMonth : billing.isLate,
            paidInDifferentMonth: fullyPaid ? inLaterMonth : billing.paidInDifferentMonth,
          },
        })
      );
      if (updated.count === 0)
        throw new SettleError(
          "Outro pagamento desta cobrança foi registrado ao mesmo tempo — confira o saldo antes de repetir."
        );

      await tx.collectionHistory.create({
        data: {
          billingId: billing.id,
          clientId: billing.clientId,
          status: fullyPaid ? "PAID" : "PROMISED",
          message: fullyPaid
            ? `Pagamento total registrado (${input.method}).${inLaterMonth ? " Pago em mês posterior à competência — inadimplência regularizada (o mês original permanece não recebido)." : lateSameMonth ? " Pago com atraso (dentro do mês)." : ""}`
            : `Pagamento parcial de R$ ${input.amount.toFixed(2)} registrado (${input.method}).`,
        },
      });

      // Receita Extra automática foi REMOVIDA (regra atual: Receita Extra é
      // apenas manual). O pagamento em mês posterior fica registrado pelas
      // flags e conta como recuperação na camada de recebimentos.
      return {
        ok: true as const,
        fullyPaid,
        isLate: fullyPaid ? lateSameMonth : false,
        paidInDifferentMonth: fullyPaid ? inLaterMonth : false,
        extraRevenueId: null,
        paymentId: payment.id,
        clientId: billing.clientId,
      };
    });
  } catch (e) {
    if (e instanceof SettleError) return { ok: false, error: e.message };
    throw e; // infra/DB: deixa o try/catch da action reportar
  }
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Transação interativa: pagamento, Income de conciliação, saldo/status da
  // cobrança E a Receita Extra automática são revertidos de forma atômica —
  // uma falha em qualquer passo desfaz tudo (antes, a Receita Extra ficava
  // fora da transação e podia divergir em caso de erro no meio).
  await prisma.$transaction(async (tx) => {
    // A aplicação some junto com o pagamento (onDelete: Cascade), e é isso
    // que faz o paidTotal recalculado abaixo já vir sem ela.
    await tx.payment.delete({ where: { id: paymentId } });
    // Conciliação: apaga pelo vínculo direto (paymentId). Fallback legado
    // (Incomes anteriores ao vínculo): coincidência de valor/data, limitado a
    // UM registro sem paymentId — dois parciais iguais no mesmo dia nunca
    // perdem as duas conciliações ao desfazer um.
    const linked = await tx.income.deleteMany({ where: { paymentId } });
    if (linked.count === 0) {
      const legacy = await tx.income.findFirst({
        where: {
          billingId: b.id,
          amount: n(payment.amount),
          receivedAt: payment.paidAt,
          paymentId: null,
        },
        select: { id: true },
      });
      if (legacy) await tx.income.delete({ where: { id: legacy.id } });
    }
    const newPaidTotal = await recomputePaidTotal(tx, b.id);
    const status =
      newPaidTotal <= MONEY_EPSILON ? (b.dueDate < today ? "OVERDUE" : "PENDING") : "PARTIAL";

    await tx.billing.update({
      where: { id: b.id },
      data: {
        paidTotal: newPaidTotal,
        status,
        paidAt: null,
        isLate: false,
        paidInDifferentMonth: false,
      },
    });

    // Reverte a Receita Extra automática correspondente (pagamento feito em
    // mês posterior à competência).
    const compKey = b.competenceYear * 12 + (b.competenceMonth - 1);
    const paidKey = payment.paidAt.getFullYear() * 12 + payment.paidAt.getMonth();
    if (paidKey > compKey) {
      const er = await tx.extraRevenue.findFirst({
        where: { originBillingId: b.id, origin: "AUTOMATIC" },
      });
      if (er) {
        const remaining = n(er.amount) - n(payment.amount);
        if (remaining <= MONEY_EPSILON) {
          await tx.extraRevenue.deleteMany({ where: { id: er.id } });
        } else {
          await tx.extraRevenue.updateMany({
            where: { id: er.id },
            data: { amount: remaining },
          });
        }
      }
    }
  });

  return { ok: true, clientId: b.clientId };
}
