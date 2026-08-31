import { prisma } from "@/lib/prisma";
import { toCompetence } from "@/lib/competence";
import { contextFromRequest, type EngineContext } from "./context";
import { guardIdempotency, guardPeriod, guardPermission } from "./guards";
import {
  revertBillingPayment,
  settleBillingPayment,
  type SettleInput,
  type SettleResult,
} from "@/lib/services/payment-accounting";
import { applyCredit } from "@/lib/services/customer-credit";

/**
 * PaymentEngine (F1.5 · ref. 03 §4.1).
 *
 * Porta de entrada ÚNICA para os fatos de caixa. O pipeline da spec, na
 * ordem em que ela o escreve:
 *
 *   permission -> period guard -> idempotency guard -> Payment
 *     -> PaymentApplication -> AccountingEngine -> AuditLog
 *     -> OutboxEvent -> commit
 *
 * As três primeiras etapas moram AQUI porque são perguntas sobre a
 * operação; da quarta em diante moram na transação de
 * services/payment-accounting, que é o núcleo já provado pela suíte da
 * F0.2. O motor não reimplementa o núcleo — ele o guarda. Reescrever a
 * parte testada só para "ficar tudo no mesmo arquivo" trocaria segurança
 * por arrumação.
 */

export type EngineResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export type SettleOptions = {
  reason?: string | null;
  /** Pagamento vindo de fora (gateway, OFX): dispara a guarda de duplicidade. */
  externalSource?: string | null;
  externalId?: string | null;
};

/**
 * A competência que um recebimento afeta é a DO CAIXA (01 §5.6).
 *
 * Exportada para poder ser testada como regra, e não como coincidência de
 * aritmética repetida dentro de um teste.
 */
export function competenciaDoCaixa(paidAt: Date) {
  return toCompetence(paidAt.getFullYear(), paidAt.getMonth() + 1);
}

export async function settleBilling(
  input: SettleInput,
  opts: SettleOptions = {}
): Promise<SettleResult> {
  // 1. Permissão
  const perm = await guardPermission("recebimentos.registrar_pagamento");
  if (!perm.ok) return perm;

  const billing = await prisma.billing.findUnique({
    where: { id: input.billingId },
    select: { competenceYear: true, competenceMonth: true },
  });
  if (!billing) return { ok: false, error: "Cobrança não encontrada." };

  // 2. Período — e a competência que importa aqui é a DO CAIXA, não a da
  //    cobrança (01 §5.6). Cliente que paga em outubro uma cobrança de
  //    agosto, com agosto já fechado, é o caso mais comum da operação de
  //    cobrança: o dinheiro entra em outubro, o razão posta em outubro e a
  //    fotografia de agosto continua mostrando vencido, porque foi assim que
  //    agosto fechou. Perguntar pela competência da COBRANÇA travaria essa
  //    operação inteira todo dia 6.
  const periodo = await guardPeriod(
    "CUSTOMER_PAYMENT_RECEIVED",
    competenciaDoCaixa(input.paidAt)
  );
  if (!periodo.ok) return periodo;

  // 3. Idempotência do fato EXTERNO — o mesmo webhook duas vezes registra
  //    um pagamento só (cenário S20). A trava definitiva é a unique no
  //    banco; esta guarda existe para a segunda chamada receber resposta
  //    limpa em vez de erro de constraint.
  const idem = await guardIdempotency(
    () =>
      prisma.payment.findFirst({
        where: { externalSource: opts.externalSource!, externalId: opts.externalId! },
        select: { id: true },
      }),
    opts.externalSource && opts.externalId ? `${opts.externalSource}:${opts.externalId}` : null
  );
  if (!idem.ok) return { ok: false, error: idem.error };

  const ctx = await contextFromRequest({ reason: opts.reason });
  return settleBillingPayment(input, ctx);
}

/** Estorno. 01 §4.10 exige MOTIVO — aqui ele é obrigatório de verdade. */
export async function revertPayment(
  paymentId: string,
  reason: string
): Promise<EngineResult<{ clientId: string }>> {
  const perm = await guardPermission("recebimentos.registrar_pagamento");
  if (!perm.ok) return perm;
  if (!reason?.trim())
    return { ok: false, error: "Informe o motivo do estorno." };

  const ctx = await contextFromRequest({ reason });
  return revertBillingPayment(paymentId, ctx);
}

/** Usa o crédito do cliente para abater uma cobrança (F1.8). */
export async function useCredit(
  billingId: string,
  amount?: number
): Promise<EngineResult<{ applied: number }>> {
  const perm = await guardPermission("recebimentos.registrar_pagamento");
  if (!perm.ok) return perm;
  return applyCredit({ billingId, amount });
}

export type { EngineContext };
