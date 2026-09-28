import { defineEndpoint } from "@/lib/api/http";
import { resumoDoCaixa } from "@/lib/api/v1/insights";

/** GET /api/v1/cash/summary — disponível, compromissos e projeção (mesma fonte do /caixa). */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint({ action: "cash.summary", scope: "cash.read" }, async () => ({ data: await resumoDoCaixa() }));
