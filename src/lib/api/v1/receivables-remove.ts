import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditUpdate } from "@/lib/audit";
import { toCompetence } from "@/lib/competence";
import { domainActor, inDomain, type DomainContext } from "@/lib/engines/domain";
import { assertPeriodAllows } from "@/lib/services/closing-period";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { publish } from "@/lib/outbox";
import { ApiError } from "../auth";
import { detalharRecebivelApi } from "./receivables";

/** Cancela somente a ocorrência identificada, preservando cliente, contrato e histórico. */
export const RemoveReceivableBody = z.object({
  reason: z.string().trim().min(3, "Informe o motivo da remoção.").max(500),
}).strict();

export async function removerCobrancaDoMesApi(
  ctx: DomainContext,
  billingId: string,
  body: z.output<typeof RemoveReceivableBody>
) {
  return inDomain(ctx, async () => {
    const b = await prisma.billing.findFirst({
      where: { id: billingId },
      select: {
        id: true, clientId: true, description: true, amount: true, paidTotal: true,
        status: true, competenceYear: true, competenceMonth: true, collectionStatus: true,
        payments: { where: { status: "CONFIRMED" }, select: { id: true }, take: 1 },
        applications: { select: { id: true }, take: 1 },
        client: { select: { name: true } },
      },
    });
    if (!b) throw new ApiError(404, "not_found", "Cobrança não encontrada.");
    if (b.status === "CANCELED") throw new ApiError(422, "invalid_state", "Esta cobrança já foi removida do mês.");
    if (b.status === "RENEGOTIATED") throw new ApiError(422, "invalid_state", "Cobrança renegociada não pode ser removida por esta ação.");
    if (b.status !== "PENDING" && b.status !== "OVERDUE") throw new ApiError(422, "invalid_state", "Somente cobranças em aberto e sem pagamento podem ser removidas.");
    if (Number(b.paidTotal) > 0 || b.payments.length || b.applications.length) {
      throw new ApiError(422, "invalid_state", "Esta cobrança tem pagamento registrado. Verifique o recebimento no B2C Finance antes de removê-la.");
    }
    const competence = toCompetence(b.competenceYear, b.competenceMonth);
    // Falha de leitura do fechamento também bloqueia a escrita (fail closed).
    const periodo = await assertPeriodAllows("REVENUE_RECOGNIZED", competence);
    if (!periodo.ok) throw new ApiError(422, "competence_closed", periodo.error);

    const actor = domainActor(ctx);
    const now = new Date();
    const workspaceId = await currentWorkspaceId();
    await prisma.$transaction(async (tx) => {
      // Reconfere status, valor recebido e vínculos de pagamentos no instante
      // da escrita para evitar remover uma cobrança que acabou de ser paga.
      const changed = await tx.billing.updateMany({
        where: {
          id: b.id, status: b.status, paidTotal: 0,
          payments: { none: { status: "CONFIRMED" } },
          applications: { none: {} },
        },
        data: { status: "CANCELED", canceledAt: now, canceledBy: actor.email, cancelReason: body.reason },
      });
      if (changed.count !== 1) throw new ApiError(409, "state_changed", "A cobrança mudou. Consulte novamente antes de confirmar.");
      await tx.collectionHistory.create({
        data: {
          billingId: b.id, clientId: b.clientId, status: b.collectionStatus,
          actionType: "REMOVED", createdBy: actor.email,
          message: `Removida do ciclo de ${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear}. Motivo: ${body.reason}`,
        },
      });
      await auditUpdate(tx, "Billing", b.id,
        { status: b.status, canceledAt: null, canceledBy: null, cancelReason: null },
        { status: "CANCELED", canceledAt: now, canceledBy: actor.email, cancelReason: body.reason },
        { origin: "API", reason: body.reason, actorId: actor.id, actorEmail: actor.email, correlationId: ctx.correlationId });
      await publish(tx as any, {
        workspaceId, eventType: "cobranca.removida", channel: "crm", sourceType: "Billing", sourceId: b.id,
        payload: { clientId: b.clientId, reason: body.reason },
      });
    });
    return {
      clientId: b.clientId,
      clientName: b.client.name,
      amount: Number(b.amount),
      data: await detalharRecebivelApi(b.id),
    };
  });
}
