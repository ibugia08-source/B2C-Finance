import { prisma } from "@/lib/prisma";
import { MONEY_EPSILON } from "@/lib/billing-status";
import { toNumber as n } from "@/lib/format";

/**
 * CRÉDITO DO CLIENTE (F1.8 · ref. 01 §3.12; 02 §1).
 *
 * "Marca Pago com valor maior que o devido → aplica até o saldo e cria
 * crédito; toast: 'R$ X ficaram como crédito para a próxima cobrança'."
 *
 * COMO O CRÉDITO É GASTO — e por que não se cria pagamento novo:
 * o dinheiro já entrou uma vez, no pagamento que gerou o excedente. Criar
 * um Payment ao usar o crédito contaria o mesmo dinheiro duas vezes no
 * caixa. Então usar crédito é APLICAR o pagamento original na cobrança
 * nova: nasce uma PaymentApplication apontando para aquele pagamento, e o
 * paidTotal da cobrança nova se deriva dela como qualquer outro.
 *
 * O saldo, portanto, tem uma definição exata e conferível:
 *     crédito = Σ pagamentos do cliente − Σ aplicações desses pagamentos
 * A coluna CustomerCredit.balance é o cache dessa conta, e
 * `reconcileCredit` prova que as duas batem.
 */

export type CreditApplication = { billingId: string; amount: number };

/** Pagamentos do cliente com dinheiro ainda não aplicado, mais antigos primeiro. */
async function unappliedPayments(clientId: string) {
  const pagamentos = await prisma.payment.findMany({
    where: { status: { notIn: ["FAILED", "REFUNDED"] }, billing: { clientId } },
    select: {
      id: true,
      amount: true,
      paidAt: true,
      applications: { select: { amount: true } },
    },
    orderBy: { paidAt: "asc" },
  });
  return pagamentos
    .map((p) => ({
      id: p.id,
      paidAt: p.paidAt,
      sobra: n(p.amount) - p.applications.reduce((s, a) => s + n(a.amount), 0),
    }))
    .filter((p) => p.sobra > MONEY_EPSILON);
}

/** Saldo real, calculado das aplicações (não do cache). */
export async function creditBalance(clientId: string): Promise<number> {
  const sobras = await unappliedPayments(clientId);
  return sobras.reduce((s, p) => s + p.sobra, 0);
}

/**
 * Usa o crédito do cliente para abater uma cobrança.
 *
 * Consome os pagamentos com sobra do mais ANTIGO para o mais novo: crédito
 * parado há mais tempo sai primeiro, que é o que qualquer cliente espera
 * ao perguntar "e aquele valor que sobrou em março?".
 */
export async function applyCredit(input: {
  billingId: string;
  /** Quanto usar. Omitido = o que couber na cobrança. */
  amount?: number;
}): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const billing = await prisma.billing.findUnique({
    where: { id: input.billingId },
    select: {
      id: true, clientId: true, amount: true, paidTotal: true,
      status: true, dueDate: true, relationshipId: true, description: true,
    },
  });
  if (!billing) return { ok: false, error: "Cobrança não encontrada." };
  if (billing.status === "CANCELED")
    return { ok: false, error: "Cobrança cancelada não recebe crédito." };

  const emAberto = Math.max(0, n(billing.amount) - n(billing.paidTotal));
  if (emAberto <= MONEY_EPSILON)
    return { ok: false, error: "Esta cobrança já está quitada." };

  const sobras = await unappliedPayments(billing.clientId);
  const disponivel = sobras.reduce((s, p) => s + p.sobra, 0);
  if (disponivel <= MONEY_EPSILON)
    return { ok: false, error: "Este cliente não tem crédito disponível." };

  const alvo = Math.min(input.amount ?? emAberto, emAberto, disponivel);
  if (alvo <= MONEY_EPSILON) return { ok: false, error: "Nada a aplicar." };

  return prisma.$transaction(async (tx) => {
    let restante = alvo;
    for (const p of sobras) {
      if (restante <= MONEY_EPSILON) break;
      const usar = Math.min(p.sobra, restante);

      // O mesmo pagamento pode já ter uma aplicação nesta cobrança (parcial
      // anterior): a unique é (pagamento, cobrança), então somamos em vez
      // de inserir uma segunda linha.
      const existente = await tx.paymentApplication.findFirst({
        where: { paymentId: p.id, billingId: billing.id },
        select: { id: true, amount: true },
      });
      if (existente) {
        await tx.paymentApplication.update({
          where: { id: existente.id },
          data: { amount: n(existente.amount) + usar },
        });
      } else {
        await tx.paymentApplication.create({
          data: { paymentId: p.id, billingId: billing.id, amount: usar },
        });
      }
      restante -= usar;
    }

    const soma = await tx.paymentApplication.aggregate({
      where: { billingId: billing.id },
      _sum: { amount: true },
    });
    const novoPago = n(soma._sum.amount);
    const quitada = novoPago >= n(billing.amount) - MONEY_EPSILON;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    await tx.billing.update({
      where: { id: billing.id },
      data: {
        paidTotal: novoPago,
        status: quitada ? "PAID" : novoPago > MONEY_EPSILON ? "PARTIAL"
          : billing.dueDate < hoje ? "OVERDUE" : "PENDING",
        paidAt: quitada ? new Date() : null,
        collectionStatus: quitada ? "PAID" : undefined,
      },
    });

    // Movimento de SAÍDA do crédito, com destino — saldo sem história é
    // reclamação garantida.
    const credito = await tx.customerCredit.findFirst({
      where: { clientId: billing.clientId, relationshipId: billing.relationshipId },
      select: { id: true },
    });
    if (credito) {
      await tx.customerCredit.update({
        where: { id: credito.id },
        data: { balance: { decrement: alvo } },
      });
      await tx.customerCreditMovement.create({
        data: {
          creditId: credito.id,
          kind: "OUT",
          amount: alvo,
          targetBillingId: billing.id,
          reason: `Crédito aplicado em ${billing.description}`,
        },
      });
    }

    return { ok: true as const, applied: alvo };
  });
}

/** Confere o cache contra a conta real. Usado em teste e em conferência. */
export async function reconcileCredit(clientId: string) {
  const real = await creditBalance(clientId);
  const linhas = await prisma.customerCredit.findMany({
    where: { clientId },
    select: { balance: true },
  });
  const cache = linhas.reduce((s, c) => s + n(c.balance), 0);
  return { real, cache, bate: Math.abs(real - cache) <= 0.01 };
}
