import { buildOpenApiSpec } from "@/lib/api/openapi";

/**
 * GET /api/openapi.json — especificação OpenAPI 3.1 da API V1. Pública:
 * descreve o contrato, não contém dado nem segredo (o n8n e o Swagger UI
 * leem daqui). O servidor aponta para o host que atendeu a chamada.
 */
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const host = new URL(req.url).origin;
  return new Response(JSON.stringify(buildOpenApiSpec(`${host}/api/v1`), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
