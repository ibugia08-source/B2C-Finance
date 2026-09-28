import { z } from "zod";
import { defineEndpoint, idSchema } from "@/lib/api/http";
import { ExpensePayBody, pagarDespesaApi } from "@/lib/api/v1/expenses-write";
import { revalidateFinance } from "@/lib/revalidate";

/**
 * POST /api/v1/expenses/:id/pay — marca como paga (motor: guarda de período,
 * auditoria, evento). Já paga → 200 com "alreadyPaid": true (nada muda).
 */
export const dynamic = "force-dynamic";

export const POST = defineEndpoint(
  {
    action: "expenses.pay",
    scope: "expenses.pay",
    write: { operation: "expenses.pay" },
    params: z.object({ id: idSchema }),
    body: ExpensePayBody,
  },
  async ({ ctx, params }) => {
    const r = await pagarDespesaApi(ctx, params.id);
    if (!r.alreadyPaid) revalidateFinance();
    return {
      data: r,
      audit: { entityType: "Transaction", entityId: params.id, label: r.expense.description, amount: r.expense.amount },
    };
  }
);
