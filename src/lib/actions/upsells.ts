"use server";
import { prisma } from "@/lib/prisma";
import { revalidateCatalog, revalidateFinance, revalidateAgency } from "@/lib/revalidate";
import { z } from "zod";
import { UpsellStatus } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, clean, toNumber as n } from "@/lib/format";
import type { ActionResult } from "./clients";
import { alterarStatusDoUpsell, excluirUpsell, salvarUpsell } from "@/lib/services/upsell-service";
import { domainContextFor } from "@/lib/auth/domain-session";

// Serviços da oportunidade: [{ serviceId, unitPrice }] serializado no form.
const ServicesSchema = z.array(
  z.object({ serviceId: z.string().min(1), unitPrice: z.number().nonnegative() })
);

export async function saveUpsell(formData: FormData): Promise<ActionResult> {
  // Criar exige upsell.criar; editar registro existente exige upsell.editar
  // (os pontos de entrada de criação — ficha do cliente, header do Kanban —
  // gateiam por upsell.criar). A REGRA mora em services/upsell-service
  // (salvarUpsell), a mesma que a API usa.
  const isEdit = Boolean(clean(formData.get("id")));
  const viewer = await requirePermission(isEdit ? "upsell.editar" : "upsell.criar");
  try {
    let services: z.infer<typeof ServicesSchema> = [];
    const servicesRaw = clean(formData.get("services"));
    if (servicesRaw) {
      try {
        services = ServicesSchema.parse(JSON.parse(servicesRaw));
      } catch {
        return { ok: false, error: "Serviços da oportunidade inválidos." };
      }
    }
    const r = await salvarUpsell(await domainContextFor(viewer), {
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
      services,
    });
    if (!r.ok) return r;
    revalidateCatalog();
    revalidateFinance();
    return { ok: true, id: r.id, ...(r.warning ? { warning: r.warning } : {}) };
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
    // Regra em services/upsell-service (a mesma da API).
    const r = await alterarStatusDoUpsell(await domainContextFor(viewer), { id, status, ...opts });
    if (!r.ok) return r;
    revalidateCatalog();
    revalidateFinance();
    revalidateAgency({ clientId: r.clientId });
    return { ok: true, id: r.id, ...(r.warning ? { warning: r.warning } : {}) };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar o status.";
    return { ok: false, error: msg };
  }
}

export async function deleteUpsell(id: string): Promise<ActionResult> {
  const viewer = await requirePermission("upsell.excluir");
  try {
    const r = await excluirUpsell(await domainContextFor(viewer), id);
    if (!r.ok) return r;
    revalidateFinance();
    revalidateAgency({ clientId: r.clientId });
    revalidateCatalog();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir a oportunidade." };
  }
}
