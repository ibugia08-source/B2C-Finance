import { z } from "zod";
import { defineEndpoint } from "@/lib/api/http";
import { listarDestinatarios } from "@/lib/services/messaging-identities";
import { FINALIDADES } from "@/lib/messaging/notifications";
import { todayKey } from "@/lib/competence";
import { WORKSPACE_TIMEZONE } from "@/lib/format";

/**
 * GET /api/v1/integrations/recipients — QUEM recebe um envio proativo
 * (relatório da manhã/noite ou um aviso) num canal.
 *
 * Só quem tem a preferência LIGADA no vínculo (Configurações → Integrações →
 * Canais): ninguém recebe por estar vinculado. Vínculo e usuário ativos;
 * usuário restrito a uma agência fica de fora.
 *
 * Cada destinatário traz o `identityId`: o relatório dele é montado com
 * `X-B2C-Identity`, ou seja, com o RBAC DELE (quem não vê o caixa não recebe
 * o caixa). `today` e `timezone` são os da API — o workflow não calcula o
 * "hoje" por conta própria.
 */
export const dynamic = "force-dynamic";

const Query = z
  .object({
    channel: z.enum(["TELEGRAM", "WHATSAPP"]),
    purpose: z.enum(FINALIDADES as unknown as [string, ...string[]]),
  })
  .strict();

export const GET = defineEndpoint(
  { action: "identities.recipients", scope: "identities.resolve", query: Query },
  async ({ query }) => {
    const recipients = await listarDestinatarios(query.channel, query.purpose as (typeof FINALIDADES)[number]);
    return {
      data: {
        channel: query.channel,
        purpose: query.purpose,
        timezone: WORKSPACE_TIMEZONE,
        today: todayKey(),
        recipients,
      },
      audit: { metadata: { canal: query.channel, finalidade: query.purpose, destinatarios: recipients.length } },
    };
  }
);
