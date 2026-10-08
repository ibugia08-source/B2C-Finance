import { z } from "zod";
import { defineEndpoint, idSchema } from "@/lib/api/http";
import { RemoveReceivableBody, removerCobrancaDoMesApi } from "@/lib/api/v1/receivables-remove";
import { revalidateAgency, revalidateFinance } from "@/lib/revalidate";

export const dynamic = "force-dynamic";

export const POST = defineEndpoint(
  {
    action: "receivables.remove_from_month",
    scope: "receivables.remove_from_month",
    write: { operation: "receivables.remove_from_month" },
    params: z.object({ id: idSchema }),
    body: RemoveReceivableBody,
  },
  async ({ ctx, params, body }) => {
    const r = await removerCobrancaDoMesApi(ctx, params.id, body);
    revalidateAgency({ clientId: r.clientId });
    revalidateFinance();
    return {
      status: 200,
      data: r.data,
      audit: { entityType: "Billing", entityId: params.id, label: r.clientName, amount: r.amount, metadata: { reason: body.reason } },
    };
  }
);
