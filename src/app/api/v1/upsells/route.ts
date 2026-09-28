import { z } from "zod";
import { defineEndpoint, idSchema, metaDePaginacao, paginacao } from "@/lib/api/http";
import { listarUpsellsApi, UPSELL_STATUSES } from "@/lib/api/v1/upsells";
import { UpsellCreateBody, criarUpsellApi } from "@/lib/api/v1/upsells-write";
import { revalidateCatalog, revalidateFinance } from "@/lib/revalidate";

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

export const GET = defineEndpoint({ action: "upsells.list", scope: "upsells.read", query: Query }, async ({ query }) => {
  const r = await listarUpsellsApi(query);
  return { data: r.itens, meta: { ...metaDePaginacao(query.page, query.pageSize, r.total), totalValue: r.totalValue } };
});

/** POST /api/v1/upsells — nova oportunidade (funil aberto). */
export const POST = defineEndpoint(
  { action: "upsells.create", scope: "upsells.create", write: { operation: "upsells.create" }, body: UpsellCreateBody },
  async ({ ctx, body }) => {
    const u = await criarUpsellApi(ctx, body);
    revalidateCatalog();
    revalidateFinance();
    return { status: 201, data: u, audit: { entityType: "Upsell", entityId: u.id, label: u.client.name, amount: u.value } };
  }
);
