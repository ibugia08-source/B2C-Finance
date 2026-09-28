import { z } from "zod";
import { UpsellStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import { type DomainContext, type DomainResult, domainActor, inDomain } from "@/lib/engines/domain";

/**
 * UPSELL — regra de domínio (extraída de actions/upsells.ts em 27/09/2026,
 * sem mudança de comportamento): mover a oportunidade no funil, lançar a
 * venda ganha como cobrança (ONE_TIME, competência escolhida), desfazer a
 * cobrança quando a venda é desfeita/excluída. Permissão de quem chama
 * (upsell.marcar_vendido / upsell.excluir) continua na action; a futura API
 * confere o mesmo RBAC antes de chamar.
 * Não invalida cache: quem chama chama revalidateCatalog/Finance/Agency.
 */

/**
 * Desfaz a cobrança de um upsell que deixa de ser venda (sair de WON ou ser
 * excluído). Sem pagamento → cancela (soft) e libera novo lançamento; com
 * pagamento → mantém e avisa (reverter dinheiro é gesto manual).
 * Único caminho para o quadro, o formulário e a exclusão (auditoria
 * 25/09/2026: o formulário e a exclusão deixavam a cobrança viva).
 */
export async function desfazerCobrancaDoUpsell(
  billingIdAtual: string | null,
  porEmail: string | null
): Promise<{ billingId: string | null; warning?: string; temPagamento: boolean }> {
  if (!billingIdAtual) return { billingId: null, temPagamento: false };
  const billing = await prisma.billing.findFirst({
    where: { id: billingIdAtual },
    select: { id: true, status: true, paidTotal: true },
  });
  if (!billing || billing.status === "CANCELED") return { billingId: null, temPagamento: false };
  if (n(billing.paidTotal) === 0) {
    await prisma.billing.update({
      where: { id: billing.id },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        canceledBy: porEmail,
        cancelReason: "Venda de upsell desfeita.",
      },
    });
    return { billingId: null, temPagamento: false };
  }
  return {
    billingId: billing.id,
    temPagamento: true,
    warning: "A cobrança do upsell já tem pagamento registrado — ela foi mantida nos recebimentos.",
  };
}


export type AlterarStatusUpsellInput = {
  id: string;
  status: string;
  /** Ao marcar VENDIDO: lança a cobrança na competência (mês atual por padrão). */
  launchBilling?: boolean;
  month?: number;
  year?: number;
};

/** Move a oportunidade no funil; WON pode lançar a cobrança da venda. */
export async function alterarStatusDoUpsell(
  ctx: DomainContext,
  input: AlterarStatusUpsellInput
): Promise<DomainResult<{ clientId?: string; warning?: string }>> {
  return inDomain(ctx, async () => {
    const s = z.nativeEnum(UpsellStatus).parse(input.status);
    const opts = input;
    const id = input.id;
    const existing = await prisma.upsell.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, paymentDay: true } },
        services: { include: { service: { select: { name: true } } } },
      },
    });
    if (!existing) return { ok: false, error: "Oportunidade não encontrada." };

    const closing = s === "WON" || s === "LOST";
    let billingId = existing.billingId;
    let warning: string | undefined;

    // Desfazer a venda (sair de WON): a cobrança lançada não pode ficar viva
    // nos recebimentos. Sem pagamento → cancela (soft) e libera novo
    // lançamento; com pagamento → mantém e avisa (reverter dinheiro é manual).
    if (existing.status === "WON" && s !== "WON" && existing.billingId) {
      const r = await desfazerCobrancaDoUpsell(existing.billingId, domainActor(ctx).email);
      billingId = r.billingId;
      warning = r.warning;
    }

    if (s === "WON" && opts?.launchBilling && !billingId) {
      const now = new Date();
      const month =
        opts.month && opts.month >= 1 && opts.month <= 12
          ? opts.month
          : now.getMonth() + 1;
      const year =
        opts.year && opts.year >= 2000 && opts.year <= 2100
          ? opts.year
          : now.getFullYear();
      const due = getValidDueDateForMonth(
        year, month, existing.client.paymentDay ?? now.getDate()
      );
      const serviceNames = existing.services.map((us) => us.service.name).join(", ");
      const billing = await prisma.billing.create({
        data: {
          clientId: existing.clientId,
          serviceId: existing.serviceId,
          description: `Upsell — ${existing.title ?? (serviceNames || "venda interna")}`,
          competenceMonth: month,
          competenceYear: year,
          amount: n(existing.value),
          dueDate: due,
          revenueType: "ONE_TIME",
          status: "PENDING",
          notes: "Gerada pela venda de upsell.",
        },
        select: { id: true },
      });
      billingId = billing.id;
    }

    await prisma.upsell.update({
      where: { id },
      data: {
        status: s,
        closedAt: closing ? existing.closedAt ?? new Date() : null,
        billingId,
      },
    });
    return { ok: true, id: billingId ?? undefined, clientId: existing.clientId, ...(warning ? { warning } : {}) };
  });
}

/** Exclui a oportunidade (cancela a cobrança sem pagamento; recusa se houver pagamento). */
export async function excluirUpsell(
  ctx: DomainContext,
  id: string
): Promise<DomainResult<{ clientId?: string }>> {
  return inDomain(ctx, async () => {
    const existing = await prisma.upsell.findFirst({
      where: { id },
      select: { id: true, billingId: true, clientId: true },
    });
    if (!existing) return { ok: false, error: "Oportunidade não encontrada." };
    // Venda com cobrança: sem pagamento, a cobrança é cancelada junto; com
    // pagamento, a exclusão é recusada (o dinheiro precisa de estorno antes).
    if (existing.billingId) {
      const r = await desfazerCobrancaDoUpsell(existing.billingId, domainActor(ctx).email);
      if (r.temPagamento)
        return {
          ok: false,
          error: "Esta venda já tem pagamento registrado. Estorne o pagamento antes de excluir.",
        };
    }
    await prisma.upsell.deleteMany({ where: { id } });
    return { ok: true, clientId: existing.clientId };
  });
}
