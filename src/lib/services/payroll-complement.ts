import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";

/**
 * COMPLEMENTO DA FOLHA — lançamentos DEPOIS da folha paga.
 *
 * O fluxo real do dono: a folha (salários) é paga no início do mês; as
 * comissões da competência só fecham no mês SEGUINTE. A regra que preserva a
 * honestidade do dinheiro:
 *
 *  - a despesa criada quando a folha foi PAGA nunca muda de valor
 *    (dinheiro pago não é reescrito — mesma regra da Importação Total);
 *  - lançamento adicionado a uma folha paga entra como A PAGAR
 *    (settledAt nulo) e NÃO altera o que já foi pago;
 *  - "Pagar complemento" cria uma NOVA despesa PAYROLL na data do
 *    pagamento (o caixa sai no mês em que sai de verdade) e carimba os
 *    itens cobertos;
 *  - remover item só enquanto ele não foi coberto por pagamento — depois
 *    disso, a correção é um Desconto lançado como complemento.
 */

const rotuloDaFolha = (month: number, year: number) =>
  `${String(month).padStart(2, "0")}/${year}`;

export type ResultadoComplemento =
  | { ok: true; total: number; itens: number; transactionId: string }
  | { ok: false; error: string };

export async function pagarComplementoDaFolha(
  runId: string
): Promise<ResultadoComplemento> {
  const run = await prisma.payroll.findUnique({
    where: { id: runId },
    include: { items: true },
  });
  if (!run) return { ok: false, error: "Folha não encontrada." };
  if (run.status !== "PAID")
    return {
      ok: false,
      error:
        "O complemento é para folha JÁ PAGA. Antes disso, marque a folha como paga — o pagamento normal cobre todos os itens.",
    };

  const pendentes = run.items.filter((i) => i.settledAt == null);
  if (pendentes.length === 0)
    return { ok: false, error: "Nenhum lançamento a pagar nesta folha." };

  const total = pendentes.reduce(
    (s, i) => s + n(i.amount) * (i.kind === "DEDUCTION" ? -1 : 1),
    0
  );
  if (total <= 0)
    return {
      ok: false,
      error:
        "O complemento precisa ser positivo — só descontos não geram pagamento. Confira os lançamentos a pagar.",
    };

  const paidAt = new Date();
  const [tx] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        date: paidAt,
        description: `Complemento da folha ${rotuloDaFolha(run.month, run.year)} — lançamentos pós-pagamento`,
        amount: total,
        type: "despesa",
        origin: "pix",
        status: "pago",
        belongsTo: "empresa",
        expenseType: "PAYROLL",
        hash: null,
      },
      select: { id: true },
    }),
    prisma.payrollItem.updateMany({
      where: { id: { in: pendentes.map((i) => i.id) } },
      data: { settledAt: paidAt },
    }),
    // Comissões da competência que entraram na folha (APPROVED) ficam
    // quitadas junto — mesmo comportamento do pagamento original.
    prisma.commission.updateMany({
      where: { month: run.month, year: run.year, status: "APPROVED" },
      data: { status: "PAID", paidAt },
    }),
  ]);

  return { ok: true, total, itens: pendentes.length, transactionId: tx.id };
}

/** Regra única de remoção de item: dinheiro pago não é reescrito. */
export function podeRemoverItem(
  runStatus: string,
  item: { settledAt: Date | null }
): { ok: true } | { ok: false; error: string } {
  if (runStatus === "PAID" && item.settledAt != null)
    return {
      ok: false,
      error:
        "Este item já foi coberto por um pagamento — dinheiro pago não é reescrito. Para corrigir, lance um Desconto como complemento.",
    };
  return { ok: true };
}

/**
 * Traz as comissões PENDENTES da competência para dentro da folha (vira item
 * COMMISSION; a comissão passa a APPROVED — a transição garante que nunca
 * entra duas vezes). Funciona também com a folha PAGA: o item nasce sem
 * carimbo, ou seja, complemento a pagar.
 */
export async function incorporarComissoesPendentes(run: {
  id: string;
  month: number;
  year: number;
}): Promise<number> {
  const pending = await prisma.commission.findMany({
    where: { month: run.month, year: run.year, status: "PENDING" },
    include: { client: { select: { name: true } } },
  });
  if (pending.length === 0) return 0;
  await prisma.$transaction([
    prisma.payrollItem.createMany({
      data: pending.map((c) => ({
        payrollId: run.id,
        employeeId: c.employeeId,
        kind: "COMMISSION" as const,
        amount: c.amount,
        notes: [c.client?.name ? `Comissão — ${c.client.name}` : "Comissão", c.notes]
          .filter(Boolean)
          .join(" · "),
      })),
    }),
    prisma.commission.updateMany({
      where: { id: { in: pending.map((c) => c.id) } },
      data: { status: "APPROVED" },
    }),
  ]);
  return pending.length;
}
