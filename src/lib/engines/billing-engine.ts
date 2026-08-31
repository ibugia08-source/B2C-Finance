import { prisma } from "@/lib/prisma";
import { toCompetence } from "@/lib/competence";
import { auditEvent, auditUpdate } from "@/lib/audit";
import { post } from "@/lib/accounting/engine";
import { publish } from "@/lib/outbox";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { toNumber as n } from "@/lib/format";
import { contextFromRequest } from "./context";
import { guardPeriod, guardPermission } from "./guards";
import type { EngineResult } from "./payment-engine";

/**
 * BillingEngine (F1.5 · ref. 03 §4.1).
 *
 * Ciclo de vida da cobrança: reconhecer no razão, cancelar e recolocar.
 *
 * A GERAÇÃO em si (quem tem cobrança neste mês, com que valor e que
 * vencimento) continua em services/receivables-cycle: é lógica de
 * calendário e carteira, coberta pela suíte da F0.2, e trazer para cá só
 * mudaria o endereço. O que o motor acrescenta é o que faltava — razão,
 * trilha e aviso — nos pontos em que a cobrança muda de estado.
 *
 * RECONHECIMENTO x LIQUIDAÇÃO: cobrança com recognitionMode
 * SETTLEMENT_ONLY (renegociação, 01 §3.13) NÃO é reconhecida como receita
 * — a receita já entrou quando a dívida original nasceu. Reconhecer de
 * novo dobraria o faturamento, que é exatamente o erro que o campo existe
 * para evitar.
 */

export async function recognizeBilling(
  billingId: string,
  opts: { reason?: string | null } = {}
): Promise<EngineResult<{ posted: boolean; skipped?: "settlement_only" }>> {
  const cob = await prisma.billing.findUnique({
    where: { id: billingId },
    select: {
      id: true, amount: true, competenceYear: true, competenceMonth: true,
      recognitionMode: true, clientId: true, serviceId: true, ownerId: true,
      relationship: { select: { agencyId: true } },
    },
  });
  if (!cob) return { ok: false, error: "Cobrança não encontrada." };

  if (cob.recognitionMode === "SETTLEMENT_ONLY")
    return { ok: true, posted: false, skipped: "settlement_only" };

  const competencia = toCompetence(cob.competenceYear, cob.competenceMonth);
  const periodo = await guardPeriod("REVENUE_RECOGNIZED", competencia);
  if (!periodo.ok) return periodo;

  const ctx = await contextFromRequest({ reason: opts.reason });
  const workspaceId = await currentWorkspaceId();

  const r = await prisma.$transaction(async (tx) => {
    const contabil = await post(
      {
        eventType: "REVENUE_RECOGNIZED",
        sourceType: "Billing",
        sourceId: cob.id,
        competence: competencia,
        amount: n(cob.amount),
        context: {
          workspaceId,
          ownerId: cob.ownerId,
          clientId: cob.clientId,
          serviceId: cob.serviceId,
          agencyId: cob.relationship?.agencyId ?? null,
        },
      },
      tx as any
    );
    if (!contabil.ok) throw new Error(contabil.error);
    await auditEvent(tx as any, "Billing", cob.id, "CREATE", ctx);
    return contabil;
  });

  return { ok: true, posted: r.posted };
}

/** Remove a cobrança do mês. 01 §4.10: exige motivo. */
export async function cancelBilling(
  billingId: string,
  reason: string
): Promise<EngineResult<{ clientId: string }>> {
  const perm = await guardPermission("recebimentos.editar");
  if (!perm.ok) return perm;
  if (!reason?.trim()) return { ok: false, error: "Informe o motivo da remoção." };

  const cob = await prisma.billing.findUnique({
    where: { id: billingId },
    select: {
      id: true, status: true, clientId: true, paidTotal: true,
      competenceYear: true, competenceMonth: true,
    },
  });
  if (!cob) return { ok: false, error: "Cobrança não encontrada." };
  if (n(cob.paidTotal) > 0)
    return {
      ok: false,
      error: "Esta cobrança tem pagamento registrado. Estorne o pagamento antes de removê-la.",
    };

  const periodo = await guardPeriod(
    "REVENUE_RECOGNIZED",
    toCompetence(cob.competenceYear, cob.competenceMonth)
  );
  if (!periodo.ok) return periodo;

  const ctx = await contextFromRequest({ reason });
  const workspaceId = await currentWorkspaceId();

  await prisma.$transaction(async (tx) => {
    await tx.billing.update({
      where: { id: cob.id },
      data: { status: "CANCELED", canceledAt: new Date(), cancelReason: reason },
    });
    await auditUpdate(
      tx as any, "Billing", cob.id,
      { status: cob.status },
      { status: "CANCELED" },
      ctx
    );
    await publish(tx as any, {
      workspaceId,
      eventType: "cobranca.removida",
      channel: "crm",
      sourceType: "Billing",
      sourceId: cob.id,
      payload: { clientId: cob.clientId, reason },
    });
  });

  return { ok: true, clientId: cob.clientId };
}
