import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { salvarDespesa, type ExpenseInput } from "@/lib/services/expense-service";
import { setExpenseStatus } from "@/lib/engines/expense-engine";
import { type DomainContext, inDomain } from "@/lib/engines/domain";
import { ApiError } from "../auth";
import { dataSchema } from "../http";
import { auditar, dataCivil, falhaDoDominio, valor } from "./write-common";
import { detalharDespesaApi } from "./expenses";

/**
 * ESCRITAS DE DESPESA NA API. Cadastro/edição = `salvarDespesa` (a mesma do
 * formulário: tipo, recorrência materializada em transação); PAGAR = motor
 * `setExpenseStatus` (permissão, guarda de período, auditoria, evento).
 *
 * Contrato mais estreito que a tela, de propósito:
 *  · despesa nasce PENDENTE — pagar é o gesto próprio (/pay), que passa pela
 *    guarda de período; criar já paga pularia essa guarda;
 *  · cartão de crédito (fatura) fica fora da V1;
 *  · PATCH só em despesa em aberto e só nesta ocorrência (não reescreve a
 *    série da recorrência nem despesa paga/cancelada).
 */

const TIPOS = ["FIXED", "VARIABLE", "TAX", "PAYROLL", "TOOL", "ADS", "LOAN", "OTHER"] as const;
const RECORRENCIAS = ["NONE", "MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "CUSTOM"] as const;

export const ExpenseCreateBody = z
  .object({
    description: z.string().trim().min(1, "Informe a descrição da despesa.").max(200),
    amount: valor,
    dueDate: dataSchema,
    /** Categoria: id ou nome (uma das duas). */
    categoryId: z.string().trim().max(64).nullable().optional(),
    category: z.string().trim().max(100).optional(),
    type: z.enum(TIPOS).default("OTHER"),
    recurrence: z.enum(RECORRENCIAS).default("NONE"),
    /** Meses entre ocorrências quando `recurrence = CUSTOM` (1 a 24). */
    recurrenceInterval: z.number().int().min(1).max(24).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((b) => !(b.categoryId && b.category), "Use categoryId OU category, não os dois.");

export const ExpensePatchBody = z
  .object({
    description: z.string().trim().min(1).max(200).optional(),
    amount: valor.optional(),
    dueDate: dataSchema.optional(),
    categoryId: z.string().trim().max(64).nullable().optional(),
    category: z.string().trim().max(100).optional(),
    type: z.enum(TIPOS).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    status: z
      .undefined({ invalid_type_error: "O status não se altera por PATCH: para pagar, use POST /expenses/{id}/pay." })
      .optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Envie ao menos um campo para alterar.")
  .refine((b) => !(b.categoryId && b.category), "Use categoryId OU category, não os dois.");

async function resolverCategoria(categoryId?: string | null, nome?: string): Promise<string | null | undefined> {
  if (nome) {
    const c = await prisma.category.findFirst({ where: { name: { equals: nome, mode: "insensitive" } }, select: { id: true } });
    if (!c) throw new ApiError(404, "not_found", `Categoria “${nome}” não encontrada.`);
    return c.id;
  }
  if (categoryId) {
    const c = await prisma.category.findFirst({ where: { id: categoryId }, select: { id: true } });
    if (!c) throw new ApiError(404, "not_found", "Categoria não encontrada.");
    return c.id;
  }
  return categoryId === null ? null : undefined;
}

const SNAPSHOT = {
  id: true, type: true, description: true, notes: true, amount: true, dueDate: true, date: true, status: true,
  expenseType: true, categoryId: true, recurrence: true, recurrenceInterval: true, recurrenceGroupId: true,
  cardId: true, cardInvoiceMonth: true, cardInvoiceYear: true,
} as const;

export async function criarDespesaApi(ctx: DomainContext, b: z.output<typeof ExpenseCreateBody>) {
  const categoryId = await inDomain(ctx, async () => (await resolverCategoria(b.categoryId, b.category)) ?? null);
  const input: ExpenseInput = {
    description: b.description,
    notes: b.notes ?? null,
    amount: b.amount,
    dueDate: dataCivil(b.dueDate),
    recurrence: b.recurrence,
    recurrenceInterval: b.recurrence === "CUSTOM" ? b.recurrenceInterval ?? 1 : null,
    status: "pendente",
    expenseType: b.type,
    categoryId,
    cardId: null,
    cardInvoiceMonth: null,
    cardInvoiceYear: null,
    scope: "one",
  };
  const r = await salvarDespesa(ctx, input);
  if (!r.ok) throw falhaDoDominio(r);
  await auditar(ctx, { tipo: "CREATE", entity: "Transaction", id: r.id!, motivo: "Despesa lançada pela API" });
  return (await inDomain(ctx, async () => await detalharDespesaApi(r.id!)))!;
}

export async function atualizarDespesaApi(ctx: DomainContext, id: string, b: z.output<typeof ExpensePatchBody>) {
  const atual = await inDomain(ctx, async () => await prisma.transaction.findFirst({ where: { id, type: "despesa" }, select: SNAPSHOT }));
  if (!atual) throw new ApiError(404, "not_found", "Despesa não encontrada.");
  // Só em aberto ("pendente"). Paga/cancelada/devendo: edite na tela — a
  // API não reescreve fato de caixa nem converte o status legado.
  if (atual.status !== "pendente") {
    throw new ApiError(422, "invalid_state", `Despesa com status “${atual.status}” não é editada pela API.`);
  }
  if (atual.expenseType === "CARD") throw new ApiError(422, "invalid_state", "Despesa de cartão não é editada pela API na V1.");
  const categoria = await inDomain(ctx, async () => await resolverCategoria(b.categoryId, b.category));
  const input: ExpenseInput = {
    id,
    description: b.description ?? atual.description,
    notes: b.notes !== undefined ? b.notes : atual.notes,
    amount: b.amount ?? Number(atual.amount),
    dueDate: b.dueDate ? dataCivil(b.dueDate) : (atual.dueDate ?? atual.date),
    recurrence: (atual.recurrence ?? "NONE") as ExpenseInput["recurrence"],
    recurrenceInterval: atual.recurrenceInterval,
    status: "pendente",
    expenseType: (b.type ?? atual.expenseType ?? "OTHER") as ExpenseInput["expenseType"],
    categoryId: categoria !== undefined ? categoria : atual.categoryId,
    cardId: atual.cardId,
    cardInvoiceMonth: atual.cardInvoiceMonth,
    cardInvoiceYear: atual.cardInvoiceYear,
    scope: "one",
  };
  const r = await salvarDespesa(ctx, input);
  if (!r.ok) throw falhaDoDominio(r);
  const depois = await inDomain(ctx, async () => await prisma.transaction.findFirst({ where: { id }, select: SNAPSHOT }));
  await auditar(ctx, {
    tipo: "UPDATE", entity: "Transaction", id,
    antes: atual as Record<string, unknown>, depois: (depois ?? {}) as Record<string, unknown>,
    motivo: "Despesa atualizada pela API",
  });
  return (await inDomain(ctx, async () => await detalharDespesaApi(id)))!;
}

export const ExpensePayBody = z.object({}).strict();

export async function pagarDespesaApi(ctx: DomainContext, id: string) {
  const atual = await inDomain(ctx, async () =>
    await prisma.transaction.findFirst({ where: { id, type: "despesa" }, select: { id: true, status: true } })
  );
  if (!atual) throw new ApiError(404, "not_found", "Despesa não encontrada.");
  if (atual.status === "cancelado") throw new ApiError(422, "invalid_state", "Despesa cancelada não é paga.");
  const jaPaga = atual.status === "pago";
  if (!jaPaga) {
    const r = await inDomain(ctx, async () => await setExpenseStatus(id, "pago", { reason: "Paga pela API" }));
    if (!r.ok) throw falhaDoDominio(r);
  }
  return { alreadyPaid: jaPaga, expense: (await inDomain(ctx, async () => await detalharDespesaApi(id)))! };
}
