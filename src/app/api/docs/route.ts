/**
 * GET /api/docs — Swagger UI da API V1, sem dependência nova: os arquivos do
 * swagger-ui-dist vêm do jsDelivr com VERSÃO FIXA e hash de integridade
 * (SRI). Se o arquivo do CDN mudar, o navegador recusa carregar. O CSP desta
 * página só libera o próprio site e esse CDN.
 */
export const dynamic = "force-static";

const VERSAO = "5.17.14";
const CDN = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${VERSAO}`;
const SRI_CSS = "sha384-wxLW6kwyHktdDGr6Pv1zgm/VGJh99lfUbzSn6HNHBENZlCN7W602k9VkGdxuFvPn";
const SRI_JS = "sha384-wmyclcVGX/WhUkdkATwhaK1X1JtiNrr2EoYJ+diV3vj4v6OC5yCeSu+yW13SYJep";

const HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>B2C Finance API · Docs</title>
  <meta name="robots" content="noindex" />
  <link rel="stylesheet" href="${CDN}/swagger-ui.css" integrity="${SRI_CSS}" crossorigin="anonymous" />
  <style>body{margin:0;background:#fff}.topbar{display:none}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${CDN}/swagger-ui-bundle.js" integrity="${SRI_JS}" crossorigin="anonymous"></script>
  <script src="/api/docs/init.js"></script>
</body>
</html>`;

export function GET() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": [
        "default-src 'self'",
        `script-src 'self' https://cdn.jsdelivr.net`,
        `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`,
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'self'",
      ].join("; "),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
