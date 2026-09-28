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

// ---------------------------------------------------------------------------
// Cadastro / edição da oportunidade (extraído de actions/upsells.ts
// saveUpsell em 28/09/2026, sem mudança de regra — a API usa a mesma função)
// ---------------------------------------------------------------------------

export const UpsellInputSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1, "Selecione o cliente."),
  serviceId: z.string().nullable(),
  offerId: z.string().nullable(),
  title: z.string().trim().nullable(),
  value: z.number().nonnegative(),
  responsible: z.string().trim().nullable(),
  status: z.nativeEnum(UpsellStatus).default("OPPORTUNITY"),
  expectedCloseAt: z.date().nullable(),
  notes: z.string().trim().nullable(),
  /** Serviços da oportunidade, cada um com seu valor. */
  services: z
    .array(z.object({ serviceId: z.string().min(1), unitPrice: z.number().nonnegative() }))
    .default([]),
});
export type UpsellInput = z.input<typeof UpsellInputSchema>;

/**
 * Cria (sem `id`) ou edita a oportunidade. Decidir o funil (WON/LOST, ou
 * sair de WON) exige `upsell.marcar_vendido` — pelo principal do contexto.
 * A oportunidade e os serviços dela são gravados na MESMA transação.
 */
export async function salvarUpsell(
  ctx: DomainContext,
  input: UpsellInput
): Promise<DomainResult> {
  const parsed = UpsellInputSchema.parse(input);
  const { domainCan } = await import("@/lib/engines/domain");
  return inDomain(ctx, async () => {
    const services = parsed.services;
    const servicesSum = services.reduce((s, it) => s + it.unitPrice, 0);
    const podeDecidir = domainCan(ctx, "upsell.marcar_vendido");

    const anterior = parsed.id
      ? await prisma.upsell.findFirst({ where: { id: parsed.id } })
      : null;
    if (parsed.id && !anterior) return { ok: false, error: "Oportunidade não encontrada." };

    // Decidir o funil (vendido/recusado) exige a permissão própria — o
    // formulário de edição não pode contornar o gate do quadro, senão uma
    // venda entra sem a pergunta de lançamento e nunca vira cobrança
    // (auditoria 2026-08-13).
    if (anterior?.status === "WON" && parsed.status !== "WON" && !podeDecidir)
      return {
        ok: false,
        error: "Desfazer uma venda é decisão do funil — exige a permissão \"Marcar como vendido\".",
      };
    if ((parsed.status === "WON" || parsed.status === "LOST") && anterior?.status !== parsed.status && !podeDecidir)
      return {
        ok: false,
        error:
          "Marcar como vendido/recusado é decisão do funil — mova o card no quadro (exige a permissão \"Marcar como vendido\").",
      };

    // Valor da oportunidade: informado, ou a soma dos serviços associados.
    const value = parsed.value > 0 ? parsed.value : servicesSum;
    if (!(value > 0)) return { ok: false, error: "Informe o valor da oportunidade (ou dos serviços)." };

    // Cliente precisa pertencer ao dono atual (findFirst é escopado).
    const owned = await prisma.client.findFirst({
      where: { id: parsed.clientId },
      select: { id: true, salesOwner: true },
    });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    // Serviços precisam existir no catálogo do dono.
    const idsServicos = [...new Set([...services.map((s) => s.serviceId), ...(parsed.serviceId ? [parsed.serviceId] : [])])];
    if (idsServicos.length > 0) {
      const found = await prisma.service.count({ where: { id: { in: idsServicos } } });
      if (found !== idsServicos.length) return { ok: false, error: "Serviço não encontrado no catálogo." };
    }

    const data = {
      clientId: parsed.clientId,
      // serviceId legado continua aceito (compatibilidade); a associação
      // principal agora é a lista services (N:N com valor).
      serviceId: parsed.serviceId ?? services[0]?.serviceId ?? null,
      offerId: parsed.offerId,
      title: parsed.title,
      value,
      // Sem responsável informado → herda o responsável do cliente.
      responsible: parsed.responsible ?? owned.salesOwner,
      status: parsed.status,
      expectedCloseAt: parsed.expectedCloseAt,
      notes: parsed.notes,
      closedAt: parsed.status === "WON" || parsed.status === "LOST" ? new Date() : null,
    };

    let aviso: string | undefined;
    let billingId = anterior?.billingId ?? null;
    if (anterior) {
      if (anterior.status === "WON" && parsed.status !== "WON") {
        const r = await desfazerCobrancaDoUpsell(anterior.billingId, domainActor(ctx).email);
        billingId = r.billingId;
        aviso = r.warning;
      } else if (anterior.status === "WON" && anterior.billingId && n(anterior.value) !== value) {
        // Venda com valor corrigido: a cobrança ainda sem pagamento acompanha.
        const b = await prisma.billing.findFirst({
          where: { id: anterior.billingId },
          select: { id: true, status: true, paidTotal: true },
        });
        if (b && b.status !== "CANCELED" && n(b.paidTotal) === 0) {
          await prisma.billing.update({ where: { id: b.id }, data: { amount: value } });
        } else if (b && n(b.paidTotal) > 0) {
          aviso = "A cobrança do upsell já tem pagamento — o valor dela não foi alterado.";
        }
      }
    }

    const id = await prisma.$transaction(async (tx) => {
      let upsellId: string;
      if (anterior) {
        await tx.upsell.update({
          where: { id: anterior.id },
          data: {
            ...data,
            billingId,
            // Preserva a data de fechamento original se já estava fechada.
            closedAt:
              parsed.status === "WON" || parsed.status === "LOST" ? anterior.closedAt ?? new Date() : null,
          },
        });
        upsellId = anterior.id;
      } else {
        upsellId = (await tx.upsell.create({ data, select: { id: true } })).id;
      }
      // Sincroniza os serviços da oportunidade (replace simples).
      await tx.upsellService.deleteMany({ where: { upsellId } });
      if (services.length > 0) {
        await tx.upsellService.createMany({
          data: services.map((s) => ({ upsellId, serviceId: s.serviceId, unitPrice: s.unitPrice })),
        });
      }
      return upsellId;
    });
    return { ok: true, id, ...(aviso ? { warning: aviso } : {}) };
  });
}
