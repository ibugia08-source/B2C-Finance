import { z } from "zod";
import { PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { competenciaDoCaixa, registerPayment } from "@/lib/engines/payment-engine";
import { guardPeriod } from "@/lib/engines/guards";
import { type DomainContext, inDomain } from "@/lib/engines/domain";
import { MONEY_EPSILON } from "@/lib/billing-status";
import { ApiError } from "../auth";
import { dataSchema, dinheiro, instante } from "../http";
import { dataCivil, falhaDoDominio, hoje, valor } from "./write-common";
import { detalharRecebivelApi } from "./receivables";

/**
 * REGISTRAR PAGAMENTO PELA API — o mesmo motor do "$" de Recebimentos
 * (`registerPayment` → settleBilling: permissão, guarda de período do CAIXA,
 * transação, crédito do excedente, receita extra, auditoria).
 *
 * Antes de chamar o motor, a API confere o que um agente pode errar:
 *  · a cobrança é do dono (senão 404);
 *  · o estado: cancelada, renegociada ou já quitada não recebe (422);
 *  · o valor: positivo, 2 casas; ACIMA do saldo só com `allowOverpayment`
 *    (o excedente vira crédito do cliente — decisão explícita, não engano);
 *  · a data: não pode ser futura;
 *  · a competência do caixa (mês do pagamento) não pode estar fechada;
 *  · duplicidade: já existe pagamento igual (mesmo valor, mesma data) nesta
 *    cobrança → 409, salvo `allowDuplicate`. Além disso, o pagamento grava a
 *    identidade externa `api` + conta + Idempotency-Key: a trava única do
 *    banco impede o mesmo pedido de virar dois pagamentos.
 */

export const PaymentBody = z
  .object({
    amount: valor,
    /** Data do pagamento (padrão: hoje). */
    paidAt: dataSchema.optional(),
    method: z.nativeEnum(PaymentMethod).default("PIX"),
    accountId: z.string().trim().max(64).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    allowOverpayment: z.boolean().default(false),
    allowDuplicate: z.boolean().default(false),
  })
  .strict();

export async function registrarPagamentoApi(
  ctx: DomainContext,
  billingId: string,
  b: z.output<typeof PaymentBody>,
  identidade: { serviceAccountId: string; idempotencyKey: string }
) {
  const paidAtKey = b.paidAt ?? hoje();
  if (paidAtKey > hoje()) throw new ApiError(422, "unprocessable", "A data do pagamento não pode ser futura.");
  const paidAt = dataCivil(paidAtKey);

  const cobranca = await inDomain(ctx, async () =>
    await prisma.billing.findFirst({
      where: { id: billingId },
      select: { id: true, status: true, amount: true, paidTotal: true, clientId: true, client: { select: { name: true } } },
    })
  );
  if (!cobranca) throw new ApiError(404, "not_found", "Recebimento não encontrado.");
  if (cobranca.status === "CANCELED") throw new ApiError(422, "invalid_state", "Cobrança removida do mês não recebe pagamento.");
  if (cobranca.status === "RENEGOTIATED")
    throw new ApiError(422, "invalid_state", "Cobrança renegociada: registre o pagamento nas parcelas do acordo.");
  const saldo = Math.round((Number(cobranca.amount) - Number(cobranca.paidTotal)) * 100) / 100;
  if (cobranca.status === "PAID" || saldo <= MONEY_EPSILON)
    throw new ApiError(422, "invalid_state", "Esta cobrança já está quitada.");
  if (b.amount > saldo + MONEY_EPSILON && !b.allowOverpayment) {
    throw new ApiError(
      422,
      "unprocessable",
      `O valor (${b.amount.toFixed(2)}) passa do saldo em aberto (${saldo.toFixed(2)}). Para lançar o excedente como crédito do cliente, envie "allowOverpayment": true.`
    );
  }

  const periodo = await inDomain(ctx, async () => await guardPeriod("CUSTOMER_PAYMENT_RECEIVED", competenciaDoCaixa(paidAt)));
  if (!periodo.ok) throw new ApiError(422, "competence_closed", periodo.error);

  if (b.accountId) {
    const conta = await inDomain(ctx, async () => await prisma.account.findFirst({ where: { id: b.accountId! }, select: { id: true } }));
    if (!conta) throw new ApiError(404, "not_found", "Conta bancária não encontrada.");
  }

  if (!b.allowDuplicate) {
    const igual = await inDomain(ctx, async () =>
      await prisma.payment.findFirst({
        where: { billingId, amount: b.amount, paidAt, status: "CONFIRMED" },
        select: { id: true },
      })
    );
    if (igual) {
      throw new ApiError(
        409,
        "possible_duplicate",
        `Já existe um pagamento de ${b.amount.toFixed(2)} em ${paidAtKey} nesta cobrança (${igual.id}). Se for mesmo outro pagamento, envie "allowDuplicate": true.`
      );
    }
  }

  const r = await registerPayment(
    ctx,
    { billingId, amount: b.amount, paidAt, method: b.method, accountId: b.accountId ?? null, notes: b.notes ?? null },
    { externalSource: "api", externalId: `${identidade.serviceAccountId}:${identidade.idempotencyKey}` }
  );
  if (!r.ok) throw falhaDoDominio(r);

  const recebimento = (await inDomain(ctx, async () => await detalharRecebivelApi(billingId)))!;
  const pagamento = recebimento.payments.find((p) => p.id === r.paymentId);
  return {
    clientId: r.clientId,
    clientName: cobranca.client.name,
    data: {
      payment: {
        id: r.paymentId,
        amount: pagamento?.amount ?? dinheiro(b.amount),
        paidAt: pagamento?.paidAt ?? instante(paidAt),
        method: b.method,
        fullyPaid: r.fullyPaid,
        paidLate: r.isLate,
        paidInDifferentMonth: r.paidInDifferentMonth,
        creditGenerated: r.creditGenerated,
        creditApplied: r.creditApplied,
        creditRemaining: r.creditRemaining,
      },
      receivable: recebimento,
    },
  };
}
