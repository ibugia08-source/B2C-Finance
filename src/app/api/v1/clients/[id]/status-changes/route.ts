import { z } from "zod";
import { defineEndpoint, idSchema } from "@/lib/api/http";
import { StatusChangeBody, alterarStatusApi } from "@/lib/api/v1/clients-write";
import { revalidateClientStatus } from "@/lib/revalidate";

/**
 * POST /api/v1/clients/:id/status-changes — novo status A PARTIR DE uma data
 * (linha do tempo). Hoje: vale já; futura: fica programada; mês passado:
 * exige "allowRetroactive": true. Competência fechada é recusada.
 */
export const dynamic = "force-dynamic";

export const POST = defineEndpoint(
  {
    action: "client_status.change",
    scope: "client_status.write",
    write: { operation: "client_status.change" },
    params: z.object({ id: idSchema }),
    body: StatusChangeBody,
  },
  async ({ ctx, params, body }) => {
    const r = await alterarStatusApi(ctx, params.id, body);
    revalidateClientStatus(params.id);
    return {
      status: 201,
      data: r,
      audit: { entityType: "Client", entityId: params.id, metadata: { status: body.status, effectiveFrom: body.effectiveFrom } },
    };
  }
);
