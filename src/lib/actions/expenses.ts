"use server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/viewer";
import { revalidateFinance } from "@/lib/revalidate";
import { z } from "zod";
import { parseBRL, parseDateBR, parseMonthParam, clean } from "@/lib/format";
import type { ActionResult } from "./clients";

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

const EXPENSE_TYPES = [
  "FIXED", "VARIABLE", "CARD", "TAX", "PAYROLL", "TOOL", "ADS", "LOAN", "OTHER",
] as const;
const RECURRENCES = [
  "NONE", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "CUSTOM",
] as const;
const STATUS = ["pendente", "pago", "cancelado"] as const;

const Schema = z.object({
  id: z.string().optional(),
  description: z.string().trim().min(1, "Informe o nome da despesa."),
  notes: z.string().trim().nullable(), // "descrição" detalhada
  amount: z.number().positive("Informe o valor da despesa."),
  dueDate: z.date({ invalid_type_error: "Informe o vencimento." }),
  recurrence: z.enum(RECURRENCES).default("NONE"),
  recurrenceInterval: z.number().int().min(1).max(24).nullable(), // CUSTOM (meses)
  status: z.enum(STATUS).default("pendente"),
  expenseType: z.enum(EXPENSE_TYPES).default("OTHER"),
  // Tipo CARTÃO
  cardId: z.string().nullable(),
  cardInvoiceMonth: z.number().int().min(1).max(12).nullable(),
  cardInvoiceYear: z.number().int().min(1990).max(2100).nullable(),
  // Edição de recorrente: "one" (só esta) | "future" (esta e as próximas)
  scope: z.enum(["one", "future"]).default("one"),
});


/** Intervalo em meses de cada recorrência. */
function intervalOf(rec: (typeof RECURRENCES)[number], custom: number | null): number {
  switch (rec) {
    case "MONTHLY": return 1;
    case "QUARTERLY": return 3;
    case "SEMIANNUAL": return 6;
    case "ANNUAL": return 12;
    case "CUSTOM": return Math.max(1, custom ?? 1);
    default: return 0;
  }
}

function addMonths(d: Date, m: number): Date {
  const day = d.getDate();
  const out = new Date(d.getFullYear(), d.getMonth() + m, 1);
  const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, lastDay));
  return out;
}

export async function saveExpense(formData: FormData): Promise<ActionResult> {
  await requirePermission("despesas.editar");
  try {
    const dueRaw = clean(formData.get("dueDate"));
    const invoiceRef = parseMonthParam(clean(formData.get("cardInvoiceRef"))); // "YYYY-MM"
    const parsed = Schema.parse({
      id: clean(formData.get("id")) ?? undefined,
      description: String(formData.get("description") ?? "").trim(),
      notes: clean(formData.get("notes")),
      amount: parseBRL(String(formData.get("amount") ?? "0")),
      dueDate: dueRaw ? parseDateBR(dueRaw) : null,
      recurrence: (clean(formData.get("recurrence")) ?? "NONE") as any,
      recurrenceInterval: (() => {
        const raw = clean(formData.get("recurrenceInterval"));
        return raw == null ? null : parseInt(raw, 10);
      })(),
      status: (clean(formData.get("status")) ?? "pendente") as any,
      expenseType: (clean(formData.get("expenseType")) ?? "OTHER") as any,
      cardId: clean(formData.get("cardId")),
      cardInvoiceMonth: invoiceRef?.month ?? null,
      cardInvoiceYear: invoiceRef?.year ?? null,
      scope: (clean(formData.get("scope")) ?? "one") as any,
    });

    const isCard = parsed.expenseType === "CARD";
    const base = {
      description: parsed.description,
      notes: parsed.notes,
      amount: parsed.amount,
      type: "despesa" as const,
      origin: isCard ? "cartao" : "debito",
      status: parsed.status,
      date: parsed.dueDate, // data de referência acompanha o vencimento
      dueDate: parsed.dueDate,
      expenseType: parsed.expenseType,
      recurrence: parsed.recurrence === "NONE" ? null : parsed.recurrence,
      recurrenceInterval:
        parsed.recurrence === "CUSTOM" ? parsed.recurrenceInterval ?? 1 : null,
      cardId: isCard ? parsed.cardId : null,
      cardInvoiceMonth: isCard ? parsed.cardInvoiceMonth : null,
      cardInvoiceYear: isCard ? parsed.cardInvoiceYear : null,
    };

    if (parsed.id) {
      // ===== Edição =====
      const existing = await prisma.transaction.findUnique({ where: { id: parsed.id } });
      if (!existing) return { ok: false, error: "Despesa não encontrada." };

      if (parsed.scope === "future" && existing.recurrenceGroupId) {
        // Esta e as próximas ocorrências do grupo (não pagas).
        // Uma única query em lote (antes: 1 updateMany POR ocorrência).
        // status/vencimento de cada ocorrência são preservados.
        await prisma.transaction.updateMany({
          where: {
            recurrenceGroupId: existing.recurrenceGroupId,
            dueDate: { gte: existing.dueDate ?? existing.date },
            status: { not: "pago" },
          },
          data: {
            description: base.description,
            notes: base.notes,
            amount: base.amount,
            expenseType: base.expenseType,
            cardId: base.cardId,
          },
        });
      } else {
        await prisma.transaction.update({ where: { id: parsed.id }, data: base });
      }
    } else {
      // ===== Criação (+ materialização da recorrência) =====
      const interval = intervalOf(parsed.recurrence, parsed.recurrenceInterval);
      const first = await prisma.transaction.create({
        data: { ...base, belongsTo: "empresa" },
      });

      if (interval > 0) {
        // Grupo = id da primeira ocorrência; horizonte de 12 meses.
        const occurrences: any[] = [];
        for (let m = interval; m < 12 + interval; m += interval) {
          if (m > 12) break;
          const due = addMonths(parsed.dueDate, m);
          occurrences.push({
            ...base,
            belongsTo: "empresa",
            status: "pendente", // futuras sempre nascem pendentes
            date: due,
            dueDate: due,
            recurrenceGroupId: first.id,
          });
        }
        await prisma.transaction.update({
          where: { id: first.id },
          data: { recurrenceGroupId: first.id },
        });
        if (occurrences.length > 0) {
          await prisma.transaction.createMany({ data: occurrences });
        }
      }
    }

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
  await requirePermission("despesas.marcar_como_paga");
  try {
    await prisma.transaction.updateMany({ where: { id }, data: { status } });
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar o status." };
  }
}
