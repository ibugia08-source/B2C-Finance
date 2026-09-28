import { z } from "zod";
import { competenciaSchema, defineEndpoint } from "@/lib/api/http";
import { competenciaAtual, relatorioMensal } from "@/lib/api/v1/insights";

/** GET /api/v1/reports/monthly?competence=AAAA-MM (padrão: a competência atual). */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint(
  { action: "reports.monthly", scope: "reports.read", query: z.object({ competence: competenciaSchema.optional() }).strict() },
  async ({ query, auth }) => {
    const r = await relatorioMensal(query.competence ?? competenciaAtual(), auth.scopes);
    return { data: r.data, meta: { omittedSections: r.omitted } };
  }
);
