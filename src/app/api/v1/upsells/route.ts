import { z } from "zod";
import { defineEndpoint, idSchema, metaDePaginacao, paginacao } from "@/lib/api/http";
import { listarUpsellsApi, UPSELL_STATUSES } from "@/lib/api/v1/upsells";

/**
 * GET /api/v1/upsells — oportunidades. O responsável é gravado como NOME
 * (texto livre) no B2C Finance; por isso o filtro é `responsible`, não um id.
 */
export const dynamic = "force-dynamic";

const Query = z
  .object({
    status: z.enum(UPSELL_STATUSES).optional(),
    clientId: idSchema.optional(),
    responsible: z.string().trim().min(1).max(100).optional(),
    ...paginacao,
  })
  .strict();

export const GET = defineEndpoint({ scope: "upsells.read", query: Query }, async ({ query }) => {
  const r = await listarUpsellsApi(query);
  return { data: r.itens, meta: { ...metaDePaginacao(query.page, query.pageSize, r.total), totalValue: r.totalValue } };
});
