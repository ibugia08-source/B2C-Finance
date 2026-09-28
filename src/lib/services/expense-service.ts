import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { type DomainContext, type DomainResult, inDomain } from "@/lib/engines/domain";

/**
 * CADASTRO DE DESPESA — regra de domínio (extraída de actions/expenses.ts em
 * 27/09/2026, sem mudança de comportamento): tipo, cartão + fatura, edição
 * "só esta"/"esta e as próximas" e materialização da recorrência (12 meses,
 * mesmo recurrenceGroupId). Pagar continua no motor (expense-engine
 * .setExpenseStatus, com guarda de permissão e período).
 * Não invalida cache: quem chama chama `revalidateFinance()`.
 */

const EXPENSE_TYPES = [
  "FIXED", "VARIABLE", "CARD", "TAX", "PAYROLL", "TOOL", "ADS", "LOAN", "OTHER",
] as const;
const RECURRENCES = [
  "NONE", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "CUSTOM",
] as const;
export const EXPENSE_STATUS = ["pendente", "pago", "cancelado"] as const;
const STATUS = EXPENSE_STATUS;

export const ExpenseInputSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().min(1, "Informe o nome da despesa."),
  notes: z.string().trim().nullable(), // "descrição" detalhada
  amount: z.number().positive("Informe o valor da despesa."),
  dueDate: z.date({ invalid_type_error: "Informe o vencimento." }),
  recurrence: z.enum(RECURRENCES).default("NONE"),
  recurrenceInterval: z.number().int().min(1).max(24).nullable(), // CUSTOM (meses)
  status: z.enum(STATUS).default("pendente"),
  expenseType: z.enum(EXPENSE_TYPES).default("OTHER"),
  categoryId: z.string().nullable(),
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

export type ExpenseInput = z.input<typeof ExpenseInputSchema>;

/** Cria (sem `id`) ou edita (com `id`) uma despesa. */
export async function salvarDespesa(ctx: DomainContext, input: ExpenseInput): Promise<DomainResult> {
  const parsed = ExpenseInputSchema.parse(input);
  return inDomain(ctx, async () => {
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
        categoryId: parsed.categoryId,
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
    return { ok: true };
  });
}
