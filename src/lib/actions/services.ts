"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL } from "@/lib/format";
import type { ActionResult } from "./clients";

const ServiceSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Informe o nome do serviço."),
  description: z.string().trim().nullable(),
  category: z.string().trim().nullable(),
  defaultPrice: z.number().nonnegative().nullable(),
  estimatedCost: z.number().nonnegative().nullable(),
  defaultOwner: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
  active: z.boolean().default(true),
});

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}
const money = (v: FormDataEntryValue | null) => {
  const raw = clean(v);
  return raw == null ? null : parseBRL(raw);
};

export async function saveService(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = ServiceSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      name: String(formData.get("name") ?? "").trim(),
      description: clean(formData.get("description")),
      category: clean(formData.get("category")),
      defaultPrice: money(formData.get("defaultPrice")),
      estimatedCost: money(formData.get("estimatedCost")),
      defaultOwner: clean(formData.get("defaultOwner")),
      notes: clean(formData.get("notes")),
      active: formData.get("active") !== "false",
    });
    const { id, ...data } = parsed;
    let saved;
    if (id) {
      const existing = await prisma.service.findUnique({ where: { id } });
      if (!existing) return { ok: false, error: "Serviço não encontrado." };
      saved = await prisma.service.update({ where: { id }, data });
    } else {
      saved = await prisma.service.create({ data });
    }
    revalidatePath("/servicos");
    revalidatePath("/acordos");
    return { ok: true, id: saved.id };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o serviço.",
    };
  }
}

export async function deleteService(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const inUse = await prisma.contractService.count({ where: { serviceId: id } });
    if (inUse > 0) {
      return {
        ok: false,
        error: `Serviço em uso por ${inUse} contrato(s). Desative-o em vez de excluir.`,
      };
    }
    await prisma.service.deleteMany({ where: { id } });
    revalidatePath("/servicos");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o serviço." };
  }
}
