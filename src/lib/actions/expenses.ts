"use server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/viewer";
import { revalidateFinance } from "@/lib/revalidate";
import { parseBRL, parseDateBR, parseMonthParam, clean } from "@/lib/format";
import type { ActionResult } from "./clients";
import { EXPENSE_STATUS as STATUS, salvarDespesa, type ExpenseInput } from "@/lib/services/expense-service";
import { domainContextFor } from "@/lib/auth/domain-session";

/**
 * Despesas — cadastro SIMPLIFICADO (briefing PARTE 8):
 * nome, descrição, valor, vencimento, recorrência, status e tipo.
 * Tipo CARTÃO abre associação com o cartão + mês da fatura.
 *
 * Recorrência: as ocorrências futuras são MATERIALIZADAS na criação
 * (mesmo recurrenceGroupId), com horizonte de 12 meses — evita cron e
 * duplicidade (idempotente por grupo+mês). "Vencida" é derivada
 * (pendente com dueDate < hoje) — nunca reescrevemos o status no banco.
 */

export async function saveExpense(formData: FormData): Promise<ActionResult> {
  const viewer = await requirePermission("despesas.editar");
  try {
    const dueRaw = clean(formData.get("dueDate"));
    const invoiceRef = parseMonthParam(clean(formData.get("cardInvoiceRef"))); // "YYYY-MM"
    // Formulário → entrada tipada; regra em services/expense-service.
    const input: ExpenseInput = {
      id: clean(formData.get("id")) ?? undefined,
      description: String(formData.get("description") ?? "").trim(),
      notes: clean(formData.get("notes")),
      amount: parseBRL(String(formData.get("amount") ?? "0")),
      // Sem data, o schema recusa com "Informe o vencimento." (como antes).
      dueDate: (dueRaw ? parseDateBR(dueRaw) : null) as Date,
      recurrence: (clean(formData.get("recurrence")) ?? "NONE") as any,
      recurrenceInterval: (() => {
        const raw = clean(formData.get("recurrenceInterval"));
        return raw == null ? null : parseInt(raw, 10);
      })(),
      status: (clean(formData.get("status")) ?? "pendente") as any,
      expenseType: (clean(formData.get("expenseType")) ?? "OTHER") as any,
      categoryId: clean(formData.get("categoryId")),
      cardId: clean(formData.get("cardId")),
      cardInvoiceMonth: invoiceRef?.month ?? null,
      cardInvoiceYear: invoiceRef?.year ?? null,
      scope: (clean(formData.get("scope")) ?? "one") as any,
    };
    const r = await salvarDespesa(await domainContextFor(viewer), input);
    if (!r.ok) return r;
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar a despesa.";
    return { ok: false, error: msg };
  }
}

/** Encerra a recorrência: remove ocorrências FUTURAS não pagas do grupo. */
export async function endRecurrence(groupId: string): Promise<ActionResult> {
  await requirePermission("despesas.editar");
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.transaction.deleteMany({
      where: {
        recurrenceGroupId: groupId,
        dueDate: { gt: today },
        status: { not: "pago" },
      },
    });
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao encerrar a recorrência." };
  }
}

export async function deleteExpense(
  id: string,
  scope: "one" | "group" = "one"
): Promise<ActionResult> {
  await requirePermission("despesas.excluir");
  try {
    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Despesa não encontrada." };
    if (scope === "group" && existing.recurrenceGroupId) {
      await prisma.transaction.deleteMany({
        where: { recurrenceGroupId: existing.recurrenceGroupId, status: { not: "pago" } },
      });
    } else {
      await prisma.transaction.deleteMany({ where: { id } });
    }
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir a despesa." };
  }
}

/**
 * Altera o VENCIMENTO de uma despesa (Rotina diária → "Alterar vencimento").
 * Afeta apenas esta despesa/ocorrência — não existe recorrência encadeada no
 * modelo (cada ocorrência é uma Transaction própria), então nada é quebrado.
 */
export async function setExpenseDueDate(
  id: string,
  dueDateRaw: string
): Promise<ActionResult> {
  await requirePermission("despesas.editar");
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dueDateRaw ?? "").trim());
    if (!m) return { ok: false, error: "Informe uma data válida." };
    // Meio-dia local evita a data "voltar um dia" por fuso horário.
    const dueDate = new Date(+m[1], +m[2] - 1, +m[3], 12);
    if (isNaN(dueDate.getTime())) return { ok: false, error: "Data inválida." };

    await prisma.transaction.updateMany({ where: { id }, data: { dueDate } });
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao alterar o vencimento." };
  }
}

export async function setExpenseStatus(
  id: string,
  status: (typeof STATUS)[number]
): Promise<ActionResult> {
  try {
    // 03 §4.1: a action não escreve o fato — o motor escreve, com a
    // permissão, a guarda de período, a trilha e o aviso no mesmo lugar.
    const { setExpenseStatus: viaEngine } = await import("@/lib/engines/expense-engine");
    const res = await viaEngine(id, status);
    if (!res.ok) return res;
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o status." };
  }
}
