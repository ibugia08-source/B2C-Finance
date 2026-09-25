import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { hojeCivilParaGravar } from "@/lib/civil-date";

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

/** Outro pagamento do complemento carimbou os itens antes — aborta a transação. */
class ComplementoConcorrente extends Error {}

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
  const ids = pendentes.map((i) => i.id);
  // IDEMPOTENTE (auditoria 25/09/2026): duplo clique rodava duas vezes e
  // criava DUAS despesas PAYROLL. Agora o carimbo vem PRIMEIRO, condicional
  // (settledAt nulo), dentro da transação: a segunda chamada carimba menos
  // itens do que leu e aborta sem criar despesa.
  const tx = await prisma
    .$transaction(async (t) => {
      // runWithoutScope só no updateMany: a extensão injeta ownerId no where e
      // item legado sem dono nunca casaria. A posse já foi validada no
      // findUnique (escopado) da folha acima.
      const carimbo = await runWithoutScope(async () =>
        t.payrollItem.updateMany({
          where: { id: { in: ids }, payrollId: run.id, settledAt: null },
          data: { settledAt: paidAt },
        })
      );
      if (carimbo.count !== ids.length) throw new ComplementoConcorrente();
      const criada = await t.transaction.create({
        data: {
          // Data CIVIL do pagamento (dia da Bahia) — a competência da despesa
          // é lida pelo dia UTC; o instante "agora" depois das 21h caía no dia
          // (e às vezes no mês) seguinte.
          date: hojeCivilParaGravar(paidAt),
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
      });
      // Comissões da competência que entraram na folha (APPROVED) ficam
      // quitadas junto — mesmo comportamento do pagamento original.
      await t.commission.updateMany({
        where: { month: run.month, year: run.year, status: "APPROVED" },
        data: { status: "PAID", paidAt },
      });
      return criada;
    })
    .catch((e) => {
      if (e instanceof ComplementoConcorrente) return null;
      throw e;
    });
  if (!tx)
    return {
      ok: false,
      error: "Este complemento já foi pago (pagamento registrado ao mesmo tempo). Atualize a tela.",
    };

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
