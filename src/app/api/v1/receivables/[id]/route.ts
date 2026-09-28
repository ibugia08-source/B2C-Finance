import { z } from "zod";
import { defineEndpoint, idSchema, naoEncontrado } from "@/lib/api/http";
import { detalharRecebivelApi } from "@/lib/api/v1/receivables";

/** GET /api/v1/receivables/:id — a cobrança e os pagamentos dela. */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint(
  { scope: "receivables.read", params: z.object({ id: idSchema }) },
  async ({ params }) => {
    const r = await detalharRecebivelApi(params.id);
    if (!r) throw naoEncontrado("Recebimento");
    return { data: r };
  }
);
