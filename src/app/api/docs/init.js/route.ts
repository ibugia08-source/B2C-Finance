/**
 * Inicialização do Swagger UI em arquivo próprio (não inline) para o CSP de
 * /api/docs não precisar de 'unsafe-inline' em scripts.
 * "Try it out" fica LIGADO: o token é colado em "Authorize" e só vive na aba
 * (persistAuthorization desligado — não fica salvo no navegador).
 */
export const dynamic = "force-static";

const JS = `window.ui = SwaggerUIBundle({
  url: "/api/openapi.json",
  dom_id: "#swagger-ui",
  deepLinking: true,
  persistAuthorization: false,
  displayRequestDuration: true,
  docExpansion: "list",
  defaultModelsExpandDepth: 0,
});`;

export function GET() {
  return new Response(JS, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
