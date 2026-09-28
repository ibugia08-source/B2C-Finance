import { runWithOwner } from "@/lib/auth/owner-scope";
import { resolverPorId } from "@/lib/services/messaging-identities";
import { ApiError, type ApiAuth } from "./auth";
import { scopesDoUsuario } from "./scopes";

/**
 * DELEGAÇÃO POR IDENTIDADE (28/09/2026) — header `X-B2C-Identity`.
 *
 * A integração (n8n) resolveu o número do WhatsApp em POST
 * /integrations/resolve-identity e recebeu o id do VÍNCULO. Nas chamadas
 * seguintes ela manda esse id, e a API:
 *  · exige que a conta de serviço tenha `identities.resolve`;
 *  · carrega o vínculo NO DONO DA CONTA (outro workspace = inválido), ativo,
 *    com usuário ativo — nada disso vem do chamador ou da IA;
 *  · recorta os scopes: conta ∩ RBAC do usuário (`SCOPE_REQUIRES_PERMISSIONS`).
 *    O usuário nunca ganha mais do que a conta, nem a conta mais do que ele;
 *  · registra o usuário como ator na trilha (ApiActivity.actorUserId).
 *
 * Usuário restrito a UMA agência é recusado: a API de leitura ainda não
 * aplica o recorte por agência, e mostrar a carteira inteira a quem só vê
 * uma agência seria vazar dado.
 */
export async function delegar(auth: ApiAuth, identityId: string): Promise<ApiAuth> {
  if (!auth.scopes.includes("identities.resolve")) {
    throw new ApiError(403, "insufficient_scope", "Esta integração não pode agir em nome de usuários (scope identities.resolve).", "identities.resolve");
  }
  const r = await runWithOwner(auth.ownerId, async () => await resolverPorId(identityId.trim()));
  if (!r) throw new ApiError(403, "invalid_identity", "Identidade não vinculada, desativada ou de outro workspace.");
  if (r.user.dataScope === "AGENCY") {
    throw new ApiError(
      403,
      "agency_scope_not_supported",
      "Usuário restrito a uma agência: o atendimento pela integração ainda não aplica esse recorte."
    );
  }
  const scopes = scopesDoUsuario(auth.scopes, r.pode);
  const sa = auth.principal.kind === "system" ? auth.principal.serviceAccount : undefined;
  return {
    ...auth,
    scopes,
    principal:
      auth.principal.kind === "system"
        ? { ...auth.principal, name: `${auth.principal.name} por ${r.user.name}`, serviceAccount: sa ? { ...sa, scopes } : undefined }
        : auth.principal,
    delegacao: { identityId: r.identityId, userId: r.user.id, userName: r.user.name, scopesDaConta: auth.scopes },
  };
}
