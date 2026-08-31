import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { splitTcv } from "@/lib/services/tcv-installments";
import { toCompetence } from "@/lib/competence";

/**
 * REPARCELAMENTO (F3.7 · ref. 01 §3.13).
 *
 * "NÃO cria nova receita." É a regra inteira, e a mais fácil de violar sem
 * perceber: as parcelas novas parecem cobranças normais e, se entrarem como
 * receita, o faturamento do mês salta com dinheiro que já foi faturado meses
 * atrás. O cliente aparece pagando duas vezes a mesma venda.
 *
 * As três coisas que fazem isso funcionar:
 *
 *  1. As parcelas nascem `recognitionMode = SETTLEMENT_ONLY`: entram na
 *     cobrança e no recebível, e NÃO no faturamento nem no DRE.
 *  2. As cobranças antigas viram `RENEGOTIATED` — não "paga" (o recebido do
 *     mês subiria sem ninguém ter pago) e não "cancelada" (sumiria da
 *     história do cliente).
 *  3. O SALDO ORIGINAL fica gravado no acordo. Sem ele, "quanto este cliente
 *     devia antes de renegociar?" vira reconstrução manual em cima de
 *     cobranças que já mudaram de estado.
 */

export type EntradaAcordo = {
  clientId: string;
  billingIds: string[];
  /** Desconto concedido sobre o saldo aberto. */
  desconto?: number;
  /** Juros acrescentados. */
  juros?: number;
  parcelas: number;
  /** Vencimento da primeira parcela. */
  primeiroVencimento: Date;
  observacao?: string | null;
  criadoPor?: string | null;
};

export async function renegociar(
  input: EntradaAcordo
): Promise<
  | { ok: true; agreementId: string; saldoOriginal: number; negociado: number; parcelas: number[] }
  | { ok: false; error: string }
> {
  if (input.billingIds.length === 0)
    return { ok: false, error: "Escolha ao menos uma cobrança para renegociar." };
  if (!(input.parcelas >= 1))
    return { ok: false, error: "O acordo precisa de pelo menos uma parcela." };

  const cobrancas = await prisma.billing.findMany({
    where: { id: { in: input.billingIds } },
    select: {
      id: true, clientId: true, amount: true, paidTotal: true, status: true,
      relationshipId: true, contractId: true,
    },
  });
  if (cobrancas.length !== input.billingIds.length)
    return { ok: false, error: "Alguma das cobranças não foi encontrada." };
  if (cobrancas.some((c) => c.status === "CANCELED" || c.status === "RENEGOTIATED"))
    return { ok: false, error: "Há cobrança cancelada ou já renegociada na seleção." };
  if (cobrancas.some((c) => c.clientId !== input.clientId))
    return { ok: false, error: "As cobranças precisam ser todas do mesmo cliente." };

  // SALDO ABERTO, não valor cheio: o que já foi pago não volta para o acordo.
  const saldoOriginal =
    Math.round(
      cobrancas.reduce((s, c) => s + Math.max(0, n(c.amount) - n(c.paidTotal)), 0) * 100
    ) / 100;
  if (saldoOriginal <= 0)
    return { ok: false, error: "Não há saldo em aberto nas cobranças escolhidas." };

  const desconto = Math.round((input.desconto ?? 0) * 100) / 100;
  const juros = Math.round((input.juros ?? 0) * 100) / 100;
  if (desconto < 0 || juros < 0)
    return { ok: false, error: "Desconto e juros não podem ser negativos." };
  if (desconto > saldoOriginal)
    return { ok: false, error: "O desconto é maior que o saldo em aberto." };

  const negociado = Math.round((saldoOriginal - desconto + juros) * 100) / 100;

  // Mesma divisão em centavos do TCV (§3.14): resíduo na ÚLTIMA parcela, e
  // a soma bate exatamente. Duas rotinas de arredondamento diferentes no
  // mesmo sistema é como nasce a diferença de um centavo que ninguém acha.
  const base = input.primeiroVencimento;
  const valores = splitTcv(negociado, input.parcelas, base, {
    year: base.getFullYear(),
    month: base.getMonth() + 1,
  });
  const relationshipId = cobrancas.find((c) => c.relationshipId)?.relationshipId ?? null;

  return prisma.$transaction(async (tx) => {
    const acordo = await tx.renegotiationAgreement.create({
      data: {
        clientId: input.clientId,
        relationshipId,
        originalBalance: saldoOriginal,
        negotiatedBalance: negociado,
        discountAmount: desconto,
        interestAmount: juros,
        installments: input.parcelas,
        signedAt: new Date(),
        notes: input.observacao ?? null,
        createdBy: input.criadoPor ?? null,
      },
      select: { id: true },
    });

    await tx.billing.updateMany({
      where: { id: { in: input.billingIds } },
      data: { status: "RENEGOTIATED", renegotiatedInId: acordo.id },
    });

    for (const p of valores) {
      await tx.billing.create({
        data: {
          clientId: input.clientId,
          relationshipId,
          description: `Acordo ${p.numero}/${valores.length}`,
          competenceMonth: p.competenceMonth,
          competenceYear: p.competenceYear,
          dueDate: p.dueDate,
          amount: p.amount,
          status: "PENDING",
          // O CAMPO QUE FAZ A REGRA VALER: parcela de acordo liquida dívida
          // antiga e não reconhece receita nova.
          recognitionMode: "SETTLEMENT_ONLY",
          billingKind: "ONE_TIME",
          settlementOfId: acordo.id,
        },
      });
    }

    return {
      ok: true as const,
      agreementId: acordo.id,
      saldoOriginal,
      negociado,
      parcelas: valores.map((p) => p.amount),
    };
  });
}

/** Acordos de um cliente, do mais recente. */
export async function acordosDe(clientId: string) {
  return prisma.renegotiationAgreement.findMany({
    where: { clientId },
    orderBy: { signedAt: "desc" },
    include: {
      originalBillings: { select: { id: true, description: true, amount: true } },
      newBillings: {
        select: { id: true, description: true, amount: true, paidTotal: true, status: true, dueDate: true },
        orderBy: { dueDate: "asc" },
      },
    },
  });
}

/**
 * O acordo foi cumprido, está em dia ou foi quebrado?
 *
 * "Quebrado" não é opinião: é parcela vencida e não paga. A régua de cobrança
 * precisa dessa resposta para saber se volta a cobrar o saldo antigo.
 */
export async function situacaoDoAcordo(agreementId: string) {
  const a = await prisma.renegotiationAgreement.findUnique({
    where: { id: agreementId },
    include: { newBillings: true },
  });
  if (!a) return null;

  const hoje = new Date();
  const pago = a.newBillings.reduce((s, b) => s + n(b.paidTotal), 0);
  const total = a.newBillings.reduce((s, b) => s + n(b.amount), 0);
  const vencidasAbertas = a.newBillings.filter(
    (b) => b.dueDate < hoje && n(b.paidTotal) < n(b.amount) - 0.005
  ).length;

  const situacao =
    pago >= total - 0.005 ? "FULFILLED" : vencidasAbertas > 0 ? "BROKEN" : "ACTIVE";

  if (situacao !== a.status) {
    await prisma.renegotiationAgreement.update({
      where: { id: a.id },
      data: { status: situacao },
    });
  }
  return { situacao, pago, total, vencidasAbertas, parcelas: a.newBillings.length };
}

export { toCompetence };
