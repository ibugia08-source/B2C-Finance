"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UpsellStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR } from "@/lib/format";
import type { ActionResult } from "./clients";

const UpsellSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1, "Selecione o cliente."),
  serviceId: z.string().nullable(),
  offerId: z.string().nullable(),
  title: z.string().trim().nullable(),
  value: z.number().positive("Informe o valor da oportunidade."),
  responsible: z.string().trim().nullable(),
  status: z.nativeEnum(UpsellStatus).default("OPPORTUNITY"),
  expectedCloseAt: z.date().nullable(),
  notes: z.string().trim().nullable(),
});

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}

export async function saveUpsell(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
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

    // Cliente precisa pertencer ao dono atual (findFirst é escopado).
    const owned = await prisma.client.findFirst({
      where: { id: parsed.clientId },
      select: { id: true, salesOwner: true },
    });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    const data = {
      clientId: parsed.clientId,
      serviceId: parsed.serviceId,
      offerId: parsed.offerId,
      title: parsed.title,
      value: parsed.value,
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

    revalidatePath("/upsell");
    revalidatePath("/dashboard");
    return { ok: true, id };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar a oportunidade.";
    return { ok: false, error: msg };
  }
}

/**
 * Muda o status da oportunidade. Ao marcar como VENDIDO (WON) com
 * `generateIncome`, cria uma receita (Income) associada ao cliente —
 * alimenta faturamento recebido, relatórios e rentabilidade.
 */
export async function setUpsellStatus(
  id: string,
  status: string,
  opts?: { generateIncome?: boolean }
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const s = z.nativeEnum(UpsellStatus).parse(status);
    const existing = await prisma.upsell.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Oportunidade não encontrada." };

    const closing = s === "WON" || s === "LOST";
    let incomeId = existing.incomeId;

    if (s === "WON" && opts?.generateIncome && !existing.incomeId) {
      const now = new Date();
      const income = await prisma.income.create({
        data: {
          description: `Upsell — ${existing.title ?? "venda interna"}`,
          amount: Number(existing.value),
          receivedAt: now,
          incomeType: "CLIENT",
          status: "RECEIVED",
          revenueType: "ONE_TIME",
          competenceMonth: now.getMonth() + 1,
          competenceYear: now.getFullYear(),
          clientId: existing.clientId,
        },
      });
      incomeId = income.id;
    }

    await prisma.upsell.update({
      where: { id },
      data: {
        status: s,
        closedAt: closing ? existing.closedAt ?? new Date() : null,
        incomeId,
      },
    });

    revalidatePath("/upsell");
    revalidatePath("/dashboard");
    revalidatePath("/receitas");
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar o status.";
    return { ok: false, error: msg };
  }
}

export async function deleteUpsell(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await prisma.upsell.deleteMany({ where: { id } });
    revalidatePath("/upsell");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir a oportunidade." };
  }
}
