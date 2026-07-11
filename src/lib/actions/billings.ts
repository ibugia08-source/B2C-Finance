"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  BillingStatus,
  CollectionStatus,
  PaymentMethod,
  RevenueType,
} from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR } from "@/lib/format";
import type { ActionResult } from "./clients";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}
const n = (v: unknown): number => (v == null ? 0 : Number(v));

function revalidateBilling(clientId?: string) {
  revalidatePath("/cobrancas");
  revalidatePath("/pagamentos");
  revalidatePath("/inadimplencia");
  revalidatePath("/clientes");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/dashboard");
}

// ---------- Criação / edição manual ----------

const BillingSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1, "Selecione o cliente."),
  contractId: z.string().nullable(),
  serviceId: z.string().nullable(),
  description: z.string().trim().min(1, "Descreva a cobrança."),
  competenceMonth: z.number().int().min(1).max(12),
  competenceYear: z.number().int().min(2000).max(2100),
  amount: z.number().positive("Valor deve ser maior que zero."),
  dueDate: z.date({ invalid_type_error: "Informe o vencimento." }),
  revenueType: z.nativeEnum(RevenueType),
  collector: z.string().trim().nullable(),
  notes: z.string().trim().nullable(),
});

export async function saveBilling(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const comp = clean(formData.get("competence")) ?? ""; // "YYYY-MM"
    const [cy, cm] = comp.split("-").map(Number);
    const parsed = BillingSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      clientId: String(formData.get("clientId") ?? ""),
      contractId: clean(formData.get("contractId")),
      serviceId: clean(formData.get("serviceId")),
      description: String(formData.get("description") ?? "").trim(),
      competenceMonth: cm || new Date().getMonth() + 1,
      competenceYear: cy || new Date().getFullYear(),
      amount: parseBRL(String(formData.get("amount") ?? "0")),
      dueDate: parseDateBR(String(formData.get("dueDate") ?? "")) ?? (undefined as any),
      revenueType: (clean(formData.get("revenueType")) ?? "MRR") as RevenueType,
      collector: clean(formData.get("collector")),
      notes: clean(formData.get("notes")),
    });

    const owned = await prisma.client.findFirst({
      where: { id: parsed.clientId },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { id, ...data } = parsed;

    let billingId = id;
    if (billingId) {
      const existing = await prisma.billing.findUnique({ where: { id: billingId } });
      if (!existing) return { ok: false, error: "Cobrança não encontrada." };
      if (existing.status === "PAID") {
        return { ok: false, error: "Cobrança quitada não pode ser editada." };
      }
      // Reavalia vencida/pendente ao trocar o vencimento (mantém PARTIAL).
      const status =
        existing.status === "PARTIAL"
          ? "PARTIAL"
          : data.dueDate < today
            ? "OVERDUE"
            : "PENDING";
      await prisma.billing.update({ where: { id: billingId }, data: { ...data, status } });
    } else {
      const created = await prisma.billing.create({
        data: { ...data, status: data.dueDate < today ? "OVERDUE" : "PENDING" },
      });
      billingId = created.id;
      await prisma.collectionHistory.create({
        data: { billingId, clientId: data.clientId, status: "NOT_CONTACTED", message: "Cobrança criada manualmente." },
      });
    }

    revalidateBilling(parsed.clientId);
    return { ok: true, id: billingId };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar a cobrança.",
    };
  }
}

// ---------- Pagamento (total ou parcial) ----------

const PaymentSchema = z.object({
  billingId: z.string().min(1),
  amount: z.number().positive("Valor deve ser maior que zero."),
  paidAt: z.date(),
  method: z.nativeEnum(PaymentMethod),
  accountId: z.string().nullable(),
  notes: z.string().trim().nullable(),
});

export async function registerBillingPayment(
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = PaymentSchema.parse({
      billingId: String(formData.get("billingId") ?? ""),
      amount: parseBRL(String(formData.get("amount") ?? "0")),
      paidAt: parseDateBR(String(formData.get("paidAt") ?? "")) ?? new Date(),
      method: (clean(formData.get("method")) ?? "PIX") as PaymentMethod,
      accountId: clean(formData.get("accountId")),
      notes: clean(formData.get("notes")),
    });

    // Núcleo contábil compartilhado (fechamento mensal + Receita Extra
    // automática idempotente) — mesma função testada pelos cenários.
    const { settleBillingPayment } = await import(
      "@/lib/services/payment-accounting"
    );
    const result = await settleBillingPayment(parsed);
    if (!result.ok) return result;

    revalidateBilling(result.clientId);
    revalidatePath("/receitas");
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao registrar o pagamento.",
    };
  }
}

/** Exclui um pagamento e reverte saldo/status/flags e Receita Extra. */
export async function deleteBillingPayment(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const { revertBillingPayment } = await import(
      "@/lib/services/payment-accounting"
    );
    const result = await revertBillingPayment(id);
    if (!result.ok) return result;
    revalidateBilling(result.clientId);
    revalidatePath("/receitas");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o pagamento." };
  }
}

// ---------- Ciclo de vida ----------

export async function cancelBilling(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const b = await prisma.billing.findUnique({ where: { id } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status === "PAID")
      return { ok: false, error: "Cobrança quitada não pode ser cancelada." };
    await prisma.billing.update({
      where: { id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
    await prisma.collectionHistory.create({
      data: { billingId: id, clientId: b.clientId, status: b.collectionStatus, message: "Cobrança cancelada." },
    });
    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao cancelar a cobrança." };
  }
}

/** Reagenda o vencimento (registra no histórico; reavalia OVERDUE). */
export async function rescheduleBilling(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const newDue = parseDateBR(String(formData.get("dueDate") ?? ""));
    if (!newDue) return { ok: false, error: "Informe a nova data de vencimento." };
    const b = await prisma.billing.findUnique({ where: { id } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status === "PAID" || b.status === "CANCELED")
      return { ok: false, error: "Cobrança encerrada não pode ser reagendada." };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.billing.update({
      where: { id },
      data: {
        dueDate: newDue,
        status:
          n(b.paidTotal) > 0 ? "PARTIAL" : newDue < today ? "OVERDUE" : "PENDING",
      },
    });
    await prisma.collectionHistory.create({
      data: {
        billingId: id,
        clientId: b.clientId,
        status: b.collectionStatus,
        message: `Vencimento reagendado para ${newDue.toLocaleDateString("pt-BR")}.`,
      },
    });
    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao reagendar." };
  }
}

// ---------- Interações de cobrança (observação / promessa) ----------

const NoteSchema = z.object({
  billingId: z.string().min(1),
  status: z.nativeEnum(CollectionStatus),
  channel: z.string().trim().nullable(),
  message: z.string().trim().min(1, "Escreva a observação."),
  nextActionAt: z.date().nullable(),
});

export async function addCollectionNote(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = NoteSchema.parse({
      billingId: String(formData.get("billingId") ?? ""),
      status: (clean(formData.get("status")) ?? "CONTACTED") as CollectionStatus,
      channel: clean(formData.get("channel")),
      message: String(formData.get("message") ?? "").trim(),
      nextActionAt: (() => {
        const raw = clean(formData.get("nextActionAt"));
        return raw == null ? null : parseDateBR(raw);
      })(),
    });

    const b = await prisma.billing.findUnique({ where: { id: parsed.billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };

    await prisma.collectionHistory.create({
      data: {
        billingId: b.id,
        clientId: b.clientId,
        status: parsed.status,
        channel: parsed.channel,
        message: parsed.message,
        nextActionAt: parsed.nextActionAt,
      },
    });
    await prisma.billing.update({
      where: { id: b.id },
      data: { collectionStatus: parsed.status },
    });

    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao registrar a observação.",
    };
  }
}
