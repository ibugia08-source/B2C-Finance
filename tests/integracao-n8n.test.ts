import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { buildOpenApiSpec } from "@/lib/api/openapi";
import { API_SCOPES } from "@/lib/api/scopes";

/**
 * INTEGRAÇÃO n8n (28/09/2026) — o que está versionado em integrations/n8n
 * não pode divergir da API nem vazar segredo:
 *  · o catálogo de ferramentas tem as 11 de leitura pedidas, cada uma
 *    apontando para um GET que EXISTE na OpenAPI, com o scope que a rota
 *    exige e só parâmetros que a rota aceita;
 *  · os workflows usam só essas ferramentas, só GET contra a API, a URL
 *    vinda de variável e credencial por referência;
 *  · nenhum arquivo contém token, chave ou id real de credencial.
 */

const RAIZ = join(process.cwd(), "integrations/n8n");
const ler = (p: string) => JSON.parse(readFileSync(join(RAIZ, p), "utf8"));
const catalogo = ler("schemas/agent-tools.json");
const spec = buildOpenApiSpec() as any;

const ESPERADAS = [
  "buscar_clientes", "consultar_cliente", "consultar_status_cliente", "consultar_dashboard",
  "consultar_recebimentos", "consultar_despesas", "consultar_caixa", "consultar_upsells",
  "consultar_rotina", "gerar_relatorio_diario", "gerar_relatorio_mensal",
];

/** Nomes dos parâmetros de query de uma operação da OpenAPI (resolvendo $ref). */
function queryDaOperacao(op: any): string[] {
  return (op.parameters ?? [])
    .map((p: any) => (p.$ref ? spec.components.parameters[p.$ref.split("/").pop()] : p))
    .filter((p: any) => p.in === "query")
    .map((p: any) => p.name);
}

describe("catálogo de ferramentas do agente", () => {
  it("tem exatamente as 11 ferramentas de leitura pedidas", () => {
    expect(catalogo.readOnly).toBe(true);
    expect(catalogo.tools.map((t: any) => t.name).sort()).toEqual([...ESPERADAS].sort());
  });

  it("cada ferramenta aponta para um GET da OpenAPI, com o scope e os parâmetros da rota", () => {
    for (const t of catalogo.tools) {
      expect(t.http.method, t.name).toBe("GET");
      const op = spec.paths[t.http.path]?.get;
      expect(op, `${t.name}: ${t.http.path} não existe na OpenAPI`).toBeTruthy();
      expect(t.scope, t.name).toBe(op["x-required-scope"]);
      expect(API_SCOPES).toContain(t.scope);
      expect(t.scope.endsWith(".read"), `${t.name} não é de leitura`).toBe(true);
      const aceitos = queryDaOperacao(op);
      for (const q of [...t.http.query, ...Object.keys(t.http.fixedQuery ?? {})]) {
        expect(aceitos, `${t.name}: query "${q}" não existe em GET ${t.http.path}`).toContain(q);
      }
      for (const p of t.http.pathParams ?? []) expect(t.http.path).toContain(`{${p}}`);
      // Entrada do modelo = parâmetros de rota + query (nem mais, nem menos).
      const entrada = Object.keys(t.inputSchema.properties).sort();
      expect(entrada, t.name).toEqual([...(t.http.pathParams ?? []), ...t.http.query].sort());
      expect(t.inputSchema.additionalProperties).toBe(false);
      for (const r of t.inputSchema.required ?? []) expect(entrada).toContain(r);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it("o catálogo segue o próprio JSON Schema (campos e formatos essenciais)", () => {
    const meta = ler("schemas/agent-tools.schema.json");
    expect(meta.$schema).toContain("json-schema.org");
    for (const k of meta.required) expect(catalogo).toHaveProperty(k);
    const nome = new RegExp(meta.properties.tools.items.properties.name.pattern);
    for (const t of catalogo.tools) {
      expect(nome.test(t.name), t.name).toBe(true);
      for (const k of meta.properties.tools.items.required) expect(t, t.name).toHaveProperty(k);
      for (const k of Object.keys(t)) expect(Object.keys(meta.properties.tools.items.properties)).toContain(k);
    }
  });
});

describe("workflows versionados", () => {
  const arquivos = readdirSync(join(RAIZ, "workflows")).filter((f) => f.endsWith(".json"));

  it("seguem a convenção de nome <área>.<propósito>.v<N>.json", () => {
    expect(arquivos.sort()).toEqual(["agente-whatsapp.consulta.v1.json", "sistema.teste-conexao.v1.json"]);
    for (const f of arquivos) expect(f).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+\.v\d+\.json$/);
  });

  it("estrutura íntegra: nomes únicos, conexões para nós que existem, desativados", () => {
    for (const f of arquivos) {
      const wf = ler(`workflows/${f}`);
      const nomes = wf.nodes.map((n: any) => n.name);
      expect(new Set(nomes).size, f).toBe(nomes.length);
      for (const [origem, saidas] of Object.entries<any>(wf.connections)) {
        expect(nomes, `${f}: origem ${origem}`).toContain(origem);
        for (const lista of Object.values<any>(saidas)) for (const ramo of lista) for (const c of ramo) {
          expect(nomes, `${f}: destino ${c.node}`).toContain(c.node);
        }
      }
      expect(wf.active).toBe(false);
      expect(wf).not.toHaveProperty("id");
    }
  });

  it("o agente usa só as ferramentas do catálogo, só GET, URL por variável e credencial por referência", () => {
    const wf = ler("workflows/agente-whatsapp.consulta.v1.json");
    const ferramentas = wf.nodes.filter((n: any) => n.type === "@n8n/n8n-nodes-langchain.toolHttpRequest");
    expect(ferramentas.map((n: any) => n.name).sort()).toEqual([...ESPERADAS].sort());
    for (const n of ferramentas) {
      const t = catalogo.tools.find((x: any) => x.name === n.name);
      expect(n.parameters.method).toBe("GET");
      expect(n.parameters.url).toBe(`={{ $env.B2C_FINANCE_API_URL }}${t.http.path}`);
      expect(n.parameters.toolDescription).toBe(t.description);
      expect(n.credentials.httpHeaderAuth).toEqual({ id: "CONFIGURAR_NO_N8N", name: "B2C Finance API" });
      const cab = n.parameters.parametersHeaders.values.find((h: any) => h.name === "X-B2C-Source");
      expect(cab.value).toBe("whatsapp");
      // Toda ferramenta está ligada ao agente.
      expect(wf.connections[n.name].ai_tool[0][0].node).toBe("Agente B2C Finance");
    }
    // Nenhum nó HTTP do workflow escreve na API do B2C (só o envio ao WhatsApp é POST).
    for (const n of wf.nodes.filter((x: any) => x.type === "n8n-nodes-base.httpRequest")) {
      if (String(n.parameters.url).includes("B2C_FINANCE_API_URL")) expect(n.parameters.method ?? "GET").toBe("GET");
      else expect(String(n.parameters.url)).toContain("WHATSAPP_API_URL");
    }
  });

  it("segurança antes do agente: assinatura HMAC em tempo constante, raw body e lista de números", () => {
    const wf = ler("workflows/agente-whatsapp.consulta.v1.json");
    const webhook = wf.nodes.find((n: any) => n.name === "WhatsApp Webhook");
    expect(webhook.parameters.options.rawBody).toBe(true);
    const codigo = wf.nodes.find((n: any) => n.name === "Validar assinatura e extrair mensagem").parameters.jsCode;
    expect(codigo).toContain("x-hub-signature-256");
    expect(codigo).toContain("timingSafeEqual");
    expect(codigo).toContain("WHATSAPP_WEBHOOK_SECRET");
    expect(codigo).toContain("WHATSAPP_ALLOWED_NUMBERS");
    expect(wf.connections["Validar assinatura e extrair mensagem"].main[0][0].node).toBe("Número autorizado?");
    // O ramo "não autorizado" não passa pelo agente.
    expect(wf.connections["Número autorizado?"].main[1][0].node).toBe("Responder número não autorizado");
    // O prompt versionado é o que está no agente.
    const prompt = readFileSync(join(RAIZ, "examples/system-prompt.md"), "utf8").trim();
    expect(wf.nodes.find((n: any) => n.name === "Agente B2C Finance").parameters.options.systemMessage).toBe(prompt);
  });

  it("o teste de conexão confere exatamente os scopes que o catálogo usa", () => {
    const wf = ler("workflows/sistema.teste-conexao.v1.json");
    const codigo = wf.nodes.find((n: any) => n.name === "Conferir scopes").parameters.jsCode;
    const usados = [...new Set(catalogo.tools.map((t: any) => t.scope))].sort();
    expect(codigo).toContain(JSON.stringify(usados));
  });
});

describe("sem segredo versionado", () => {
  it("check-secrets não acha nada; ENV.example só tem placeholders das variáveis pedidas", async () => {
    const { verificar } = await import("../integrations/n8n/scripts/check-secrets.mjs");
    expect(verificar()).toEqual([]);
    const env = readFileSync(join(RAIZ, "ENV.example"), "utf8");
    for (const v of ["B2C_FINANCE_API_URL", "B2C_FINANCE_API_TOKEN", "WHATSAPP_API_URL", "WHATSAPP_API_TOKEN", "OPENAI_API_KEY"]) {
      expect(env).toMatch(new RegExp(`^${v}=`, "m"));
    }
    expect(env).toMatch(/^B2C_FINANCE_API_TOKEN=b2c_live_XXXXXXXX_COLE/m);
  });
});
