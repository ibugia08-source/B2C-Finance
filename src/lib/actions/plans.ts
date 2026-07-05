"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ContractType, RecurrenceType } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL } from "@/lib/format";
import type { ActionResult } from "./clients";

const PlanSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Informe o nome do plano."),
  description: z.string().trim().nullable(),
  type: z.nativeEnum(ContractType),
  recurrence: z.nativeEnum(RecurrenceType),
  monthlyPrice: z.number().nonnegative(),
  setupFee: z.number().nonnegative().nullable(),
  defaultDuration: z.number().int().positive().nullable(),
  notes: z.string().trim().nullable(),
  active: z.boolean().default(true),
  serviceIds: z.array(z.string()).default([]),
});

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}

export async function savePlan(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = PlanSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      name: String(formData.get("name") ?? "").trim(),
      description: clean(formData.get("description")),
      type: (clean(formData.get("type")) ?? "MRR") as ContractType,
      recurrence: (clean(formData.get("recurrence")) ?? "MONTHLY") as RecurrenceType,
      monthlyPrice: parseBRL(String(formData.get("monthlyPrice") ?? "0")),
      setupFee: (() => {
        const raw = clean(formData.get("setupFee"));
        return raw == null ? null : parseBRL(raw);
      })(),
      defaultDuration: (() => {
        const raw = clean(formData.get("defaultDuration"));
        return raw == null ? null : parseInt(raw, 10);
      })(),
      notes: clean(formData.get("notes")),
      active: formData.get("active") !== "false",
      serviceIds: formData.getAll("serviceIds").map(String).filter(Boolean),
    });

    const { id, serviceIds, ...data } = parsed;
    let planId = id;
    if (planId) {
      const existing = await prisma.plan.findUnique({ where: { id: planId } });
      if (!existing) return { ok: false, error: "Plano não encontrado." };
      await prisma.plan.update({ where: { id: planId }, data });
      // Sincroniza serviços inclusos (replace simples — sem dados extras no join).
      await prisma.planService.deleteMany({ where: { planId } });
    } else {
      const created = await prisma.plan.create({ data });
      planId = created.id;
    }
    if (serviceIds.length > 0) {
      await prisma.planService.createMany({
        data: serviceIds.map((serviceId) => ({ planId: planId!, serviceId })),
      });
    }

    revalidatePath("/planos");
    revalidatePath("/contratos");
    return { ok: true, id: planId };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o plano.",
    };
  }
}

export async function deletePlan(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const inUse = await prisma.contract.count({ where: { planId: id } });
    if (inUse > 0) {
      return {
        ok: false,
        error: `Plano em uso por ${inUse} contrato(s). Desative-o em vez de excluir.`,
      };
    }
    await prisma.planService.deleteMany({ where: { planId: id } });
    await prisma.plan.deleteMany({ where: { id } });
    revalidatePath("/planos");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o plano." };
  }
}
