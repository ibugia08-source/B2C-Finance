"use server";
import { prisma } from "@/lib/prisma";
import { revalidateCatalog, revalidateFinance, revalidateAgency } from "@/lib/revalidate";
import { z } from "zod";
import { UpsellStatus } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, clean, toNumber as n } from "@/lib/format";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import type { ActionResult } from "./clients";

const UpsellSchema = z.object({
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
});

// Serviços da oportunidade: [{ serviceId, unitPrice }] serializado no form.
const ServicesSchema = z.array(
  z.object({ serviceId: z.string().min(1), unitPrice: z.number().nonnegative() })
);

/**
 * Desfaz a cobrança de um upsell que deixa de ser venda (sair de WON ou ser
 * excluído). Sem pagamento → cancela (soft) e libera novo lançamento; com
 * pagamento → mantém e avisa (reverter dinheiro é gesto manual).
 * Único caminho para o quadro, o formulário e a exclusão (auditoria
 * 25/09/2026: o formulário e a exclusão deixavam a cobrança viva).
 */
async function desfazerCobrancaDoUpsell(
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

export async function saveUpsell(formData: FormData): Promise<ActionResult> {
  // Criar exige upsell.criar; editar registro existente exige upsell.editar
  // (os pontos de entrada de criação — ficha do cliente, header do Kanban —
  // gateiam por upsell.criar).
  const isEdit = Boolean(clean(formData.get("id")));
  const viewer = await requirePermission(isEdit ? "upsell.editar" : "upsell.criar");
  try {
    // Serviços associados (opcional) — cada um com seu valor.
    let services: z.infer<typeof ServicesSchema> = [];
    const servicesRaw = clean(formData.get("services"));
    if (servicesRaw) {
      try {
        services = ServicesSchema.parse(JSON.parse(servicesRaw));
      } catch {
        return { ok: false, error: "Serviços da oportunidade inválidos." };
      }
    }
    const servicesSum = services.reduce((s, it) => s + it.unitPrice, 0);

    const parsed = UpsellSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      clientId: String(formData.get("clientId") ?? ""),
      serviceId: clean(formData.get("serviceId")),
      offerId: clean(formData.get("offerId")),
      title: clean(formData.get("title")),
      value: parseBRL(String(formData.get("value") ?? "0")),
      responsible: clean(formData.get("responsible")),
      status: (clean(formData.get("status")) ?? "OPPORTUNITY") as UpsellStatus,
      expectedCloseAt: (() => {
        const raw = clean(formData.get("expectedCloseAt"));
        return raw == null ? null : parseDateBR(raw);
      })(),
      notes: clean(formData.get("notes")),
    });

    // Decidir o funil (vendido/recusado) exige a permissão própria — o
    // formulário de edição não pode contornar o gate do quadro, senão uma
    // venda entra sem a pergunta de lançamento e nunca vira cobrança
    // (auditoria 2026-08-13).
    const saindoDeVenda = parsed.id
      ? (await prisma.upsell.findUnique({ where: { id: parsed.id }, select: { status: true } }))?.status === "WON" &&
        parsed.status !== "WON"
      : false;
    if (saindoDeVenda && !can(viewer, "upsell.marcar_vendido"))
      return {
        ok: false,
        error:
          "Desfazer uma venda é decisão do funil — exige a permissão \"Marcar como vendido\".",
      };
    if (parsed.status === "WON" || parsed.status === "LOST") {
      const prev = parsed.id
        ? await prisma.upsell.findUnique({
            where: { id: parsed.id },
            select: { status: true },
          })
        : null;
      if (prev?.status !== parsed.status && !can(viewer, "upsell.marcar_vendido"))
        return {
          ok: false,
          error:
            "Marcar como vendido/recusado é decisão do funil — mova o card no quadro (exige a permissão \"Marcar como vendido\").",
        };
    }

    // Valor da oportunidade: informado, ou a soma dos serviços associados.
    const value = parsed.value > 0 ? parsed.value : servicesSum;
    if (!(value > 0))
      return { ok: false, error: "Informe o valor da oportunidade (ou dos serviços)." };

    // Cliente precisa pertencer ao dono atual (findFirst é escopado).
    const owned = await prisma.client.findFirst({
      where: { id: parsed.clientId },
      select: { id: true, salesOwner: true },
    });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    // Serviços precisam existir no catálogo do dono.
    if (services.length > 0) {
      const found = await prisma.service.count({
        where: { id: { in: services.map((s) => s.serviceId) } },
      });
      if (found !== services.length)
        return { ok: false, error: "Serviço não encontrado no catálogo." };
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
      closedAt:
        parsed.status === "WON" || parsed.status === "LOST" ? new Date() : null,
    };

    let id = parsed.id;
    let aviso: string | undefined;
    if (id) {
      const existing = await prisma.upsell.findUnique({ where: { id } });
      if (!existing) return { ok: false, error: "Oportunidade não encontrada." };
      let billingId = existing.billingId;
      if (existing.status === "WON" && parsed.status !== "WON") {
        const r = await desfazerCobrancaDoUpsell(existing.billingId, viewer.email);
        billingId = r.billingId;
        aviso = r.warning;
      } else if (existing.status === "WON" && existing.billingId && n(existing.value) !== value) {
        // Venda com valor corrigido: a cobrança ainda sem pagamento acompanha.
        const b = await prisma.billing.findFirst({
          where: { id: existing.billingId },
          select: { id: true, status: true, paidTotal: true },
        });
        if (b && b.status !== "CANCELED" && n(b.paidTotal) === 0) {
          await prisma.billing.update({ where: { id: b.id }, data: { amount: value } });
        } else if (b && n(b.paidTotal) > 0) {
          aviso = "A cobrança do upsell já tem pagamento — o valor dela não foi alterado.";
        }
      }
      await prisma.upsell.update({
        where: { id },
        data: {
          ...data,
          billingId,
          // Preserva a data de fechamento original se já estava fechada.
          closedAt:
            parsed.status === "WON" || parsed.status === "LOST"
              ? existing.closedAt ?? new Date()
              : null,
        },
      });
    } else {
      const created = await prisma.upsell.create({ data });
      id = created.id;
    }

    // Sincroniza os serviços da oportunidade (replace simples).
    await prisma.upsellService.deleteMany({ where: { upsellId: id } });
    if (services.length > 0) {
      await prisma.upsellService.createMany({
        data: services.map((s) => ({
          upsellId: id!,
          serviceId: s.serviceId,
          unitPrice: s.unitPrice,
        })),
      });
    }

    revalidateCatalog();
    revalidateFinance();
    return { ok: true, id, ...(aviso ? { warning: aviso } : {}) };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar a oportunidade.";
    return { ok: false, error: msg };
  }
}

/**
 * Muda o status da oportunidade (movimentação do Kanban).
 * Ao marcar como VENDIDO (WON) com `launchBilling`, LANÇA a venda na lista
 * de recebimentos como cobrança real (Billing PENDING) na competência
 * escolhida — mês atual ou outro — onde ela segue o fluxo normal
 * (pagamento em 1 clique, inadimplência, métricas).
 */
export async function setUpsellStatus(
  id: string,
  status: string,
  opts?: { launchBilling?: boolean; month?: number; year?: number }
): Promise<ActionResult> {
  const viewer = await requirePermission("upsell.marcar_vendido");
  try {
    const s = z.nativeEnum(UpsellStatus).parse(status);
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
      const r = await desfazerCobrancaDoUpsell(existing.billingId, viewer.email);
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

    revalidateCatalog();
    revalidateFinance();
    revalidateAgency({ clientId: existing.clientId });
    return { ok: true, id: billingId ?? undefined, ...(warning ? { warning } : {}) };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar o status.";
    return { ok: false, error: msg };
  }
}

export async function deleteUpsell(id: string): Promise<ActionResult> {
  const viewer = await requirePermission("upsell.excluir");
  try {
    const existing = await prisma.upsell.findFirst({
      where: { id },
      select: { id: true, billingId: true, clientId: true },
    });
    if (!existing) return { ok: false, error: "Oportunidade não encontrada." };
    // Venda com cobrança: sem pagamento, a cobrança é cancelada junto; com
    // pagamento, a exclusão é recusada (o dinheiro precisa de estorno antes).
    if (existing.billingId) {
      const r = await desfazerCobrancaDoUpsell(existing.billingId, viewer.email);
      if (r.temPagamento)
        return {
          ok: false,
          error: "Esta venda já tem pagamento registrado. Estorne o pagamento antes de excluir.",
        };
    }
    await prisma.upsell.deleteMany({ where: { id } });
    revalidateFinance();
    revalidateAgency({ clientId: existing.clientId });
    revalidateCatalog();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir a oportunidade." };
  }
}
