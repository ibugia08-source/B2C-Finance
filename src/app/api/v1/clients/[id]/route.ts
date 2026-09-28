import { z } from "zod";
import { competenciaSchema, defineEndpoint, idSchema, naoEncontrado } from "@/lib/api/http";
import { detalharClienteApi } from "@/lib/api/v1/clients";

/** GET /api/v1/clients/:id — cadastro, status (hoje e, opcional, na competência) e financeiro. */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint(
  {
    scope: "clients.read",
    params: z.object({ id: idSchema }),
    query: z.object({ competence: competenciaSchema.optional() }).strict(),
  },
  async ({ params, query }) => {
    const c = await detalharClienteApi(params.id, query.competence);
    if (!c) throw naoEncontrado("Cliente");
    return { data: c };
  }
);
