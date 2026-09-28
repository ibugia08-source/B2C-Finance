import { z } from "zod";
import { defineEndpoint, idSchema, naoEncontrado } from "@/lib/api/http";
import { detalharDespesaApi } from "@/lib/api/v1/expenses";
import { ExpensePatchBody, atualizarDespesaApi } from "@/lib/api/v1/expenses-write";
import { revalidateFinance } from "@/lib/revalidate";

/** GET /api/v1/expenses/:id */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint(
  { action: "expenses.get", scope: "expenses.read", params: z.object({ id: idSchema }) },
  async ({ params }) => {
    const d = await detalharDespesaApi(params.id);
    if (!d) throw naoEncontrado("Despesa");
    return { data: d, audit: { entityType: "Transaction", entityId: d.id, label: d.description, amount: d.amount } };
  }
);

/** PATCH /api/v1/expenses/:id — só despesa em aberto, só esta ocorrência. */
export const PATCH = defineEndpoint(
  {
    action: "expenses.update",
    scope: "expenses.update",
    write: { operation: "expenses.update" },
    params: z.object({ id: idSchema }),
    body: ExpensePatchBody,
  },
  async ({ ctx, params, body }) => {
    const d = await atualizarDespesaApi(ctx, params.id, body);
    revalidateFinance();
    return { data: d, audit: { entityType: "Transaction", entityId: d.id, label: d.description, amount: d.amount } };
  }
);
