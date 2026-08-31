import { prisma } from "@/lib/prisma";
import { toCompetence } from "@/lib/competence";
import { auditEvent, auditUpdate } from "@/lib/audit";
import { post } from "@/lib/accounting/engine";
import { publish } from "@/lib/outbox";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { toNumber as n } from "@/lib/format";
import { randomUUID } from "crypto";
import { splitTcv } from "@/lib/services/tcv-installments";
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

/**
 * Gera as N cobranças de uma venda TCV parcelada (F1.7 · ref. 01 §3.7).
 *
 * Todas nascem no MESMO installmentGroup e numeradas — é isso que permite
 * responder "esta é a 2 de 6" na tela e, mais tarde, cancelar ou
 * renegociar o grupo inteiro sem caçar linha por linha.
 *
 * TCV VENDIDO x TCV FATURADO: o valor integral pertence ao mês da VENDA
 * (métrica tcv_vendido); cada parcela pertence à sua competência (métrica
 * tcv_faturado). São números diferentes de propósito, e confundi-los é o
 * erro que faz o mês da venda parecer três vezes maior do que foi.
 */
export async function generateTcvInstallments(input: {
  clientId: string;
  contractId?: string | null;
  serviceId?: string | null;
  description: string;
  total: number;
  installments: number;
  firstDueDate: Date;
  firstCompetence: { year: number; month: number };
  reason?: string | null;
}): Promise<EngineResult<{ groupId: string; parcelas: { id: string; numero: number; amount: number }[] }>> {
  const perm = await guardPermission("recebimentos.gerar_cobranca");
  if (!perm.ok) return perm;

  let parcelas;
  try {
    parcelas = splitTcv(input.total, input.installments, input.firstDueDate, input.firstCompetence);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Parcelamento inválido." };
  }

  // A guarda de período vale para a competência de CADA parcela: uma venda
  // parcelada pode alcançar um mês já fechado.
  for (const p of parcelas) {
    const g = await guardPeriod("REVENUE_RECOGNIZED", toCompetence(p.competenceYear, p.competenceMonth));
    if (!g.ok) return g;
  }

  const ctx = await contextFromRequest({ reason: input.reason });
  const groupId = randomUUID();

  const criadas = await prisma.$transaction(async (tx) => {
    const out: { id: string; numero: number; amount: number }[] = [];
    for (const p of parcelas) {
      const b = await tx.billing.create({
        data: {
          clientId: input.clientId,
          contractId: input.contractId ?? null,
          serviceId: input.serviceId ?? null,
          description: `${input.description} (${p.numero}/${input.installments})`,
          competenceMonth: p.competenceMonth,
          competenceYear: p.competenceYear,
          amount: p.amount,
          dueDate: p.dueDate,
          revenueType: "TCV",
          billingKind: "TCV",
          recognitionMode: "REVENUE",
          installmentGroupId: groupId,
          installmentNumber: p.numero,
        },
        select: { id: true },
      });
      await auditEvent(tx as any, "Billing", b.id, "CREATE", ctx);
      out.push({ id: b.id, numero: p.numero, amount: p.amount });
    }
    return out;
  });

  return { ok: true, groupId, parcelas: criadas };
}
