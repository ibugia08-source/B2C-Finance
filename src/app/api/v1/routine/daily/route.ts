import { defineEndpoint } from "@/lib/api/http";
import { rotinaDoDiaApi } from "@/lib/api/v1/insights";

/**
 * GET /api/v1/routine/daily — a rotina do dia da tela /rotina. Seções fora
 * dos scopes da conta vêm vazias (os gates da rotina seguem os scopes).
 */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint({ scope: "routine.read" }, async ({ ctx }) => ({ data: await rotinaDoDiaApi(ctx) }));
