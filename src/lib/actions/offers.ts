"use server";
import { prisma } from "@/lib/prisma";
import { revalidateCatalog } from "@/lib/revalidate";
import { z } from "zod";
import { OfferModality } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL, clean } from "@/lib/format";
import type { ActionResult } from "./clients";

/**
 * Ofertas (Planos): pacote comercial que junta serviços com um valor.
 * O preço vive AQUI — o Serviço é catálogo puro (sem valor).
 */

const OfferSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Informe o nome da oferta."),
  description: z.string().trim().nullable(),
  modality: z.nativeEnum(OfferModality),
  defaultValue: z.number().nonnegative("Valor não pode ser negativo.").nullable(),
  durationMonths: z.number().int().positive("Duração em meses.").nullable(),
  paymentMethod: z.string().trim().nullable(),
  active: z.boolean().default(true),
  notes: z.string().trim().nullable(),
  serviceIds: z.array(z.string().min(1)).default([]),
});


export async function saveOffer(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = OfferSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      name: String(formData.get("name") ?? "").trim(),
      description: clean(formData.get("description")),
      modality: (clean(formData.get("modality")) ?? "MRR") as OfferModality,
      defaultValue: (() => {
        const raw = clean(formData.get("defaultValue"));
        return raw == null ? null : parseBRL(raw);
      })(),
      durationMonths: (() => {
        const raw = clean(formData.get("durationMonths"));
        return raw == null ? null : parseInt(raw, 10);
      })(),
      paymentMethod: clean(formData.get("paymentMethod")),
      active: formData.get("active") !== "false",
      notes: clean(formData.get("notes")),
      serviceIds: formData.getAll("serviceIds").map(String).filter(Boolean),
    });

    const data = {
      name: parsed.name,
      description: parsed.description,
      modality: parsed.modality,
      defaultValue: parsed.defaultValue,
      durationMonths: parsed.durationMonths,
      paymentMethod: parsed.paymentMethod,
      active: parsed.active,
      notes: parsed.notes,
    };

    let id = parsed.id;
    if (id) {
      const existing = await prisma.offer.findUnique({ where: { id } });
      if (!existing) return { ok: false, error: "Oferta não encontrada." };
      await prisma.offer.update({ where: { id }, data });
      // Substitui o conjunto de serviços incluídos.
      await prisma.offerService.deleteMany({ where: { offerId: id } });
    } else {
      const created = await prisma.offer.create({ data });
      id = created.id;
    }

    if (parsed.serviceIds.length > 0) {
      await prisma.offerService.createMany({
        data: parsed.serviceIds.map((serviceId) => ({ offerId: id!, serviceId })),
      });
    }

    revalidateCatalog();
    return { ok: true, id };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar a oferta.";
    return { ok: false, error: msg };
  }
}

export async function deleteOffer(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await prisma.offer.deleteMany({ where: { id } });
    revalidateCatalog();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir a oferta." };
  }
}

export async function toggleOfferActive(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const existing = await prisma.offer.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Oferta não encontrada." };
    await prisma.offer.update({
      where: { id },
      data: { active: !existing.active },
    });
    revalidateCatalog();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar a oferta." };
  }
}
