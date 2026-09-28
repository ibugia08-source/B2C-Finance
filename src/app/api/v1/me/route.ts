import { apiJson, withApiAuth } from "@/lib/api/auth";

/**
 * GET /api/v1/me — quem é esta credencial. Qualquer token válido acessa (sem
 * scope): é o "teste de conexão" do n8n. Não devolve dado de negócio.
 */
export const dynamic = "force-dynamic";

export const GET = withApiAuth(null, async (_req, auth, { correlationId }) =>
  apiJson(
    {
      data: {
        type: "service_account",
        id: auth.serviceAccountId,
        name: auth.name,
        tokenPrefix: auth.tokenPrefix,
        scopes: auth.scopes,
      },
    },
    { correlationId }
  )
);
