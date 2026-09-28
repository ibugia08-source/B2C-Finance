import { z } from "zod";
import { defineEndpoint } from "@/lib/api/http";
import { buscarClientesApi } from "@/lib/api/v1/search";

/**
 * GET /api/v1/search?q=face%20love&type=client — desambiguação para o agente.
 * Ignora acento, caixa e espaço; devolve só o necessário para escolher.
 */
export const dynamic = "force-dynamic";

const Query = z
  .object({
    q: z.string().trim().min(2, "Digite ao menos 2 caracteres.").max(100),
    type: z.enum(["client"]).default("client"),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  })
  .strict();

export const GET = defineEndpoint({ scope: "clients.read", query: Query }, async ({ query }) => {
  const r = await buscarClientesApi(query.q, query.limit);
  return { data: r.results, meta: { query: query.q, type: query.type, total: r.total } };
});
