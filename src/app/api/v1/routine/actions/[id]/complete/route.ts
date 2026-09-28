import { z } from "zod";
import { defineEndpoint } from "@/lib/api/http";
import { concluirAcaoApi } from "@/lib/api/v1/routine-write";
import { revalidateAgency } from "@/lib/revalidate";

/**
 * POST /api/v1/routine/actions/:id/complete — conclui uma ação da rotina de
 * hoje. :id = a chave da ação em GET /routine/daily (ex.: "cobrar:cm…",
 * codificada na URL). Só muda o estado do dia; não mexe em cliente nem valor.
 */
export const dynamic = "force-dynamic";

const chave = z
  .string()
  .transform((v) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  })
  .pipe(z.string().min(1).max(200).regex(/^[A-Za-z0-9:_.-]+$/, "Chave de ação inválida."));

export const POST = defineEndpoint(
  {
    action: "routine.complete",
    scope: "routine.write",
    write: { operation: "routine.complete" },
    params: z.object({ id: chave }),
    body: z.object({}).strict(),
  },
  async ({ ctx, params }) => {
    const r = await concluirAcaoApi(ctx, params.id);
    if (!r.alreadyDone) revalidateAgency();
    return { data: r, audit: { entityType: "RoutineAction", entityId: r.key, label: r.text } };
  }
);
