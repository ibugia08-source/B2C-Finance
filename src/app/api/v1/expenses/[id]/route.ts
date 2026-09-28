import { z } from "zod";
import { defineEndpoint, idSchema, naoEncontrado } from "@/lib/api/http";
import { detalharDespesaApi } from "@/lib/api/v1/expenses";

/** GET /api/v1/expenses/:id */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint(
  { scope: "expenses.read", params: z.object({ id: idSchema }) },
  async ({ params }) => {
    const d = await detalharDespesaApi(params.id);
    if (!d) throw naoEncontrado("Despesa");
    return { data: d };
  }
);
