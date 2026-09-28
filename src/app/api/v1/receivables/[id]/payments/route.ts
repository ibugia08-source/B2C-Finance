import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { defineEndpoint, idSchema } from "@/lib/api/http";
import { PaymentBody, registrarPagamentoApi } from "@/lib/api/v1/payments-write";
import { revalidateAgency, revalidateFinance } from "@/lib/revalidate";

/**
 * POST /api/v1/receivables/:id/payments — registra pagamento na cobrança
 * (motor de Recebimentos). Validações: dono, estado, valor, data,
 * competência do caixa e duplicidade — ver lib/api/v1/payments-write.
 */
export const dynamic = "force-dynamic";

export const POST = defineEndpoint(
  {
    action: "payments.register",
    scope: "receivables.register_payment",
    write: { operation: "payments.register" },
    params: z.object({ id: idSchema }),
    body: PaymentBody,
  },
  async ({ ctx, params, body, auth, idempotencyKey }) => {
    if (!idempotencyKey) throw new ApiError(400, "idempotency_key_required", "Idempotency-Key obrigatória.");
    const r = await registrarPagamentoApi(ctx, params.id, body, {
      serviceAccountId: auth.serviceAccountId,
      idempotencyKey,
    });
    revalidateAgency({ clientId: r.clientId });
    revalidateFinance(); // pagamento gera receita/caixa
    return {
      status: 201,
      data: r.data,
      audit: { entityType: "Billing", entityId: params.id, label: r.clientName, amount: body.amount, metadata: { paymentId: r.data.payment.id } },
    };
  }
);
