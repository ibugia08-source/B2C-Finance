import { z } from "zod";
import { defineEndpoint, idSchema, naoEncontrado } from "@/lib/api/http";
import { historicoDeStatusApi } from "@/lib/api/v1/clients";

/** GET /api/v1/clients/:id/status-history — intervalos de vigência do status. */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint(
  { scope: "client_status.read", params: z.object({ id: idSchema }) },
  async ({ params }) => {
    const h = await historicoDeStatusApi(params.id);
    if (!h) throw naoEncontrado("Cliente");
    return { data: h };
  }
);
