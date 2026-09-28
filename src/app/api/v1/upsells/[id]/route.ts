import { z } from "zod";
import { defineEndpoint, idSchema, naoEncontrado } from "@/lib/api/http";
import { detalharUpsellApi } from "@/lib/api/v1/upsells";
import { UpsellPatchBody, atualizarUpsellApi } from "@/lib/api/v1/upsells-write";
import { revalidateCatalog, revalidateFinance } from "@/lib/revalidate";

export const dynamic = "force-dynamic";

/** GET /api/v1/upsells/:id */
export const GET = defineEndpoint(
  { action: "upsells.get", scope: "upsells.read", params: z.object({ id: idSchema }) },
  async ({ params }) => {
    const u = await detalharUpsellApi(params.id);
    if (!u) throw naoEncontrado("Oportunidade");
    return { data: u, audit: { entityType: "Upsell", entityId: u.id, label: u.client.name, amount: u.value } };
  }
);

/** PATCH /api/v1/upsells/:id — só oportunidade em aberto; não decide o funil. */
export const PATCH = defineEndpoint(
  {
    action: "upsells.update",
    scope: "upsells.update",
    write: { operation: "upsells.update" },
    params: z.object({ id: idSchema }),
    body: UpsellPatchBody,
  },
  async ({ ctx, params, body }) => {
    const u = await atualizarUpsellApi(ctx, params.id, body);
    revalidateCatalog();
    revalidateFinance();
    return { data: u, audit: { entityType: "Upsell", entityId: u.id, label: u.client.name, amount: u.value } };
  }
);
