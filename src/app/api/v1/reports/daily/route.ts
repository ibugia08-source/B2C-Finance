import { z } from "zod";
import { dataSchema, defineEndpoint } from "@/lib/api/http";
import { relatorioDiario } from "@/lib/api/v1/insights";
import { todayKey } from "@/lib/competence";

/** GET /api/v1/reports/daily?date=AAAA-MM-DD (padrão: hoje). */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint(
  { action: "reports.daily", scope: "reports.read", query: z.object({ date: dataSchema.optional() }).strict() },
  async ({ query, auth }) => {
    const r = await relatorioDiario(query.date ?? todayKey(), auth.scopes);
    return { data: r.data, meta: { omittedSections: r.omitted } };
  }
);
