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
  const AGENTE = "workflows/b2c-finance-ai-agent-readonly.json";
  const N_AGENTE = "AI Agent B2C Finance (somente leitura)";

  it("existem o agente somente leitura e o teste de conexão", () => {
    expect(arquivos.sort()).toEqual(["b2c-finance-ai-agent-readonly.json", "sistema.teste-conexao.v1.json"]);
  });

  it("estrutura íntegra: nomes únicos, conexões para nós que existem, desativados, sem id", () => {
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

  it("fluxo: webhook → assinatura → normalizar → identificar → resolver → agente → interpretar → WhatsApp", () => {
    const wf = ler(AGENTE);
    const prox = (n: string, saida = 0) => wf.connections[n].main[saida][0].node;
    expect(prox("Webhook WhatsApp (POST)")).toBe("Validar assinatura (Meta)");
    expect(prox("Validar assinatura (Meta)")).toBe("Normalizar payload");
    expect(prox("Normalizar payload")).toBe("Identificar número");
    expect(prox("Identificar número")).toBe("Resolver usuário e permissões");
    expect(prox("Resolver usuário e permissões")).toBe("Usuário autorizado?");
    expect(prox("Usuário autorizado?", 0)).toBe("Mensagem de texto?");
    expect(prox("Usuário autorizado?", 1)).toBe("Resposta: número não autorizado"); // não passa pelo agente
    expect(prox("Mensagem de texto?", 0)).toBe("Montar contexto do agente");
    expect(prox("Montar contexto do agente")).toBe(N_AGENTE);
    expect(prox(N_AGENTE)).toBe("Interpretar resposta do agente");
    expect(prox("Interpretar resposta do agente")).toBe("Responder no WhatsApp");
  });

  it("ferramentas: só as do catálogo, só GET na API, travadas pelo perfil, credencial por referência", () => {
    const wf = ler(AGENTE);
    const ferramentas = wf.nodes.filter((n: any) => n.type === "@n8n/n8n-nodes-langchain.toolHttpRequest");
    expect(ferramentas.map((n: any) => n.name).sort()).toEqual([...ESPERADAS].sort());
    for (const n of ferramentas) {
      const t = catalogo.tools.find((x: any) => x.name === n.name);
      expect(n.parameters.method).toBe("GET");
      expect(n.parameters.url).toBe(
        `={{ ($json.allowedTools || []).includes('${t.name}') ? $env.B2C_FINANCE_API_URL : 'https://ferramenta-nao-liberada-para-este-perfil.invalid' }}${t.http.path}`
      );
      expect(n.parameters.toolDescription).toBe(t.description);
      expect(n.credentials.httpHeaderAuth).toEqual({ id: "CONFIGURAR_B2C_FINANCE_API", name: "B2C Finance API" });
      expect(n.parameters.parametersHeaders.values.find((h: any) => h.name === "X-B2C-Source").value).toBe("whatsapp");
      expect(wf.connections[n.name].ai_tool[0][0].node).toBe(N_AGENTE);
    }
  });

  it("nunca acessa banco, Supabase ou Prisma: só a API do B2C e a do WhatsApp", () => {
    const wf = ler(AGENTE);
    // Só o que EXECUTA (tipo, URL, código, expressões) — as notas explicativas
    // citam "Supabase/Prisma" justamente para proibir.
    const executavel = wf.nodes
      .filter((n: any) => n.type !== "n8n-nodes-base.stickyNote")
      .map((n: any) => {
        const { notes, ...resto } = n;
        const p = { ...resto.parameters, options: { ...(resto.parameters?.options ?? {}), systemMessage: undefined } };
        return { ...resto, parameters: p };
      });
    const texto = JSON.stringify(executavel).toLowerCase();
    for (const proibido of ["supabase", "prisma", "postgres", "mysql", "mongodb", "redis", "database_url", "postgres_url"]) {
      expect(texto, proibido).not.toContain(proibido);
    }
    const permitidos = new Set([
      "n8n-nodes-base.webhook", "n8n-nodes-base.code", "n8n-nodes-base.if", "n8n-nodes-base.httpRequest",
      "n8n-nodes-base.respondToWebhook", "n8n-nodes-base.stickyNote",
      "@n8n/n8n-nodes-langchain.agent", "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "@n8n/n8n-nodes-langchain.memoryBufferWindow", "@n8n/n8n-nodes-langchain.toolHttpRequest",
    ]);
    for (const n of wf.nodes) expect(permitidos.has(n.type), `${n.name}: ${n.type}`).toBe(true);
    for (const n of wf.nodes.filter((x: any) => x.type === "n8n-nodes-base.httpRequest")) {
      expect(String(n.parameters.url)).toContain("WHATSAPP_API_URL"); // o único HTTP "de saída" é a resposta
    }
  });

  it("segurança antes do agente: HMAC em tempo constante, raw body, repetidas, diretório de usuários", () => {
    const wf = ler(AGENTE);
    const js = (nome: string) => wf.nodes.find((n: any) => n.name === nome).parameters.jsCode as string;
    expect(wf.nodes.find((n: any) => n.name === "Webhook WhatsApp (POST)").parameters.options.rawBody).toBe(true);
    expect(js("Validar assinatura (Meta)")).toMatch(/x-hub-signature-256[\s\S]*timingSafeEqual/);
    expect(js("Validar assinatura (Meta)")).toContain("WHATSAPP_WEBHOOK_SECRET");
    expect(js("Identificar número")).toContain("$getWorkflowStaticData");
    expect(js("Resolver usuário e permissões")).toContain("B2C_WHATSAPP_USERS");
  });

  it("perfis: toda ferramenta citada existe; admin tem todas; perfil embutido = schemas/user-profiles.json", () => {
    const perfis = ler("schemas/user-profiles.json").profiles;
    const nomes = catalogo.tools.map((t: any) => t.name);
    for (const [perfil, p] of Object.entries<any>(perfis)) {
      for (const t of p.tools) expect(nomes, `${perfil}: ${t}`).toContain(t);
    }
    expect([...perfis.admin.tools].sort()).toEqual([...nomes].sort());
    const js = ler(AGENTE).nodes.find((n: any) => n.name === "Resolver usuário e permissões").parameters.jsCode as string;
    for (const [perfil, p] of Object.entries<any>(perfis)) {
      expect(js).toContain(`"${perfil}"`);
      for (const t of p.tools) expect(js).toContain(`"${t}"`);
    }
  });

  it("o prompt versionado está no agente, com as regras pedidas; o workflow tem notas", () => {
    const wf = ler(AGENTE);
    const prompt = readFileSync(join(RAIZ, "examples/system-prompt.md"), "utf8").trim();
    const sistema = wf.nodes.find((n: any) => n.name === N_AGENTE).parameters.options.systemMessage as string;
    expect(sistema.startsWith("=" + prompt)).toBe(true);
    for (const regra of ["ÚNICA fonte operacional", "Não invente dados", "Não invente IDs", "buscar_clientes` PRIMEIRO", "Alpha", "SOMENTE LEITURA", "insufficient_scope"]) {
      expect(prompt, regra).toContain(regra);
    }
    expect(sistema).toContain("{{ $json.allowedTools.join(', ') }}");
    expect(wf.nodes.filter((n: any) => n.type === "n8n-nodes-base.stickyNote").length).toBeGreaterThanOrEqual(4);
    for (const n of wf.nodes.filter((x: any) => x.type !== "n8n-nodes-base.stickyNote" && x.name !== "Responder desafio da Meta")) {
      expect(n.notes, `nó sem nota: ${n.name}`).toBeTruthy();
    }
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
    for (const v of ["B2C_FINANCE_API_URL", "B2C_FINANCE_API_TOKEN", "WHATSAPP_API_URL", "WHATSAPP_API_TOKEN", "OPENAI_API_KEY", "B2C_WHATSAPP_USERS"]) {
      expect(env).toMatch(new RegExp(`^${v}=`, "m"));
    }
    expect(env).toMatch(/^B2C_FINANCE_API_TOKEN=b2c_live_XXXXXXXX_COLE/m);
  });
});
