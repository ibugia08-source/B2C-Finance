import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { dataSchema, defineEndpoint, metaDePaginacao, paginacao } from "@/lib/api/http";
import { competenciaAtual, intervaloDaCompetencia, intervaloDeDias } from "@/lib/api/v1/common";
import { EXPENSE_STATUSES, listarDespesasApi } from "@/lib/api/v1/expenses";
import { ExpenseCreateBody, criarDespesaApi } from "@/lib/api/v1/expenses-write";
import { revalidateFinance } from "@/lib/revalidate";

/**
 * GET /api/v1/expenses — despesas pela data do lançamento (padrão: mês atual).
 * `category` aceita o id ou o nome da categoria.
 */
export const dynamic = "force-dynamic";

const Query = z
  .object({
    status: z.enum(EXPENSE_STATUSES).optional(),
    dateFrom: dataSchema.optional(),
    dateTo: dataSchema.optional(),
    category: z.string().trim().min(1).max(100).optional(),
    ...paginacao,
  })
  .strict();

export const GET = defineEndpoint({ action: "expenses.list", scope: "expenses.read", query: Query }, async ({ query }) => {
  if ((query.dateFrom || query.dateTo) && !(query.dateFrom && query.dateTo)) {
    throw new ApiError(400, "validation_error", "Informe dateFrom e dateTo juntos.");
  }
  const periodo = query.dateFrom
    ? intervaloDeDias(query.dateFrom, query.dateTo!)
    : intervaloDaCompetencia(competenciaAtual());
  const r = await listarDespesasApi({ ...query, periodo });
  return {
    data: r.itens,
    meta: {
      ...metaDePaginacao(query.page, query.pageSize, r.total),
      window: {
        dateFrom: periodo.gte.toISOString().slice(0, 10),
        dateTo: new Date(periodo.lt.getTime() - 86_400_000).toISOString().slice(0, 10),
      },
      totalAmount: r.totalAmount,
    },
  };
});

/** POST /api/v1/expenses — lança despesa (nasce pendente; pagar é /pay). */
export const POST = defineEndpoint(
  { action: "expenses.create", scope: "expenses.create", write: { operation: "expenses.create" }, body: ExpenseCreateBody },
  async ({ ctx, body }) => {
    const d = await criarDespesaApi(ctx, body);
    revalidateFinance();
    return { status: 201, data: d, audit: { entityType: "Transaction", entityId: d.id, label: d.description, amount: d.amount } };
  }
);
