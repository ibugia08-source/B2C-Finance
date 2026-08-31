import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { currentWorkspaceId } from "@/lib/services/workspace";
import type { Competence } from "@/lib/competence";

/**
 * AJUSTE DE COBRANÇA (F3.8 · ref. 01 §4.7, §3.12).
 *
 * DECIDIDO 19.35/19.36: sem teto e sem fila de aprovação. Quem tem a
 * permissão faz, e fica na trilha. O controle é permissão + motivo + razão
 * contábil, não um segundo aprovador.
 *
 * O QUE NÃO MUDA COM ESSA DECISÃO, e é o que este arquivo protege:
 *
 *  · O VALOR ORIGINAL é preservado em toda linha. Uma cobrança que muda de
 *    preço sem registrar de quanto para quanto é um número que ninguém
 *    consegue explicar depois — e "por que este cliente pagou menos?" é uma
 *    pergunta que sempre volta.
 *  · WRITE-OFF NÃO É DESCONTO. Desconto reduz a receita reconhecida; baixa
 *    de dívida reconhece uma PERDA e deixa a receita de pé. Tratar os dois
 *    igual faz a receita do mês encolher retroativamente e o histórico de
 *    faturamento mentir.
 *  · Todo ajuste com efeito econômico POSTA no razão.
 */

export type TipoAjuste = "DISCOUNT" | "FEE" | "INTEREST" | "WRITE_OFF" | "CORRECTION";

/** Como cada tipo mexe no valor da cobrança. */
const SINAL: Record<TipoAjuste, -1 | 1 | 0> = {
  DISCOUNT: -1,
  WRITE_OFF: 0, // não muda o valor: reconhece perda sobre o saldo aberto
  FEE: 1,
  INTEREST: 1,
  CORRECTION: 0, // o novo valor vem informado
};

export type EntradaAjuste = {
  billingId: string;
  type: TipoAjuste;
  /** Valor do ajuste (sempre positivo). Em CORRECTION, é o NOVO valor. */
  amount: number;
  reason: string;
  requestedBy?: string | null;
};

export async function ajustarCobranca(
  input: EntradaAjuste
): Promise<
  | { ok: true; adjustmentId: string; de: number; para: number }
  | { ok: false; error: string }
> {
  const motivo = (input.reason ?? "").trim();
  if (motivo.length < 5) return { ok: false, error: "Escreva o motivo do ajuste." };
  if (!(input.amount > 0)) return { ok: false, error: "O valor do ajuste tem de ser positivo." };

  const b = await prisma.billing.findUnique({
    where: { id: input.billingId },
    select: {
      id: true, amount: true, paidTotal: true, status: true, clientId: true,
      competence: true, relationshipId: true,
    },
  });
  if (!b) return { ok: false, error: "Cobrança não encontrada." };
  if (b.status === "CANCELED")
    return { ok: false, error: "Cobrança cancelada não recebe ajuste." };

  const original = n(b.amount);
  const emAberto = Math.max(0, original - n(b.paidTotal));

  let novo = original;
  if (input.type === "CORRECTION") novo = input.amount;
  else if (SINAL[input.type] !== 0) novo = original + SINAL[input.type] * input.amount;

  if (novo < 0) return { ok: false, error: "O ajuste deixaria a cobrança negativa." };
  if (input.type === "DISCOUNT" && input.amount > emAberto)
    return {
      ok: false,
      error: `O desconto (${input.amount}) é maior que o saldo em aberto (${emAberto}).`,
    };
  if (input.type === "WRITE_OFF" && input.amount > emAberto)
    return {
      ok: false,
      error: `A baixa (${input.amount}) é maior que o saldo em aberto (${emAberto}).`,
    };

  const workspaceId = await currentWorkspaceId();
  const { post } = await import("@/lib/accounting/engine");

  return prisma.$transaction(async (tx) => {
    const ajuste = await tx.billingAdjustment.create({
      data: {
        billingId: b.id,
        type: input.type,
        amount: input.amount,
        originalAmount: original,
        resultingAmount: novo,
        reason: motivo,
        requestedBy: input.requestedBy ?? null,
      },
      select: { id: true },
    });

    if (novo !== original) {
      // O status é recalculado: um desconto que zera o saldo QUITA a
      // cobrança. Deixar como PENDING mandaria a equipe cobrar de novo.
      const pago = n(b.paidTotal);
      const status =
        pago >= novo - 0.005 ? "PAID" : pago > 0 ? "PARTIAL" : b.status;
      await tx.billing.update({
        where: { id: b.id },
        data: { amount: novo, status: status as any },
      });
    }

    // WRITE-OFF reconhece PERDA e NÃO mexe na receita: a venda aconteceu,
    // o dinheiro é que não veio. Desconto é o contrário — ele reduz a
    // receita reconhecida, e por isso estorna parte do reconhecimento.
    if (input.type === "WRITE_OFF") {
      const r = await post(
        {
          eventType: "RECEIVABLE_WRITE_OFF",
          sourceType: "BillingAdjustment",
          sourceId: ajuste.id,
          competence: (b.competence ?? "") as Competence,
          amount: input.amount,
          context: { workspaceId, clientId: b.clientId },
        },
        tx as any
      );
      if (!r.ok) throw new Error(r.error);
    }

    return { ok: true as const, adjustmentId: ajuste.id, de: original, para: novo };
  });
}

/** Histórico de ajustes de uma cobrança, do mais recente. */
export async function ajustesDa(billingId: string) {
  return prisma.billingAdjustment.findMany({
    where: { billingId },
    orderBy: { effectiveAt: "desc" },
  });
}
