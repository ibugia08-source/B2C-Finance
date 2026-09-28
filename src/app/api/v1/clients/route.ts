import { z } from "zod";
import { competenciaSchema, defineEndpoint, metaDePaginacao, paginacao } from "@/lib/api/http";
import { CLIENT_STATUSES, competenciaAtual } from "@/lib/api/v1/common";
import { listarClientesApi } from "@/lib/api/v1/clients";

/**
 * GET /api/v1/clients — carteira da competência (status pela linha do tempo).
 * Sem `status`: todos menos Perdido (CHURNED), como a tela.
 */
export const dynamic = "force-dynamic";

const Query = z
  .object({
    competence: competenciaSchema.optional(),
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum([...CLIENT_STATUSES, "revenue_active", "all"]).optional(),
    modality: z.enum(["MRR", "TCV"]).optional(),
    responsible: z.string().trim().min(1).max(100).optional(),
    delinquency: z.enum(["paid", "owing", "no_billing"]).optional(),
    renewalMonth: competenciaSchema.optional(),
    segment: z.string().trim().min(1).max(100).optional(),
    ...paginacao,
  })
  .strict();

export const GET = defineEndpoint({ action: "clients.list", scope: "clients.read", query: Query }, async ({ query }) => {
  const competence = query.competence ?? competenciaAtual();
  const r = await listarClientesApi({ ...query, competence });
  return {
    data: r.itens,
    meta: { ...metaDePaginacao(query.page, query.pageSize, r.total), statusReference: r.statusReference },
  };
});
