"use server";
import { prisma } from "@/lib/prisma";
import { revalidateAgency, revalidateFinance } from "@/lib/revalidate";
import { z } from "zod";
import {
  BillingStatus,
  CollectionStatus,
  PaymentMethod,
  RevenueType,
} from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, toNumber as n, clean } from "@/lib/format";
import type { ActionResult } from "./clients";


function revalidateBilling(clientId?: string) {
  revalidateAgency({ clientId });
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
    revalidateFinance(); // pagamento gera Receita Extra (Income)
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
    revalidateFinance(); // reverte a Receita Extra (Income)
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o pagamento." };
  }
}

/**
 * Exclui vários pagamentos de uma vez. Reusa o mesmo núcleo contábil
 * (revertBillingPayment) por pagamento — cada reversão recalcula saldo,
 * status/flags da cobrança e reverte a Receita Extra automática. Ao final,
 * revalida uma única vez cada cliente afetado + as finanças, mantendo
 * Dashboard, Rotina, Relatórios, Recebimentos e Caixa coerentes.
 */
export async function deleteBillingPaymentsBulk(
  ids: string[]
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0)
      return { ok: false, error: "Nenhum pagamento selecionado." };

    const { revertBillingPayment } = await import(
      "@/lib/services/payment-accounting"
    );

    const affectedClients = new Set<string>();
    const failures: string[] = [];
    for (const id of unique) {
      const result = await revertBillingPayment(id);
      if (result.ok) affectedClients.add(result.clientId);
      else failures.push(result.error);
    }

    if (affectedClients.size === 0) {
      return {
        ok: false,
        error: failures[0] ?? "Falha ao excluir os pagamentos.",
      };
    }

    for (const clientId of affectedClients) revalidateBilling(clientId);
    revalidateFinance(); // reverte as Receitas Extra (Income) correspondentes
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir os pagamentos." };
  }
}

// ---------- Ciclo de vida ----------

/**
 * Remove a cobrança do ciclo do MÊS (não apaga o cliente nem o cadastro):
 * status CANCELED + auditoria (quem/quando/por quê). A geração automática
 * nunca recria uma cobrança removida.
 */
export async function cancelBilling(
  id: string,
  reason?: string | null
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    const b = await prisma.billing.findUnique({ where: { id } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status === "PAID")
      return { ok: false, error: "Cobrança quitada não pode ser removida do mês." };
    const cleanReason = (reason ?? "").trim() || null;
    await prisma.billing.update({
      where: { id },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        canceledBy: viewer.email,
        cancelReason: cleanReason,
      },
    });
    await prisma.collectionHistory.create({
      data: {
        billingId: id,
        clientId: b.clientId,
        status: b.collectionStatus,
        message: `Removida do ciclo de ${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear} por ${viewer.email}.${cleanReason ? ` Motivo: ${cleanReason}` : ""}`,
      },
    });
    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao remover a cobrança do mês." };
  }
}

/**
 * Exclusão em massa (soft-delete auditado) das cobranças selecionadas na aba
 * Recebimentos do cliente. Mesma semântica de `cancelBilling`: status CANCELED
 * + auditoria, sem apagar cliente/contrato/pagamento. Cobranças quitadas (PAID)
 * são ignoradas — o dinheiro já entrou. Sem query em loop (updateMany/createMany).
 */
export async function cancelBillingsBulk(
  ids: string[],
  reason?: string | null
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return { ok: false, error: "Nenhuma cobrança selecionada." };

    const billings = await prisma.billing.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        clientId: true,
        status: true,
        collectionStatus: true,
        competenceMonth: true,
        competenceYear: true,
      },
    });
    const removable = billings.filter((b) => b.status !== "PAID");
    if (removable.length === 0) {
      return { ok: false, error: "As cobranças selecionadas já estão quitadas e não podem ser excluídas." };
    }

    const cleanReason = (reason ?? "").trim() || null;
    const now = new Date();
    await prisma.billing.updateMany({
      where: { id: { in: removable.map((b) => b.id) } },
      data: {
        status: "CANCELED",
        canceledAt: now,
        canceledBy: viewer.email,
        cancelReason: cleanReason,
      },
    });
    await prisma.collectionHistory.createMany({
      data: removable.map((b) => ({
        billingId: b.id,
        clientId: b.clientId,
        status: b.collectionStatus,
        actionType: "DELETED",
        createdBy: viewer.email,
        message: `Excluída (em massa) do ciclo de ${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear} por ${viewer.email}.${cleanReason ? ` Motivo: ${cleanReason}` : ""}`,
      })),
    });

    const affectedClients = Array.from(new Set(removable.map((b) => b.clientId)));
    for (const clientId of affectedClients) revalidateBilling(clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir as cobranças." };
  }
}

/** Recoloca no ciclo do mês uma cobrança removida por engano. */
export async function restoreBilling(id: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    const b = await prisma.billing.findUnique({ where: { id } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status !== "CANCELED")
      return { ok: false, error: "A cobrança não está removida do mês." };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const status =
      n(b.paidTotal) > 0 ? "PARTIAL" : b.dueDate < today ? "OVERDUE" : "PENDING";
    await prisma.billing.update({
      where: { id },
      data: { status, canceledAt: null, canceledBy: null, cancelReason: null },
    });
    await prisma.collectionHistory.create({
      data: {
        billingId: id,
        clientId: b.clientId,
        status: b.collectionStatus,
        message: `Recolocada no ciclo de ${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear} por ${viewer.email}.`,
      },
    });
    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao recolocar a cobrança no mês." };
  }
}

/**
 * Registra no histórico que a mensagem de cobrança foi enviada/copiada
 * (WhatsApp aberto ou texto copiado) e marca o cliente como contatado.
 */
export async function registerBillingContact(
  billingId: string,
  channel: "whatsapp" | "copia",
  excerpt: string
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const b = await prisma.billing.findUnique({ where: { id: billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    await prisma.collectionHistory.create({
      data: {
        billingId: b.id,
        clientId: b.clientId,
        status: "CONTACTED",
        channel,
        message:
          channel === "whatsapp"
            ? `Cobrança enviada via WhatsApp: "${excerpt.slice(0, 180)}…"`
            : `Mensagem de cobrança copiada: "${excerpt.slice(0, 180)}…"`,
      },
    });
    if (b.collectionStatus === "NOT_CONTACTED") {
      await prisma.billing.update({
        where: { id: b.id },
        data: { collectionStatus: "CONTACTED" },
      });
    }
    revalidateBilling(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao registrar o contato." };
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
