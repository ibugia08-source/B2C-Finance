import { z } from "zod";
import { competenciaSchema, defineEndpoint, idSchema, naoEncontrado } from "@/lib/api/http";
import { detalharClienteApi } from "@/lib/api/v1/clients";
import { ClientPatchBody, atualizarClienteApi } from "@/lib/api/v1/clients-write";
import { revalidateAgency } from "@/lib/revalidate";

/** GET /api/v1/clients/:id — cadastro, status (hoje e, opcional, na competência) e financeiro. */
export const dynamic = "force-dynamic";

export const GET = defineEndpoint(
  {
    action: "clients.get", scope: "clients.read",
    params: z.object({ id: idSchema }),
    query: z.object({ competence: competenciaSchema.optional() }).strict(),
  },
  async ({ params, query }) => {
    const c = await detalharClienteApi(params.id, query.competence);
    if (!c) throw naoEncontrado("Cliente");
    return { data: c, audit: { entityType: "Client", entityId: c.id, label: c.name } };
  }
);

/**
 * PATCH /api/v1/clients/:id — cadastro (sem status: status muda só por
 * POST /clients/:id/status-changes, com vigência).
 */
export const PATCH = defineEndpoint(
  {
    action: "clients.update",
    scope: "clients.update",
    write: { operation: "clients.update" },
    params: z.object({ id: idSchema }),
    body: ClientPatchBody,
  },
  async ({ ctx, params, body }) => {
    const c = await atualizarClienteApi(ctx, params.id, body);
    revalidateAgency({ clientId: c.id });
    return { data: c, audit: { entityType: "Client", entityId: c.id, label: c.name, metadata: { fields: Object.keys(body) } } };
  }
);
