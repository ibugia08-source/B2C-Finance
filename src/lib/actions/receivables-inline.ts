"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL } from "@/lib/format";
import type { ActionResult } from "./clients";

/**
 * Edição INLINE da lista de Recebimentos (ciclo mensal).
 * Regra do briefing: alterar na linha atualiza também o CADASTRO do cliente
 * (Gestão de Carteira) — vencimento, valor, modalidade e prazo são atributos
 * do cliente; o status é do recebimento do mês.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v));

function revalidateAll(clientId?: string) {
  revalidateTag(CACHE_TAGS.BILLINGS);
  revalidateTag(CACHE_TAGS.CLIENTS);
  revalidateTag(CACHE_TAGS.BILLING_CYCLE);
  revalidateTag(CACHE_TAGS.DASHBOARD);
  if (clientId) {
    revalidateTag(CACHE_TAGS.CLIENT_ID(clientId));
    revalidateTag(CACHE_TAGS.CLIENT_BILLINGS(clientId));
  }
}

/** Cobrança em aberto do cliente na competência (para sincronizar edições). */
async function openBillingOf(clientId: string, month: number, year: number) {
  return prisma.billing.findFirst({
    where: {
      clientId,
      competenceMonth: month,
      competenceYear: year,
      status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
    },
    orderBy: { dueDate: "asc" },
  });
}

/**
 * Vencimento recorrente (dia do mês) — atualiza o cadastro do cliente e a
 * cobrança em aberto do mês visualizado (mantém o ciclo coerente).
 */
export async function setClientPaymentDay(
  clientId: string,
  day: number,
  month: number,
  year: number
): Promise<ActionResult> {
  await requireAdmin();
  try {
    if (!Number.isInteger(day) || day < 1 || day > 28)
      return { ok: false, error: "Dia de vencimento deve ser entre 1 e 28." };
    const client = await prisma.client.findFirst({ where: { id: clientId } });
    if (!client) return { ok: false, error: "Cliente não encontrado." };

    await prisma.client.update({ where: { id: clientId }, data: { paymentDay: day } });

    const open = await openBillingOf(clientId, month, year);
    if (open) {
      const dueDate = new Date(year, month - 1, day);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await prisma.billing.update({
        where: { id: open.id },
        data: {
          dueDate,
          status:
            n(open.paidTotal) > 0 ? "PARTIAL" : dueDate < today ? "OVERDUE" : "PENDING",
        },
      });
    }
    revalidateAll(clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o vencimento." };
  }
}

/**
 * Valor devido — atualiza o valor de referência do cliente (mensal para MRR,
 * contrato para TCV) e a cobrança em aberto do mês visualizado.
 */
export async function setClientChargeAmount(
  clientId: string,
  amountRaw: string,
  month: number,
  year: number
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const amount = parseBRL(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, error: "Informe um valor maior que zero." };
    const client = await prisma.client.findFirst({ where: { id: clientId } });
    if (!client) return { ok: false, error: "Cliente não encontrado." };

    const open = await openBillingOf(clientId, month, year);
    if (open && amount < n(open.paidTotal))
      return {
        ok: false,
        error: "Valor menor que o já pago nesta cobrança — exclua o pagamento antes.",
      };

    await prisma.client.update({
      where: { id: clientId },
      data: { monthlyValue: amount },
    });
    if (open) {
      await prisma.billing.update({ where: { id: open.id }, data: { amount } });
    }
    revalidateAll(clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o valor." };
  }
}

/** Prazo do contrato (meses) — atributo do cadastro do cliente. */
export async function setClientContractMonths(
  clientId: string,
  months: number | null
): Promise<ActionResult> {
  await requireAdmin();
  try {
    if (months != null && (!Number.isInteger(months) || months < 1 || months > 120))
      return { ok: false, error: "Prazo inválido (1 a 120 meses)." };
    const client = await prisma.client.findFirst({ where: { id: clientId } });
    if (!client) return { ok: false, error: "Cliente não encontrado." };
    await prisma.client.update({
      where: { id: clientId },
      data: { contractMonths: months },
    });
    revalidateAll(clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o prazo." };
  }
}

// ===== Status do recebimento do mês (coluna Status) =====

export type MonthChargeStatus = "UPCOMING" | "PAID" | "OVERDUE" | "DELINQUENT";

/**
 * Muda o status da cobrança do mês direto na lista:
 *  - A vencer / Vencido → reabre/marca vencida (sem mexer em pagamentos);
 *  - Inadimplente → marcação MANUAL (collectionStatus ESCALATED);
 *  - Pago → registra pagamento do saldo em aberto HOJE pelo núcleo contábil
 *    oficial (sem duplicidade; Receita Extra automática só se a competência
 *    for de mês anterior — regra padrão do fechamento).
 * Cobrança já quitada não pode ser reaberta por aqui (excluir o pagamento
 * na aba Pagamentos).
 */
export async function setMonthChargeStatus(
  billingId: string,
  status: MonthChargeStatus
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const b = await prisma.billing.findUnique({ where: { id: billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    if (b.status === "CANCELED")
      return { ok: false, error: "Cobrança removida do mês — recoloque-a antes." };

    if (status === "PAID") {
      if (b.status === "PAID") return { ok: true };
      const open = n(b.amount) - n(b.paidTotal);
      if (open <= 0) return { ok: false, error: "Sem saldo em aberto." };
      const { settleBillingPayment } = await import(
        "@/lib/services/payment-accounting"
      );
      const res = await settleBillingPayment({
        billingId: b.id,
        amount: open,
        paidAt: new Date(),
        method: "OTHER",
        accountId: null,
        notes: "Marcado como pago na lista de Recebimentos.",
      });
      if (!res.ok) return res;
      revalidateAll(b.clientId);
      revalidatePath("/pagamentos");
      revalidatePath("/receitas");
      return { ok: true };
    }

    if (b.status === "PAID")
      return {
        ok: false,
        error:
          "Cobrança já quitada. Para reabrir, use a ação 'Excluir pagamento' na própria linha.",
      };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const clearManual =
      b.collectionStatus === "ESCALATED"
        ? { collectionStatus: "NOT_CONTACTED" as any }
        : {};
    const data: Record<string, any> =
      status === "UPCOMING"
        ? { status: n(b.paidTotal) > 0 ? "PARTIAL" : "PENDING", ...clearManual }
        : status === "OVERDUE"
          ? { status: "OVERDUE", ...clearManual }
          : {
              status: b.dueDate < today ? "OVERDUE" : b.status,
              collectionStatus: "ESCALATED",
            };

    await prisma.billing.update({ where: { id: b.id }, data });
    if (status === "DELINQUENT") {
      await prisma.collectionHistory.create({
        data: {
          billingId: b.id,
          clientId: b.clientId,
          status: "ESCALATED",
          message: "Marcado manualmente como inadimplente na lista de Recebimentos.",
        },
      });
    }
    revalidateAll(b.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o status." };
  }
}

// ===== Inadimplência anterior (registro manual de meses passados) =====

/**
 * Registra manualmente uma inadimplência de MÊS ANTERIOR: cria a cobrança
 * vencida na competência informada (entra no histórico financeiro do
 * cliente e nos relatórios). NÃO cria Receita Extra — se for paga depois,
 * fica como inadimplência regularizada pela regra padrão.
 */
export async function addPastDelinquency(formData: FormData): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    const clientId = String(formData.get("clientId") ?? "");
    const refMonth = parseInt(String(formData.get("refMonth") ?? ""), 10);
    const refYear = parseInt(String(formData.get("refYear") ?? ""), 10);
    const amount = parseBRL(String(formData.get("amount") ?? "0"));
    const dueRaw = String(formData.get("dueDate") ?? ""); // YYYY-MM-DD (input date)
    const notes = String(formData.get("notes") ?? "").trim() || null;

    if (!clientId) return { ok: false, error: "Selecione o cliente." };
    if (!Number.isInteger(refMonth) || refMonth < 1 || refMonth > 12)
      return { ok: false, error: "Mês de referência inválido." };
    if (!Number.isInteger(refYear) || refYear < 2000 || refYear > 2100)
      return { ok: false, error: "Ano de referência inválido." };
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, error: "Informe o valor inadimplente." };

    const now = new Date();
    const compKey = refYear * 12 + (refMonth - 1);
    const nowKey = now.getFullYear() * 12 + now.getMonth();
    if (compKey >= nowKey)
      return {
        ok: false,
        error: "Inadimplência anterior é só de meses passados — para o mês atual use o ciclo normal.",
      };

    const client = await prisma.client.findFirst({
      where: { id: clientId },
      select: { id: true, name: true, modality: true, paymentDay: true },
    });
    if (!client) return { ok: false, error: "Cliente não encontrado." };

    let dueDate: Date | null = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) dueDate = new Date(`${dueRaw}T00:00:00`);
    if (!dueDate || Number.isNaN(dueDate.getTime())) {
      dueDate = new Date(refYear, refMonth - 1, Math.min(client.paymentDay ?? 5, 28));
    }

    const billing = await prisma.billing.create({
      data: {
        clientId: client.id,
        description: `Inadimplência anterior ${String(refMonth).padStart(2, "0")}/${refYear} — ${client.name}`,
        competenceMonth: refMonth,
        competenceYear: refYear,
        amount,
        dueDate,
        status: "OVERDUE",
        collectionStatus: "ESCALATED", // aparece como Inadimplente
        revenueType:
          client.modality === "MRR" || client.modality === "TCV"
            ? client.modality
            : "ONE_TIME",
        notes,
      },
    });
    await prisma.collectionHistory.create({
      data: {
        billingId: billing.id,
        clientId: client.id,
        status: "ESCALATED",
        message: `Inadimplência de ${String(refMonth).padStart(2, "0")}/${refYear} registrada manualmente por ${viewer.email}.${notes ? ` Obs.: ${notes}` : ""}`,
      },
    });

    revalidateAll(client.id);
    revalidatePath("/inadimplencia");
    return { ok: true, id: billing.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao registrar a inadimplência." };
  }
}

// ===== Excluir pagamento de cobrança quitada (reabre a cobrança) =====

/**
 * Exclui TODOS os pagamentos de uma cobrança (linha "Paga" da lista):
 * reverte cada um pelo núcleo contábil oficial (saldo, status, flags de
 * fechamento e conciliação de caixa) — a cobrança volta a Em aberto/Vencida.
 */
export async function deleteBillingPayments(billingId: string): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    const b = await prisma.billing.findUnique({ where: { id: billingId } });
    if (!b) return { ok: false, error: "Cobrança não encontrada." };
    const payments = await prisma.payment.findMany({
      where: { billingId },
      orderBy: { paidAt: "desc" },
      select: { id: true },
    });
    if (payments.length === 0)
      return { ok: false, error: "Esta cobrança não tem pagamentos registrados." };

    const { revertBillingPayment } = await import(
      "@/lib/services/payment-accounting"
    );
    for (const p of payments) {
      const res = await revertBillingPayment(p.id);
      if (!res.ok) return res;
    }
    await prisma.collectionHistory.create({
      data: {
        billingId,
        clientId: b.clientId,
        status: "NOT_CONTACTED",
        message: `Pagamento(s) excluído(s) por ${viewer.email} — cobrança reaberta.`,
      },
    });
    revalidateAll(b.clientId);
    revalidatePath("/pagamentos");
    revalidatePath("/receitas");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o pagamento." };
  }
}

// ===== Ações em massa da lista de Recebimentos =====

/** Status do mês em massa (Pago fica de fora — pagamento é individual). */
export async function bulkSetMonthStatus(
  billingIds: string[],
  status: Exclude<MonthChargeStatus, "PAID">
): Promise<ActionResult> {
  await requireAdmin();
  try {
    if (billingIds.length === 0)
      return { ok: false, error: "Nenhuma cobrança selecionada." };
    let changed = 0;
    for (const id of billingIds) {
      const res = await setMonthChargeStatus(id, status);
      if (res.ok) changed++;
    }
    revalidatePath("/cobrancas");
    return changed > 0
      ? { ok: true }
      : {
          ok: false,
          error:
            "Nenhuma cobrança pôde ser atualizada (quitadas/removidas ficam de fora).",
        };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha na atualização em massa." };
  }
}

/**
 * Remove CLIENTES SELECIONADOS da lista do mês (checkbox → Remover da lista).
 * - Com cobrança no mês: cancela a cobrança (auditado).
 * - Sem cobrança no mês ("Sem cobrança"): cria um marcador CANCELADO na
 *   competência — o cliente some da lista, aparece em "Removidos do mês",
 *   pode ser recolocado e a geração automática não o recria.
 * NUNCA apaga o cliente da Gestão de Carteira.
 */
export async function bulkRemoveClientsFromList(
  entries: { clientId: string; billingId: string | null }[],
  month: number,
  year: number,
  reason: string | null
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year))
      return { ok: false, error: "Competência inválida." };
    const cleanReason = (reason ?? "").trim() || null;

    const billingIds = entries.filter((e) => e.billingId).map((e) => e.billingId!);
    const bareClientIds = Array.from(
      new Set(entries.filter((e) => !e.billingId).map((e) => e.clientId))
    );

    let removed = 0;

    // 1) Cancela as cobranças existentes (quitadas ficam de fora).
    if (billingIds.length) {
      const bills = await prisma.billing.findMany({
        where: { id: { in: billingIds }, status: { notIn: ["PAID", "CANCELED"] } },
        select: { id: true, clientId: true },
      });
      if (bills.length) {
        await prisma.billing.updateMany({
          where: { id: { in: bills.map((b) => b.id) } },
          data: {
            status: "CANCELED",
            canceledAt: new Date(),
            canceledBy: viewer.email,
            cancelReason: cleanReason,
          },
        });
        await prisma.collectionHistory.createMany({
          data: bills.map((b) => ({
            billingId: b.id,
            clientId: b.clientId,
            status: "NOT_CONTACTED" as any,
            message: `Removido da lista de ${String(month).padStart(2, "0")}/${year} por ${viewer.email}.${cleanReason ? ` Motivo: ${cleanReason}` : ""}`,
          })),
        });
        removed += bills.length;
      }
    }

    // 2) Clientes sem cobrança no mês: marcador cancelado na competência.
    if (bareClientIds.length) {
      const clients = await prisma.client.findMany({
        where: { id: { in: bareClientIds } },
        select: { id: true, name: true, monthlyValue: true, paymentDay: true },
      });
      for (const c of clients) {
        // Se já existir cobrança na competência (corrida), não duplica.
        const existing = await prisma.billing.findFirst({
          where: { clientId: c.id, competenceMonth: month, competenceYear: year },
          select: { id: true },
        });
        if (existing) continue;
        const day = Math.min(Math.max(c.paymentDay ?? 5, 1), 28);
        const marker = await prisma.billing.create({
          data: {
            clientId: c.id,
            description: `Mensalidade ${String(month).padStart(2, "0")}/${year} — ${c.name}`,
            competenceMonth: month,
            competenceYear: year,
            amount: Number(c.monthlyValue ?? 0),
            dueDate: new Date(year, month - 1, day),
            status: "CANCELED",
            canceledAt: new Date(),
            canceledBy: viewer.email,
            cancelReason: cleanReason,
            revenueType: "MRR",
          },
        });
        await prisma.collectionHistory.create({
          data: {
            billingId: marker.id,
            clientId: c.id,
            status: "NOT_CONTACTED",
            message: `Removido da lista de ${String(month).padStart(2, "0")}/${year} por ${viewer.email} (cliente sem cobrança no mês).${cleanReason ? ` Motivo: ${cleanReason}` : ""}`,
          },
        });
        removed += 1;
      }
    }

    if (removed === 0)
      return {
        ok: false,
        error: "Nada para remover (cobranças quitadas ficam de fora).",
      };
    revalidateAll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao remover da lista." };
  }
}

/** Remove do ciclo do mês em massa (auditado; não apaga clientes). */
export async function bulkRemoveFromMonth(
  billingIds: string[],
  reason: string | null
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    const cleanReason = (reason ?? "").trim() || null;
    const bills = await prisma.billing.findMany({
      where: { id: { in: billingIds }, status: { notIn: ["PAID", "CANCELED"] } },
      select: { id: true, clientId: true, competenceMonth: true, competenceYear: true },
    });
    if (bills.length === 0)
      return {
        ok: false,
        error: "Nada para remover (cobranças quitadas ficam de fora).",
      };

    await prisma.billing.updateMany({
      where: { id: { in: bills.map((b) => b.id) } },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        canceledBy: viewer.email,
        cancelReason: cleanReason,
      },
    });
    await prisma.collectionHistory.createMany({
      data: bills.map((b) => ({
        billingId: b.id,
        clientId: b.clientId,
        status: "NOT_CONTACTED" as any,
        message: `Removida do ciclo de ${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear} por ${viewer.email} (ação em massa).${cleanReason ? ` Motivo: ${cleanReason}` : ""}`,
      })),
    });
    revalidateAll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao remover do mês em massa." };
  }
}
