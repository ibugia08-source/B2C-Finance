import { z } from "zod";
import { defineEndpoint } from "@/lib/api/http";
import { CancelamentoBody, cancelarAcao, serializarAcao } from "@/lib/api/agent/pending-actions";

/** POST /api/v1/agent/pending-actions/:id/cancel — o usuário respondeu "NÃO". Nada é executado. */
export const dynamic = "force-dynamic";

const Params = z.object({ id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Id inválido.") });

export const POST = defineEndpoint(
  { action: "agent_actions.cancel", scope: "agent_actions.manage", params: Params, body: CancelamentoBody },
  async ({ auth, params, body }) => {
    const a = await cancelarAcao(auth, params.id, body.messageId ?? null);
    return {
      data: { ...serializarAcao(a), message: "Cancelado. Nada foi alterado." },
      audit: { entityType: "PendingAction", entityId: a.id, metadata: { operation: a.operation } },
    };
  }
);
