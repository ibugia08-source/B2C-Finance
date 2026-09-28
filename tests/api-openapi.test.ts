import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { buildOpenApiSpec } from "@/lib/api/openapi";
import { API_SCOPES } from "@/lib/api/scopes";
import { GET as getSpec } from "@/app/api/openapi.json/route";
import { GET as getDocs } from "@/app/api/docs/route";

/**
 * A DOCUMENTAÇÃO NÃO PODE DIVERGIR DO CÓDIGO (28/09/2026).
 *  · toda rota de src/app/api/v1 está na especificação, e vice-versa;
 *  · o scope documentado é o que o código exige (lido do defineEndpoint);
 *  · docs/api/openapi.json é exatamente o que a fonte gera;
 *  · a especificação não aceita ownerId nem carrega token real.
 */

const RAIZ = join(process.cwd(), "src/app/api/v1");
const spec = buildOpenApiSpec() as any;

function rotas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return rotas(p);
    return n === "route.ts" ? [p] : [];
  });
}
const caminho = (arquivo: string) =>
  "/" + relative(RAIZ, arquivo).split(sep).slice(0, -1).join("/").replace(/\[(\w+)\]/g, "{$1}");

describe("OpenAPI × rotas", () => {
  const arquivos = rotas(RAIZ);

  it("cada rota tem path na especificação e cada path tem rota", () => {
    const doCodigo = arquivos.map(caminho).sort();
    expect(Object.keys(spec.paths).sort()).toEqual(doCodigo);
  });

  it("cada método exportado está documentado, com o scope que o código exige", () => {
    for (const a of arquivos) {
      const fonte = readFileSync(a, "utf8");
      const metodos = [...fonte.matchAll(/export const (GET|POST|PATCH|PUT|DELETE) = defineEndpoint\(\s*\{([\s\S]*?)\}\s*,\s*async/g)];
      expect(metodos.length, `nenhum defineEndpoint em ${a}`).toBeGreaterThan(0);
      const documentados = Object.keys(spec.paths[caminho(a)]).sort();
      expect(documentados, caminho(a)).toEqual(metodos.map((m) => m[1].toLowerCase()).sort());
      for (const [, metodo, opcoes] of metodos) {
        const m = /scope:\s*(null|"([a-z_.]+)")/.exec(opcoes);
        expect(m, `sem scope em ${metodo} ${a}`).not.toBeNull();
        const doCodigo = m![1] === "null" ? null : m![2];
        const op = spec.paths[caminho(a)][metodo.toLowerCase()];
        expect(op["x-required-scope"], `${metodo} ${caminho(a)}`).toBe(doCodigo);
        expect(op.security).toEqual([{ bearerAuth: doCodigo ? [doCodigo] : [] }]);
        if (doCodigo) expect(API_SCOPES).toContain(doCodigo);
        // Escrita documenta a Idempotency-Key obrigatória e o corpo.
        if (/write:/.test(opcoes)) {
          expect(op.parameters.map((p: any) => p.$ref)).toContain("#/components/parameters/IdempotencyKey");
          expect(op.requestBody?.required).toBe(true);
        }
      }
    }
  });

  it("docs/api/openapi.json está atualizado (rode npm run openapi:export)", () => {
    const versionado = JSON.parse(readFileSync(join(process.cwd(), "docs/api/openapi.json"), "utf8"));
    expect(versionado).toEqual(JSON.parse(JSON.stringify(spec)));
  });

  it("nenhum parâmetro ownerId; nenhum token real; OpenAPI 3.1 com Bearer", () => {
    const txt = JSON.stringify(spec);
    for (const p of Object.values<any>(spec.paths)) {
      for (const op of Object.values<any>(p)) {
        const nomes = (op.parameters ?? []).map((x: any) => x.name ?? x.$ref);
        expect(nomes.join(",")).not.toMatch(/owner/i);
        const corpo = JSON.stringify(op.requestBody ?? {});
        expect(corpo).not.toMatch(/ownerId/);
      }
    }
    // Nenhum schema de corpo aceita ownerId.
    for (const nome of ["ClientCreate", "ClientPatch", "StatusChange", "PaymentCreate", "ExpenseCreate", "ExpensePatch", "UpsellCreate", "UpsellPatch"]) {
      expect(Object.keys(spec.components.schemas[nome].properties ?? {})).not.toContain("ownerId");
    }
    expect(txt).not.toMatch(/b2c_(live|test)_[a-z0-9]{8}_[A-Za-z0-9_-]{43}/);
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(spec.info.description).toMatch(/Idempotency-Key/);
    expect(spec.info.description).toMatch(/ownerId/);
    expect(spec.info.description).toMatch(/vigência/);
  });

  it("GET /api/openapi.json devolve a especificação com o host da chamada", async () => {
    const res = getSpec(new Request("https://exemplo.test/api/openapi.json"));
    const body = await res.json();
    expect(body.servers[0].url).toBe("https://exemplo.test/api/v1");
    expect(Object.keys(body.paths)).toContain("/search");
  });

  it("GET /api/docs: Swagger UI com versão fixa, SRI e CSP", async () => {
    const res = getDocs();
    const html = await res.text();
    expect(html).toMatch(/swagger-ui-dist@\d+\.\d+\.\d+\/swagger-ui-bundle\.js" integrity="sha384-/);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self' https://cdn.jsdelivr.net");
    expect(html).not.toMatch(/<script>[^<]/); // nenhum script inline
  });
});
