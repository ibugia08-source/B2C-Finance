import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { defineEndpoint } from "@/lib/api/http";
import { SCOPE_REQUIRES_PERMISSIONS, scopesDoUsuario } from "@/lib/api/scopes";
import { resolverIdentidade } from "@/lib/services/messaging-identities";
import { mascararIdentificador } from "@/lib/messaging/channels";

/**
 * POST /api/v1/integrations/resolve-identity — QUEM está falando.
 *
 * Canais: TELEGRAM (externalIdentifier = Telegram User ID, só dígitos — o
 * @username NÃO identifica) e WHATSAPP (telefone).
 *
 * A integração manda só o canal e o identificador; a API devolve o
 * usuário VINCULADO a ele no B2C Finance e o que a integração pode fazer em
 * nome dele. Nada de userId no corpo (campo desconhecido = 400): quem decide
 * o usuário é o vínculo cadastrado pelo administrador, nunca o chamador nem a
 * IA. POST (e não GET) para o telefone não ir para URL e logs de acesso.
 *
 * Nas chamadas seguintes, mande `X-B2C-Identity: <identityId>` — a API
 * recorta os scopes pelo RBAC do usuário e registra-o como ator.
 */
export const dynamic = "force-dynamic";

const Body = z
  .object({
    channel: z.enum(["TELEGRAM", "WHATSAPP"]),
    /**
     * TELEGRAM: Telegram User ID (message.from.id), só dígitos.
     * WHATSAPP: telefone como veio (qualquer formatação; país obrigatório fora do Brasil).
     */
    externalIdentifier: z.union([z.string(), z.number().int().positive()]).transform((v) => String(v).trim()).pipe(z.string().min(1).max(40)),
  })
  .strict()
  .superRefine((b, c) => {
    if (b.channel === "TELEGRAM" && !/^[1-9][0-9]{0,15}$/.test(b.externalIdentifier)) {
      c.addIssue({ code: "custom", path: ["externalIdentifier"], message: "Telegram: use o Telegram User ID (só números), nunca o @username." });
    }
    if (b.channel === "WHATSAPP" && b.externalIdentifier.length < 8) {
      c.addIssue({ code: "custom", path: ["externalIdentifier"], message: "WhatsApp: telefone com DDD." });
    }
  });

export const POST = defineEndpoint(
  { action: "identities.resolve", scope: "identities.resolve", body: Body },
  async ({ auth, body }) => {
    const r = await resolverIdentidade(body.channel, body.externalIdentifier);
    if (!r) throw new ApiError(404, "identity_not_found", "Identificador não vinculado a um usuário ativo do B2C Finance.");
    if (r.user.dataScope === "AGENCY") {
      throw new ApiError(403, "agency_scope_not_supported", "Usuário restrito a uma agência: o atendimento pela integração ainda não aplica esse recorte.");
    }
    const allowedScopes = scopesDoUsuario(auth.scopes, r.pode);
    // Só as permissões que importam para a integração (não o RBAC inteiro).
    const relevantes = [...new Set(Object.values(SCOPE_REQUIRES_PERMISSIONS).flat())].filter(r.pode).sort();
    return {
      data: {
        authorized: true,
        identityId: r.identityId,
        channel: r.channel,
        user: { id: r.user.id, name: r.user.name, role: r.user.role, roleLabel: r.user.roleLabel },
        permissions: relevantes,
        allowedScopes,
        delegation: { header: "X-B2C-Identity", value: r.identityId },
      },
      audit: {
        entityType: "MessagingIdentity",
        entityId: r.identityId,
        label: r.user.name,
        metadata: { canal: r.channel, identificador: mascararIdentificador(r.channel, r.externalIdentifier) },
      },
    };
  }
);
