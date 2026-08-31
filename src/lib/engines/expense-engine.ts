import { prisma } from "@/lib/prisma";
import { competenceOf } from "@/lib/competence";
import { auditEvent, auditUpdate } from "@/lib/audit";
import { post } from "@/lib/accounting/engine";
import { publish } from "@/lib/outbox";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { toNumber as n } from "@/lib/format";
import { contextFromRequest } from "./context";
import { guardPeriod, guardPermission } from "./guards";
import type { EngineResult } from "./payment-engine";

/**
 * ExpenseEngine (F1.5 · ref. 03 §4.1).
 *
 * Mesmo pipeline do PaymentEngine, do lado das saídas.
 *
 * LIMITE DECLARADO: marcar uma despesa a prazo como PAGA deveria postar
 * PAYABLE_SETTLED no razão. Esse evento está na matriz de 01 §3.10 mas
 * ainda NÃO é implementado pelo motor contábil (a F0.8 implementou cinco
 * eventos; o resto é F3.1). O motor contábil RECUSA evento não
 * implementado em vez de improvisar um lançamento — que é o
 * comportamento certo —, então aqui a liquidação gera trilha e aviso, mas
 * não lançamento. Quando a F3.1 implementar o evento, basta trocar a
 * constante abaixo: o ponto de chamada já existe.
 */

const STATUS_PAGO = "pago";

export type SetStatusOptions = { reason?: string | null };

export async function setExpenseStatus(
  id: string,
  status: string,
  opts: SetStatusOptions = {}
): Promise<EngineResult<{}>> {
  const perm = await guardPermission("despesas.marcar_como_paga");
  if (!perm.ok) return perm;

  const despesa = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, date: true, status: true, amount: true, description: true, ownerId: true },
  });
  if (!despesa) return { ok: false, error: "Despesa não encontrada." };
  if (despesa.status === status) return { ok: true };

  const competencia = competenceOf(despesa.date);
  const periodo = await guardPeriod("EXPENSE_PAID_CASH", competencia);
  if (!periodo.ok) return periodo;

  const ctx = await contextFromRequest({ reason: opts.reason });
  const workspaceId = await currentWorkspaceId();

  await prisma.$transaction(async (tx) => {
    await tx.transaction.updateMany({ where: { id }, data: { status } });

    await auditUpdate(
      tx as any, "Transaction", id,
      { status: despesa.status },
      { status },
      ctx
    );

    if (status === STATUS_PAGO) {
      await publish(tx as any, {
        workspaceId,
        eventType: "despesa.paga",
        channel: "webhook",
        sourceType: "Transaction",
        sourceId: id,
        payload: { amount: n(despesa.amount), competence: competencia },
      });
    }
  });

  return { ok: true };
}

/**
 * Reconhece uma despesa recém-criada no razão.
 *
 * À vista (já paga) e a prazo são eventos DIFERENTES na matriz: o primeiro
 * mexe em caixa na hora, o segundo cria um passivo. Tratar os dois como
 * um só faria a DRE bater e o caixa não.
 */
export async function recognizeExpense(
  transactionId: string,
  opts: { alreadyPaid: boolean; reason?: string | null } = { alreadyPaid: false }
): Promise<EngineResult<{ posted: boolean }>> {
  const despesa = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, date: true, amount: true, ownerId: true, categoryId: true },
  });
  if (!despesa) return { ok: false, error: "Despesa não encontrada." };

  const competencia = competenceOf(despesa.date);
  const periodo = await guardPeriod("EXPENSE_RECOGNIZED_ON_CREDIT", competencia);
  if (!periodo.ok) return periodo;

  const ctx = await contextFromRequest({ reason: opts.reason });
  const workspaceId = await currentWorkspaceId();

  const r = await prisma.$transaction(async (tx) => {
    const contabil = await post(
      {
        eventType: opts.alreadyPaid ? "EXPENSE_PAID_CASH" : "EXPENSE_RECOGNIZED_ON_CREDIT",
        sourceType: "Transaction",
        sourceId: despesa.id,
        competence: competencia,
        amount: n(despesa.amount),
        postedAt: despesa.date,
        context: { workspaceId, ownerId: despesa.ownerId },
      },
      tx as any
    );
    if (!contabil.ok) throw new Error(contabil.error);
    await auditEvent(tx as any, "Transaction", despesa.id, "CREATE", ctx);
    return contabil;
  });

  return { ok: true, posted: r.posted };
}
