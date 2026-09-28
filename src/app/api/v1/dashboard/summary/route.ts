import { z } from "zod";
import { competenciaSchema, defineEndpoint } from "@/lib/api/http";
import { competenciaAtual, indicadoresDaCompetencia } from "@/lib/api/v1/insights";

/** GET /api/v1/dashboard/summary?competence=AAAA-MM — indicadores oficiais do mês. */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint(
  { scope: "dashboard.read", query: z.object({ competence: competenciaSchema.optional() }).strict() },
  async ({ query }) => ({ data: await indicadoresDaCompetencia(query.competence ?? competenciaAtual()) })
);
