import { z } from "zod";
import { defineEndpoint } from "@/lib/api/http";
import { consultarAcao, serializarAcao } from "@/lib/api/agent/pending-actions";

/**
 * GET /api/v1/agent/pending-actions/:id — a ação, se for DO USUÁRIO do
 * vínculo (X-B2C-Identity). De outro usuário, de outro vínculo ou de outro
 * workspace = 404. Vencida é lida como EXPIRED.
 *
 * Usada pelo Telegram antes de confirmar/cancelar pelo botão: o id do
 * callback é só uma referência — quem decide se vale é a API (e a
 * confirmação confere tudo de novo).
 */
export const dynamic = "force-dynamic";

const Params = z.object({ id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Id inválido.") });

export const GET = defineEndpoint(
  { action: "agent_actions.get", scope: "agent_actions.manage", params: Params },
  async ({ auth, params }) => {
    const a = await consultarAcao(auth, params.id);
    return { data: serializarAcao(a) };
  }
);
