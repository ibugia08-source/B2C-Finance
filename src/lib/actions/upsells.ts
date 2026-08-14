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
    if (id) {
      const existing = await prisma.upsell.findUnique({ where: { id } });
      if (!existing) return { ok: false, error: "Oportunidade não encontrada." };
      await prisma.upsell.update({
        where: { id },
        data: {
          ...data,
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
    return { ok: true, id };
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
      const billing = await prisma.billing.findUnique({
        where: { id: existing.billingId },
        select: { id: true, status: true, paidTotal: true },
      });
      if (!billing || billing.status === "CANCELED") {
        billingId = null;
      } else if (n(billing.paidTotal) === 0) {
        await prisma.billing.update({
          where: { id: billing.id },
          data: {
            status: "CANCELED",
            canceledAt: new Date(),
            canceledBy: viewer.email,
            cancelReason: "Venda de upsell desfeita.",
          },
        });
        billingId = null;
      } else {
        warning =
          "A cobrança do upsell já tem pagamento registrado — ela foi mantida nos recebimentos.";
      }
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
  await requirePermission("upsell.excluir");
  try {
    await prisma.upsell.deleteMany({ where: { id } });
    revalidateCatalog();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir a oportunidade." };
  }
}
