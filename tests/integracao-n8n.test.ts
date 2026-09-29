import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { buildOpenApiSpec } from "@/lib/api/openapi";
import { API_SCOPES } from "@/lib/api/scopes";
import { OPERACOES_BLOQUEADAS, OPERACOES_DE_ESCRITA, chaveDaConfirmacao } from "@/lib/api/agent/catalog";
import { CORPO_DA_OPERACAO } from "@/lib/api/agent/preview";

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
  it("tem as 11 ferramentas de leitura pedidas + consultar_inadimplencia (Telegram, 29/09/2026)", () => {
    expect(catalogo.readOnly).toBe(true);
    expect(catalogo.tools.map((t: any) => t.name).sort()).toEqual([...ESPERADAS, "consultar_inadimplencia"].sort());
    const inad = catalogo.tools.find((t: any) => t.name === "consultar_inadimplencia");
    expect(inad).toMatchObject({ scope: "receivables.read", userPermission: "recebimentos.ver_inadimplencia", channels: ["telegram"] });
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

  it("existem o agente, os dois relatórios diários e o teste de conexão", () => {
    expect(arquivos.sort()).toEqual([
      "b2c-finance-ai-agent-readonly.json", "b2c-finance-ai-agent.json", "b2c-finance-telegram-agent-readonly.json",
      "b2c-finance-telegram-agent.json", "daily-evening-report.json", "daily-morning-report.json", "knowledge-ingest.json",
      "sistema.teste-conexao.v1.json", "telegram-connection-test.json", "telegram-daily-evening-report.json",
      "telegram-daily-morning-report.json",
    ]);
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
    expect(prox("Identificar número")).toBe("API: resolver identidade");
    expect(prox("API: resolver identidade")).toBe("Carregar permissões");
    expect(prox("Carregar permissões")).toBe("Usuário autorizado?");
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
      // Delegação: toda ferramenta leva o vínculo resolvido pela API.
      expect(n.parameters.parametersHeaders.values.find((h: any) => h.name === "X-B2C-Identity").value).toBe("={{ $json.identityId }}");
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
    // HTTP fora das ferramentas: só a resolução de identidade (API B2C) e o envio ao WhatsApp.
    for (const n of wf.nodes.filter((x: any) => x.type === "n8n-nodes-base.httpRequest")) {
      const url = String(n.parameters.url);
      expect(url === "={{ $env.B2C_FINANCE_API_URL }}/integrations/resolve-identity" || url.includes("WHATSAPP_API_URL"), url).toBe(true);
    }
  });

  it("segurança antes do agente: HMAC em tempo constante, raw body, repetidas, diretório de usuários", () => {
    const wf = ler(AGENTE);
    const js = (nome: string) => wf.nodes.find((n: any) => n.name === nome).parameters.jsCode as string;
    expect(wf.nodes.find((n: any) => n.name === "Webhook WhatsApp (POST)").parameters.options.rawBody).toBe(true);
    expect(js("Validar assinatura (Meta)")).toMatch(/x-hub-signature-256[\s\S]*timingSafeEqual/);
    expect(js("Validar assinatura (Meta)")).toContain("WHATSAPP_WEBHOOK_SECRET");
    expect(js("Identificar número")).toContain("$getWorkflowStaticData");
    // Identidade vem da API, pelo NÚMERO — nenhum userId sai do workflow.
    const resolve = wf.nodes.find((n: any) => n.name === "API: resolver identidade");
    expect(resolve.parameters.method).toBe("POST");
    expect(resolve.parameters.jsonBody).toBe("={{ JSON.stringify({ channel: 'WHATSAPP', externalIdentifier: '+' + $json.from }) }}");
    expect(resolve.parameters.jsonBody).not.toMatch(/userId/);
    expect(resolve.onError).toBe("continueRegularOutput");
    expect(JSON.stringify(wf)).not.toContain("B2C_WHATSAPP_USERS");
  });

  it("permissões vêm da API: ferramenta liberada = scope devolvido em allowedScopes", async () => {
    const wf = ler(AGENTE);
    const js = wf.nodes.find((n: any) => n.name === "Carregar permissões").parameters.jsCode as string;
    // WhatsApp: as ferramentas do canal (a de inadimplência, por ora, é só do Telegram).
    for (const t of catalogo.tools.filter((x: any) => !x.channels || x.channels.includes("whatsapp"))) expect(js).toContain(`"${t.name}": "${t.scope}"`);
    expect(js).not.toContain("consultar_inadimplencia");
    const msg = { from: "5571999990000", text: "oi", tipo: "text", phoneNumberId: "P" };
    const $ = () => ({ all: () => [{ json: msg }] });
    const rodar = (resposta: any) =>
      new Function("$", "$input", `return (async () => { ${js} })();`)($, { all: () => [{ json: resposta }] });
    const ok = await rodar({
      success: true,
      data: { identityId: "idv1", user: { id: "u1", name: "Raiane", roleLabel: "Financeiro" }, allowedScopes: ["clients.read", "receivables.read"] },
    });
    expect(ok[0].json).toMatchObject({ authorized: true, identityId: "idv1", userName: "Raiane", from: "5571999990000" });
    expect(ok[0].json.allowedTools.sort()).toEqual(["buscar_clientes", "consultar_cliente", "consultar_recebimentos"]);
    const semVinculo = await rodar({ error: { message: '404 - {"error":{"code":"identity_not_found"}}' } });
    expect(semVinculo[0].json).toMatchObject({ authorized: false, allowedTools: [], motivo: "numero_nao_vinculado", identityId: null });
    const agencia = await rodar({ error: { message: '403 - {"error":{"code":"agency_scope_not_supported"}}' } });
    expect(agencia[0].json.motivo).toBe("usuario_restrito_a_agencia");
    const falha = await rodar({ error: { message: "ECONNREFUSED" } });
    expect(falha[0].json).toMatchObject({ authorized: false, motivo: "erro_tecnico" });
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
    const usados = [...new Set([...catalogo.tools.map((t: any) => t.scope), "identities.resolve"])].sort();
    expect(codigo).toContain(JSON.stringify(usados));
  });
});

describe("auditoria dos workflows (todos)", () => {
  const arquivos = readdirSync(join(RAIZ, "workflows")).filter((f) => f.endsWith(".json"));
  const NOMES_PADRAO = new Set([
    "HTTP Request", "Code", "If", "Switch", "Webhook", "AI Agent", "Merge", "Set", "Edit Fields", "Schedule Trigger",
    "Sticky Note", "OpenAI Chat Model", "Window Buffer Memory", "Simple Memory", "Qdrant Vector Store", "Embeddings OpenAI",
    "Default Data Loader", "Recursive Character Text Splitter", "Respond to Webhook", "Basic LLM Chain", "Manual Trigger",
  ]);

  it("nenhum nó com nome padrão do n8n (todos nomeados pelo que fazem)", () => {
    for (const f of arquivos) {
      for (const n of ler(`workflows/${f}`).nodes) {
        expect(NOMES_PADRAO.has(String(n.name).replace(/\d+$/, "")), `${f}: ${n.name}`).toBe(false);
      }
    }
  });

  it("toda variável $env usada nos workflows está documentada em ENV.example", () => {
    const env = readFileSync(join(RAIZ, "ENV.example"), "utf8");
    const documentadas = new Set([...env.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
    for (const f of arquivos) {
      const usadas = new Set([...readFileSync(join(RAIZ, "workflows", f), "utf8").matchAll(/\$env\.([A-Z0-9_]+)/g)].map((m) => m[1]));
      for (const v of usadas) expect(documentadas.has(v), `${f}: $env.${v} sem documentação`).toBe(true);
    }
  });

  it("todos chegam desativados, sem id e com credenciais só por placeholder", () => {
    for (const f of arquivos) {
      const wf = ler(`workflows/${f}`);
      expect(wf.active, f).toBe(false);
      for (const n of wf.nodes) {
        for (const c of Object.values<any>(n.credentials ?? {})) expect(c.id, `${f}: ${n.name}`).toMatch(/^CONFIGURAR_[A-Z0-9_]+$/);
      }
    }
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
    expect(env).toMatch(/^B2C_FINANCE_API_TOKEN=YOUR_API_TOKEN$/m);
    expect(env).toMatch(/^# TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN$/m);
    expect(env).toMatch(/^# QDRANT_API_KEY=YOUR_QDRANT_API_KEY$/m);
  });
});

// ---------------------------------------------------------------------------
// Relatórios diários (manhã e noite)
// ---------------------------------------------------------------------------

/** Executa o JS de um nó Code como o n8n faria, com $, $env e $json de teste. */
async function rodarCode(js: string, ctx: { nos?: Record<string, any>; env?: Record<string, string>; json?: any }) {
  const $ = (nome: string) => ({ first: () => ({ json: ctx.nos?.[nome] }) });
  const fn = new Function("$", "$env", "$json", `return (async () => { ${js} })();`);
  return fn($, ctx.env ?? {}, ctx.json ?? {});
}

describe("relatórios diários", () => {
  const RELATORIOS = {
    manha: { arquivo: "workflows/daily-morning-report.json", cron: "B2C_MORNING_REPORT_CRON", gets: ["/reports/daily", "/routine/daily", "/dashboard/summary"] },
    noite: { arquivo: "workflows/daily-evening-report.json", cron: "B2C_EVENING_REPORT_CRON", gets: ["/reports/daily", "/routine/daily"] },
  };

  for (const [nome, r] of Object.entries(RELATORIOS)) {
    it(`${nome}: cron por variável, fuso documentado, só GET na API, desativado, com notas`, () => {
      const wf = ler(r.arquivo);
      expect(wf.active).toBe(false);
      expect(wf.settings.timezone).toBe("America/Bahia");
      const cron = wf.nodes.find((n: any) => n.type === "n8n-nodes-base.scheduleTrigger");
      expect(cron.parameters.rule.interval[0].field).toBe("cronExpression");
      expect(cron.parameters.rule.interval[0].expression).toMatch(new RegExp(`\\$env\\.${r.cron} \\|\\| '`));
      expect(wf.nodes.some((n: any) => n.type === "n8n-nodes-base.manualTrigger")).toBe(true);
      const http = wf.nodes.filter((n: any) => n.type === "n8n-nodes-base.httpRequest");
      const api = http.filter((n: any) => String(n.parameters.url).includes("B2C_FINANCE_API_URL"));
      expect(api.map((n: any) => String(n.parameters.url).replace(/^=\{\{ \$env\.B2C_FINANCE_API_URL \}\}/, "").split("?")[0])).toEqual(r.gets);
      for (const n of api) {
        expect(n.parameters.method ?? "GET").toBe("GET");
        expect(n.credentials.httpHeaderAuth.name).toBe("B2C Finance API");
        expect(n.onError).toBe("continueRegularOutput"); // falha vira "não consegui consultar", não zero
      }
      for (const n of http.filter((x: any) => !api.includes(x))) expect(String(n.parameters.url)).toContain("WHATSAPP_API_URL");
      const tipos = new Set(wf.nodes.map((n: any) => n.type));
      for (const t of tipos) expect(String(t)).not.toMatch(/postgres|supabase|mysql|redis|mongo/i);
      expect(wf.nodes.filter((n: any) => n.type === "n8n-nodes-base.stickyNote").length).toBeGreaterThanOrEqual(3);
      // Toda a cadeia até o envio está ligada.
      expect(wf.connections["Validar mensagem"].main[0][0].node).toBe("Um envio por destinatário");
      expect(wf.connections["Um envio por destinatário"].main[0][0].node).toBe("Enviar WhatsApp");
    });
  }

  const js = (arquivo: string, no: string) => ler(arquivo).nodes.find((n: any) => n.name === no).parameters.jsCode as string;
  const ok = (data: any, omitted: string[] = []) => ({ success: true, data, meta: { omittedSections: omitted } });

  it("manhã: mensagem padrão só com o que veio; seção sem dado some; falha vira 'não consegui consultar'", async () => {
    const out = await rodarCode(js(RELATORIOS.manha.arquivo, "Consolidar dados"), {
      nos: {
        "Preparar data e destinatários": { hoje: "2026-09-28", competencia: "2026-09", destinatarios: ["5571999990000"] },
        "API: relatório do dia": ok({ receivables: { dueToday: { openAmount: 1500, items: [{ openAmount: 1500, client: { name: "Face Love" } }] }, received: { count: 0, amount: 0, items: [] } } }, ["expenses"]),
        "API: rotina do dia": { success: false, error: { code: "internal_error" } },
        "API: indicadores do mês": ok({ metrics: { mrr_oficial: { value: 45200 }, clientes_ativos: { value: 38 }, churn_quantidade: { value: 0 } } }),
      },
    });
    const m = out[0].json.mensagemPadrao as string;
    expect(m).toContain("*Recebimentos previstos hoje* — 1 · R$ 1.500,00");
    expect(m).toContain("• Face Love — R$ 1.500,00");
    expect(m).toContain("*MRR atual* — R$ 45.200,00 · 38 clientes ativos");
    expect(m).not.toContain("Churn"); // zero churn: seção some
    expect(m).not.toContain("Prioridades"); // rotina falhou: nenhuma prioridade inventada
    expect(m).not.toContain("Vencidos");
    expect(m).toContain("Não consegui consultar: rotina.");
    expect(m).toContain("Sem acesso a: expenses.");
    expect(out[0].json.valoresPermitidos).toEqual(expect.arrayContaining(["1.500,00", "45.200,00"]));
  });

  it("validação: R$ que a IA inventou → mensagem padrão; texto fiel → usa a IA; IA falhou → padrão", async () => {
    const base = { mensagemPadrao: "*Resumo*\nMRR R$ 45.200,00", valoresPermitidos: ["45.200,00"], destinatarios: ["5571999990000"] };
    const validar = js(RELATORIOS.manha.arquivo, "Validar mensagem");
    const nos = { "Consolidar dados": base };
    const inventou = await rodarCode(validar, { nos, json: { text: "MRR R$ 45.200,00. Sugiro cortar R$ 9.999,00." } });
    expect(inventou[0].json).toMatchObject({ origem: "padrao", mensagem: base.mensagemPadrao });
    expect(inventou[0].json.motivo).toContain("9.999,00");
    const fiel = await rodarCode(validar, { nos, json: { text: "Resumo: MRR de R$ 45.200,00." } });
    expect(fiel[0].json).toMatchObject({ origem: "ia", mensagem: "Resumo: MRR de R$ 45.200,00." });
    const falhou = await rodarCode(validar, { nos, json: { error: "timeout" } });
    expect(falhou[0].json.origem).toBe("padrao");
  });

  it("noite: ações executadas, recebimentos, despesas pagas, cadastros, status (sem o inicial), upsells e pendências", async () => {
    const out = await rodarCode(js(RELATORIOS.noite.arquivo, "Consolidar dados"), {
      nos: {
        "Preparar data e destinatários": { hoje: "2026-09-28", competencia: "2026-09", destinatarios: ["5571999990000"] },
        "API: dados do dia": ok({
          receivables: { dueToday: { openAmount: 0 }, received: { count: 1, amount: 1500, items: [{ amount: 1500, client: { name: "Face Love" } }] } },
          expenses: { paid: { count: 1, amount: 300, items: [{ description: "CRM", amount: 300 }] } },
          clients: {
            createdClients: [{ id: "c1", name: "Alpha Estética", modality: "MRR" }],
            statusChangesRecorded: [
              { client: { id: "c1", name: "Alpha Estética" }, status: { label: "Ativo" }, effectiveFrom: "2026-09-28" },
              { client: { id: "c2", name: "Beta" }, status: { label: "Inativo" }, effectiveFrom: "2026-10-01" },
            ],
          },
          upsells: { created: { count: 1, value: 900, items: [{ client: { name: "Face Love" }, title: "Tráfego", value: 900 }] }, won: { count: 0, value: 0, items: [] } },
        }),
        "API: rotina do dia": ok({
          actions: [{ text: "Cobrar Face Love — R$ 1.500,00", done: true }, { text: "Resolver 2 pagamento(s) vencido(s) — R$ 800,00", done: false }],
          collections: { overdue: [], overdueTotal: 0 },
          payments: { overdueTotal: 800 },
        }),
      },
    });
    const m = out[0].json.mensagemPadrao as string;
    for (const trecho of [
      "*Ações executadas* — 1", "• Cobrar Face Love — R$ 1.500,00",
      "*Recebimentos* — 1 · R$ 1.500,00", "*Despesas pagas* — 1 · R$ 300,00",
      "*Clientes cadastrados* — 1", "• Alpha Estética (MRR)",
      "*Status alterados* — 1", "• Beta → Inativo a partir de 01/10/2026",
      "*Upsells* — 1 criado(s) · R$ 900,00", "*Pendências*", "• Pagamentos vencidos: R$ 800,00",
    ]) expect(m, trecho).toContain(trecho);
    expect(m).not.toContain("Alpha Estética → Ativo"); // status inicial do cadastro não é "alteração"
    expect(m).not.toContain("Não consegui consultar");
    expect(out[0].json.valoresPermitidos).toEqual(expect.arrayContaining(["1.500,00", "300,00", "900,00", "800,00"]));
  });

  it("envio: texto na janela de 24 h ou modelo aprovado (uma linha, sem formatação)", async () => {
    const envio = js(RELATORIOS.noite.arquivo, "Um envio por destinatário");
    const json = { mensagem: "*Fechamento*\n\n• A — R$ 1,00", origem: "ia", destinatarios: ["5571999990000", "5571988880000"] };
    const texto = await rodarCode(envio, { json, env: {} });
    expect(texto).toHaveLength(2);
    expect(texto[0].json.payload).toMatchObject({ type: "text", to: "5571999990000", text: { body: json.mensagem } });
    const modelo = await rodarCode(envio, { json, env: { WHATSAPP_REPORT_MODE: "template", WHATSAPP_REPORT_TEMPLATE: "relatorio_diario" } });
    const p = modelo[1].json.payload;
    expect(p).toMatchObject({ type: "template", to: "5571988880000", template: { name: "relatorio_diario", language: { code: "pt_BR" } } });
    expect(p.template.components[0].parameters[0].text).toBe("Fechamento | • A — R$ 1,00");
  });

  it("sem destinatário configurado, o relatório falha com mensagem clara (não envia para ninguém)", async () => {
    await expect(rodarCode(js(RELATORIOS.manha.arquivo, "Preparar data e destinatários"), { env: {} })).rejects.toThrow(/B2C_REPORT_RECIPIENTS/);
    const ok2 = await rodarCode(js(RELATORIOS.manha.arquivo, "Preparar data e destinatários"), { env: { B2C_REPORT_RECIPIENTS: "+55 71 99999-0000, 5571988880000" } });
    expect(ok2[0].json.destinatarios).toEqual(["5571999990000", "5571988880000"]);
    expect(ok2[0].json.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// Agente com escrita controlada (b2c-finance-ai-agent.json)
// ---------------------------------------------------------------------------

describe("agente com escrita controlada", () => {
  const ESCRITA = "workflows/b2c-finance-ai-agent.json";
  const N_AG = "AI Agent B2C Finance";
  const cat = ler("schemas/agent-write-tools.json");
  const wf = ler(ESCRITA);
  const no = (nome: string) => wf.nodes.find((n: any) => n.name === nome);
  const js = (nome: string) => no(nome).parameters.jsCode as string;

  /** Chaves aceitas pelo corpo da rota (desembrulha .refine). */
  const chavesDoCorpo = (z: any): string[] => {
    let s = z;
    while (s?._def?.schema) s = s._def.schema;
    return Object.keys(s.shape ?? {});
  };

  it("o readonly continua intacto como referência (mesmas ferramentas, só leitura)", () => {
    const ro = ler("workflows/b2c-finance-ai-agent-readonly.json");
    expect(ro.meta.b2c.readOnly).toBe(true);
    const ferr = ro.nodes.filter((n: any) => n.type === "@n8n/n8n-nodes-langchain.toolHttpRequest");
    expect(ferr.every((n: any) => n.parameters.method === "GET")).toBe(true);
    expect(ferr).toHaveLength(11);
  });

  it("catálogo de escrita = classificação da API (operação, scope, alvo, bloqueadas)", () => {
    expect(cat.tools.map((t: any) => t.name).sort()).toEqual(Object.values(OPERACOES_DE_ESCRITA).map((o) => o.tool).sort());
    for (const t of cat.tools) {
      const op = (OPERACOES_DE_ESCRITA as any)[t.operation];
      expect(op, t.name).toBeTruthy();
      expect(t.name).toBe(op.tool);
      expect(t.scope).toBe(op.scope);
      expect(t.risk).toBe("WRITE_CONFIRMATION");
      expect(!!t.target, t.name).toBe(op.target !== null);
      // Campos que a ferramenta oferece existem no corpo da rota de escrita.
      const aceitos = chavesDoCorpo((CORPO_DA_OPERACAO as any)[t.operation]);
      for (const k of Object.keys(t.input)) expect(aceitos, `${t.name}.${k}`).toContain(k);
      for (const r of t.required) expect(Object.keys(t.input)).toContain(r);
      expect(Object.keys(t.input)).not.toContain("userId");
      expect(Object.keys(t.input)).not.toContain("ownerId");
    }
    expect(cat.blocked.map((b: any) => b.operation)).toEqual(Object.keys(OPERACOES_BLOQUEADAS));
    expect(cat.blocked.map((b: any) => b.label)).toEqual(Object.values(OPERACOES_BLOQUEADAS));
  });

  it("ferramentas de escrita só PROPÕEM: POST /agent/pending-actions com a operação fixa, travadas pelo perfil", () => {
    const leitura = wf.nodes.filter((n: any) => n.type === "@n8n/n8n-nodes-langchain.toolHttpRequest");
    const escritaNos = wf.nodes.filter((n: any) => n.type === "n8n-nodes-base.httpRequestTool");
    expect(leitura).toHaveLength(11);
    expect(escritaNos).toHaveLength(10);
    for (const n of leitura) expect(n.parameters.method, n.name).toBe("GET");
    for (const t of cat.tools) {
      const n = no(t.name);
      expect(n.type).toBe("n8n-nodes-base.httpRequestTool");
      expect(n.parameters.method).toBe("POST");
      expect(n.parameters.url).toBe(
        `={{ ($json.allowedTools || []).includes('${t.name}') ? $env.B2C_FINANCE_API_URL : 'https://ferramenta-nao-liberada-para-este-perfil.invalid' }}/agent/pending-actions`
      );
      // Corpo: operação fixa; o modelo preenche só targetId e input.
      const corpo = n.parameters.jsonBody as string;
      expect(corpo.startsWith(`={{ JSON.stringify({ operation: '${t.operation}'`)).toBe(true);
      const doModelo = [...corpo.matchAll(/\$fromAI\('([a-zA-Z]+)'/g)].map((m) => m[1]);
      expect(doModelo).toEqual([...(t.target ? ["targetId"] : []), ...(Object.keys(t.input).length ? ["input"] : [])]);
      expect(corpo).not.toMatch(/userId|ownerId|\$fromAI\('operation'/);
      const h = Object.fromEntries(n.parameters.headerParameters.parameters.map((x: any) => [x.name, x.value]));
      expect(h["X-B2C-Identity"]).toBe("={{ $json.identityId }}");
      expect(h["X-B2C-Message-Id"]).toBe("={{ $json.messageId }}");
      expect(h["X-B2C-Source"]).toBe("whatsapp");
      // O erro da API (código + mensagem) chega ao modelo.
      expect(n.parameters.options.response.response.neverError).toBe(true);
      expect(n.credentials.httpHeaderAuth).toEqual({ id: "CONFIGURAR_B2C_FINANCE_API", name: "B2C Finance API" });
      expect(wf.connections[t.name].ai_tool[0][0].node).toBe(N_AG);
    }
    for (const n of [...leitura, ...escritaNos]) expect(String(n.parameters.url)).not.toContain("confirm");
  });

  it("$fromAI: as expressões das ferramentas de escrita são JavaScript válido", () => {
    for (const t of cat.tools) {
      const expr = (no(t.name).parameters.jsonBody as string).replace(/^=\{\{/, "").replace(/\}\}$/, "");
      const valores: Record<string, unknown> = { targetId: "cm1", input: { amount: 10 } };
      const corpo = JSON.parse(new Function("$fromAI", `return ${expr};`)((k: string) => valores[k]));
      expect(corpo.operation).toBe(t.operation);
    }
  });

  it("nunca acessa banco: só API do B2C (identidade e ações do agente) e WhatsApp", () => {
    const executavel = wf.nodes
      .filter((n: any) => n.type !== "n8n-nodes-base.stickyNote")
      .map((n: any) => ({ ...n, notes: undefined, parameters: { ...n.parameters, options: { ...(n.parameters?.options ?? {}), systemMessage: undefined } } }));
    const texto = JSON.stringify(executavel).toLowerCase();
    for (const proibido of ["supabase", "prisma", "postgres", "mysql", "mongodb", "redis", "database_url"]) expect(texto, proibido).not.toContain(proibido);
    for (const n of wf.nodes.filter((x: any) => x.type === "n8n-nodes-base.httpRequest" || x.type === "n8n-nodes-base.httpRequestTool")) {
      const url = String(n.parameters.url);
      expect(
        url === "={{ $env.B2C_FINANCE_API_URL }}/integrations/resolve-identity" ||
          url.endsWith("/agent/pending-actions") ||
          url.startsWith("={{ $env.B2C_FINANCE_API_URL }}/agent/pending-actions") ||
          url.includes("WHATSAPP_API_URL"),
        url
      ).toBe(true);
    }
    expect(wf.active).toBe(false);
    expect(wf.meta.b2c).toMatchObject({ workflow: "b2c-finance-ai-agent", readOnly: false, writeMode: "confirmation" });
    expect(wf.meta.b2c.requiredScopes).toEqual(expect.arrayContaining(["agent_actions.manage", "identities.resolve", "receivables.register_payment"]));
  });

  it("fluxo: a resposta SIM/NÃO é tratada ANTES da IA; a IA não tem ferramenta de confirmação", () => {
    const prox = (n: string, saida = 0) => wf.connections[n].main[saida][0].node;
    expect(prox("Mensagem de texto?")).toBe("Detectar confirmação");
    expect(prox("Detectar confirmação")).toBe("Resposta a uma ação pendente?");
    expect(prox("Resposta a uma ação pendente?", 0)).toBe("API: ação pendente atual");
    expect(prox("Resposta a uma ação pendente?", 1)).toBe("Montar contexto do agente");
    expect(prox("API: ação pendente atual")).toBe("Decidir confirmação");
    expect(prox("Decidir confirmação")).toBe("Próximo passo");
    expect([0, 1, 2, 3].map((i) => prox("Próximo passo", i))).toEqual([
      "API: confirmar ação", "API: cancelar ação", "Responder no WhatsApp", "Montar contexto do agente",
    ]);
    expect(no("Próximo passo").parameters.output).toContain("['confirmar', 'cancelar', 'responder', 'agente']");
    expect(prox("API: confirmar ação")).toBe("Resposta da ação");
    expect(prox(N_AG)).toBe("Juntar resposta e contexto");
    expect(prox("Juntar resposta e contexto")).toBe("API: ação proposta nesta mensagem");
    expect(no("API: ação proposta nesta mensagem").parameters.url).toBe(
      "={{ $env.B2C_FINANCE_API_URL }}/agent/pending-actions?sourceMessageId={{ encodeURIComponent($json.messageId) }}&limit=1"
    );
    expect(prox("API: ação proposta nesta mensagem")).toBe("Interpretar resposta do agente");
    expect(prox("Interpretar resposta do agente")).toBe("Responder no WhatsApp");
    // Confirmação: Idempotency-Key calculada (mensagem + ação) e SEM corpo de ação.
    const conf = no("API: confirmar ação");
    expect(conf.parameters.url).toBe("={{ $env.B2C_FINANCE_API_URL }}/agent/pending-actions/{{ $json.actionId }}/confirm");
    const hs = Object.fromEntries(conf.parameters.headerParameters.parameters.map((h: any) => [h.name, h.value]));
    expect(hs["Idempotency-Key"]).toBe("={{ $json.idempotencyKey }}");
    expect(hs["X-B2C-Identity"]).toBe("={{ $json.identityId }}");
    expect(conf.parameters.jsonBody).toBe("={{ JSON.stringify({ messageId: $json.messageId, confirmationCode: $json.codigo }) }}");
    expect(conf.parameters.options.response.response.neverError).toBe(true);
  });

  it("detecção: só 'SIM <código>' confirma; 'sim' solto nunca", async () => {
    const detectar = async (text: string) =>
      (await new Function("$input", `return (async () => { ${js("Detectar confirmação")} })();`)({ all: () => [{ json: { text } }] }))[0].json;
    expect(await detectar("SIM 4821")).toMatchObject({ intencao: "confirmar", codigo: "4821" });
    expect(await detectar("  confirmo, 0042! ")).toMatchObject({ intencao: "confirmar", codigo: "0042" });
    expect(await detectar("sim")).toMatchObject({ intencao: "sim_sem_codigo", codigo: null });
    expect(await detectar("Pode")).toMatchObject({ intencao: "sim_sem_codigo" });
    expect(await detectar("não")).toMatchObject({ intencao: "cancelar" });
    expect(await detectar("NAO 4821")).toMatchObject({ intencao: "cancelar" });
    expect(await detectar("sim, registra o pagamento da Face Love")).toMatchObject({ intencao: "outro" });
    expect(await detectar("4821")).toMatchObject({ intencao: "outro" });
    expect(await detectar("SIM 48")).toMatchObject({ intencao: "outro" });
  });

  it("decisão: liga ao id da ação pendente e monta a Idempotency-Key igual à da API", async () => {
    const decidir = async (m: any, resposta: any) => {
      const $ = () => ({ all: () => [{ json: m }] });
      return (await new Function("$", "$input", `return (async () => { ${js("Decidir confirmação")} })();`)($, { all: () => [{ json: resposta }] }))[0].json;
    };
    const m = { messageId: "wamid.HBgM==", from: "5571999990000", phoneNumberId: "P", identityId: "i1" };
    const pendente = { success: true, data: [{ actionId: "cmpa01", message: "Encontrei:\n...\nResponda *SIM 4821*" }] };
    const c = await decidir({ ...m, intencao: "confirmar", codigo: "4821" }, pendente);
    expect(c).toMatchObject({ proximo: "confirmar", actionId: "cmpa01", codigo: "4821" });
    expect(c.idempotencyKey).toBe(chaveDaConfirmacao("wamid.HBgM==", "cmpa01"));
    expect(await decidir({ ...m, intencao: "cancelar" }, pendente)).toMatchObject({ proximo: "cancelar", actionId: "cmpa01" });
    const semCodigo = await decidir({ ...m, intencao: "sim_sem_codigo" }, pendente);
    expect(semCodigo).toMatchObject({ proximo: "responder", to: "5571999990000" });
    expect(semCodigo.body).toContain("código de 4 dígitos");
    const nada = { success: true, data: [] };
    expect((await decidir({ ...m, intencao: "confirmar", codigo: "4821" }, nada)).body).toContain("Não encontrei nenhuma ação");
    expect(await decidir({ ...m, intencao: "sim_sem_codigo" }, nada)).toMatchObject({ proximo: "agente" });
    expect((await decidir({ ...m, intencao: "confirmar", codigo: "1" }, { success: false })).proximo).toBe("responder");
  });

  it("resposta: prévia da API quando houve proposta (não a paráfrase da IA); resultado da execução vem da API", async () => {
    const ctx = { from: "5571999990000", phoneNumberId: "P" };
    const juntos = { ...ctx, output: "Registrei R$ 9.999,00!" };
    const $ = () => ({ all: () => [{ json: juntos }] });
    const rodar = async (nome: string, resposta: any) =>
      (await new Function("$", "$input", `return (async () => { ${js(nome)} })();`)($, { all: () => [{ json: resposta }] }))[0].json;
    const comProposta = await rodar("Interpretar resposta do agente", { success: true, data: [{ status: "PENDING", actionId: "a1", message: "Encontrei:\nR$ 1.500,00\nResponda *SIM 4821*" }] });
    expect(comProposta.body).toBe("Encontrei:\nR$ 1.500,00\nResponda *SIM 4821*");
    const semProposta = await rodar("Interpretar resposta do agente", { success: true, data: [] });
    expect(semProposta.body).toBe("Registrei R$ 9.999,00!");

    const $d = () => ({ itemMatching: () => ({ json: ctx }), all: () => [{ json: ctx }] });
    const res = async (r: any) => (await new Function("$", "$input", `return (async () => { ${js("Resposta da ação")} })();`)($d, { all: () => [{ json: r }] }))[0].json;
    expect((await res({ success: true, data: { message: "✅ Pagamento registrado — Face Love." } })).body).toBe("✅ Pagamento registrado — Face Love.");
    expect((await res({ success: false, error: { code: "action_expired", message: "O prazo para confirmar esta ação acabou." } })).body).toContain("prazo");
  });

  it("permissões: escrita exige o scope da operação E agent_actions.manage", async () => {
    const codigo = js("Carregar permissões");
    const $ = () => ({ all: () => [{ json: { from: "5571999990000" } }] });
    const rodar = async (allowedScopes: string[]) =>
      (await new Function("$", "$input", `return (async () => { ${codigo} })();`)($, {
        all: () => [{ json: { success: true, data: { identityId: "i", user: { id: "u", name: "R", roleLabel: "F" }, allowedScopes } } }],
      }))[0].json.allowedTools as string[];
    expect(await rodar(["receivables.read", "receivables.register_payment"])).not.toContain("registrar_pagamento");
    const ok = await rodar(["receivables.read", "receivables.register_payment", "agent_actions.manage", "clients.read"]);
    expect(ok).toEqual(expect.arrayContaining(["registrar_pagamento", "consultar_recebimentos", "buscar_clientes"]));
    expect(ok).not.toContain("cadastrar_cliente");
  });

  it("prompt: vem de docs/AI_AGENT_SYSTEM_PROMPT.md, com os 10 princípios, risco e bloqueadas", () => {
    const doc = readFileSync(join(process.cwd(), "docs/AI_AGENT_SYSTEM_PROMPT.md"), "utf8");
    const trecho = (m: string) => doc.split(`<!-- ${m}:inicio -->`)[1].split(`<!-- ${m}:fim -->`)[0].trim();
    const prompt = `${trecho("prompt-base")}\n\n${trecho("prompt-escrita")}`;
    const sistema = no(N_AG).parameters.options.systemMessage as string;
    expect(sistema.startsWith("=" + prompt)).toBe(true);
    const PRINCIPIOS = [
      "1. **Nunca invente dados.**",
      "2. **Consulte a API para informações atuais.**",
      "3. **Consulte a base de conhecimento para conceitos e procedimentos.**",
      "4. **Busque o cliente antes de usar um ID.**",
      "5. **Pergunte em caso de ambiguidade.**",
      "6. **Não execute ações críticas.**",
      "7. **Peça confirmação para escrita.**",
      "8. **Respeite as permissões.**",
      "9. **Explique o que executou.**",
      "10. **Nunca revele token, segredo ou informação técnica sensível.**",
    ];
    for (const p of PRINCIPIOS) expect(prompt, p).toContain(p);
    // Princípio 2: o que NUNCA vem da base de conhecimento.
    for (const item of ["saldo atual", "MRR atual", "cliente ativo hoje", "recebimentos", "despesas", "status atual", "inadimplência"]) {
      expect(prompt, item).toContain(item);
    }
    for (const trecho of [
      "READ", "WRITE_CONFIRMATION", "BLOCKED", "buscar_clientes", "Alpha", "consultar_conhecimento",
      "não existe ferramenta de confirmação", "nunca envie userId", ...Object.values(OPERACOES_BLOQUEADAS),
    ]) expect(prompt, trecho).toContain(trecho);
    expect(prompt).not.toMatch(/b2c_live_|Bearer\s|sk-/);
    expect(sistema).toContain("Base de conhecimento: consultar_conhecimento");
  });
});

// ---------------------------------------------------------------------------
// Base de conhecimento (RAG)
// ---------------------------------------------------------------------------

describe("base de conhecimento (RAG = conhecimento; API = dados atuais)", () => {
  const pacote = ler("knowledge/b2c-finance-knowledge.json");
  const manifesto = ler("knowledge/manifest.json");
  const agente = ler("workflows/b2c-finance-ai-agent.json");
  const ingestao = ler("workflows/knowledge-ingest.json");
  const noDe = (wf: any, nome: string) => wf.nodes.find((n: any) => n.name === nome);

  it("o pacote versionado é exatamente o que o gerador produz (docs editados sem build não passam)", async () => {
    const { gerarPacote } = await import("../integrations/n8n/scripts/build-knowledge.mjs");
    expect(gerarPacote()).toEqual(pacote);
  });

  it("documentos pedidos estão na base; os com dado de uma data, proposta antiga ou prompt, nunca", () => {
    const caminhos = pacote.documentos.map((d: any) => d.path);
    for (const p of [
      "docs/METRICAS_FINANCEIRAS.md", "docs/ARQUITETURA_FINANCEIRA.md", "docs/STATUS_TEMPORAL_CLIENTES.md", "docs/API.md",
      "docs/AI_AGENT.md", "docs/PLANO_DE_CONTAS.md", "docs/REGRAS_MRR_TCV.md", "docs/POLITICAS_INTERNAS.md",
    ]) expect(caminhos, p).toContain(p);
    for (const p of manifesto.neverIndex.paths) {
      expect(caminhos).not.toContain(p);
      expect(existsSync(join(process.cwd(), p)), `neverIndex aponta para arquivo inexistente: ${p}`).toBe(true);
    }
    for (const p of ["docs/DIAGNOSTICO_2026.md", "docs/PLANO_DE_CONTAS_GERENCIAL.md", "docs/AI_AGENT_SYSTEM_PROMPT.md"]) {
      expect(manifesto.neverIndex.paths).toContain(p);
    }
  });

  it("cada trecho: aviso de conceito, documento e seção, metadados completos, tamanho limitado, id único", () => {
    const ids = new Set();
    for (const t of pacote.trechos) {
      expect(t.text.startsWith("[Conhecimento B2C Finance — conceito/regra, não dado atual]\nDocumento: ")).toBe(true);
      expect(t.text.length).toBeLessThanOrEqual(manifesto.chunking.maxChars + 300);
      expect(t.metadata).toMatchObject({ tipo: "conhecimento" });
      for (const k of ["docId", "titulo", "categoria", "secao", "fonte", "atualizado_em"]) expect(t.metadata[k], `${t.id}.${k}`).toBeTruthy();
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
    // Seções internas excluídas não vazam para a base.
    const tudo = pacote.trechos.map((t: any) => t.text).join("\n");
    expect(tudo).not.toContain("DIVERGÊNCIAS CONHECIDAS");
    expect(tudo).not.toContain("Seção: 9. Testes");
    expect(tudo).not.toContain("Seção: 5. Implementação");
    expect(pacote.principle).toContain("RAG = conhecimento e documentação. API = dados atuais");
  });

  it("o gerador recusa documento sem 'dados_atuais: nao' ou sem cabeçalho", async () => {
    const { lerCabecalho } = await import("../integrations/n8n/scripts/build-knowledge.mjs");
    expect(() => lerCabecalho("# Sem cabeçalho", "x.md")).toThrow(/sem cabeçalho/);
    expect(() => lerCabecalho("---\nrag: true\ntitulo: X\ncategoria: c\natualizado_em: 2026-09-28\ndados_atuais: sim\n---\n# X", "x.md")).toThrow(/dados_atuais/);
    expect(lerCabecalho("---\nrag: true\ntitulo: X\ncategoria: c\natualizado_em: 2026-09-28\ndados_atuais: nao\n---\n# X", "x.md").meta.titulo).toBe("X");
  });

  it("agente: consultar_conhecimento (Qdrant) só para conceitos, mesma coleção/modelo/dimensões da indexação", () => {
    const tool = noDe(agente, "consultar_conhecimento");
    expect(tool.type).toBe("@n8n/n8n-nodes-langchain.vectorStoreQdrant");
    expect(tool.parameters).toMatchObject({ mode: "retrieve-as-tool", topK: 4, includeDocumentMetadata: true });
    expect(tool.parameters.qdrantCollection.value).toBe(pacote.collection);
    expect(tool.credentials.qdrantApi).toEqual({ id: "CONFIGURAR_QDRANT", name: "Qdrant (conhecimento)" });
    for (const t of ["NUNCA", "saldo", "MRR", "clientes ativos", "recebimentos", "despesas", "status de hoje", "inadimplência"]) {
      expect(tool.parameters.toolDescription, t).toContain(t);
    }
    expect(agente.connections["consultar_conhecimento"].ai_tool[0][0].node).toBe("AI Agent B2C Finance");
    const emb = noDe(agente, "Embeddings (conhecimento)");
    const embIdx = noDe(ingestao, "Embeddings (indexação)");
    for (const e of [emb, embIdx]) {
      expect(e.parameters.model).toBe(pacote.embedding.model);
      expect(e.parameters.options.dimensions).toBe(pacote.embedding.dimensions);
    }
    expect(agente.connections["Embeddings (conhecimento)"].ai_embedding[0][0].node).toBe("consultar_conhecimento");
    expect(agente.meta.b2c.knowledgeVersion).toBe(pacote.version);
  });

  it("indexação: manual, lê a API, confere antes de apagar, grava na mesma coleção; nada de banco do B2C", () => {
    expect(ingestao.active).toBe(false);
    const prox = (n: string) => ingestao.connections[n].main[0][0].node;
    expect(noDe(ingestao, "Reindexar agora").type).toBe("n8n-nodes-base.manualTrigger");
    expect(prox("Reindexar agora")).toBe("API: base de conhecimento");
    expect(prox("API: base de conhecimento")).toBe("Conferir pacote");
    expect(prox("Conferir pacote")).toBe("Qdrant: apagar coleção");
    expect(prox("Qdrant: apagar coleção")).toBe("Um item por trecho");
    expect(prox("Um item por trecho")).toBe("Qdrant: gravar trechos");
    expect(noDe(ingestao, "API: base de conhecimento").parameters.url).toBe("={{ $env.B2C_FINANCE_API_URL }}/knowledge/documents");
    const apagar = noDe(ingestao, "Qdrant: apagar coleção");
    expect(apagar.parameters).toMatchObject({ method: "DELETE", url: "={{ $env.QDRANT_URL }}/collections/{{ $json.collection }}", nodeCredentialType: "qdrantApi" });
    const gravar = noDe(ingestao, "Qdrant: gravar trechos");
    expect(gravar.parameters.mode).toBe("insert");
    expect(gravar.parameters.qdrantCollection.value).toBe(pacote.collection);
    expect(ingestao.meta.b2c.requiredScopes).toEqual(["knowledge.read"]);
    const texto = JSON.stringify(ingestao.nodes.filter((n: any) => n.type !== "n8n-nodes-base.stickyNote").map((n: any) => ({ ...n, notes: undefined }))).toLowerCase();
    for (const proibido of ["supabase", "prisma", "postgres", "database_url"]) expect(texto, proibido).not.toContain(proibido);
  });

  it("código da indexação: pacote inválido não apaga nada; um item por trecho com metadados", async () => {
    const conferir = noDe(ingestao, "Conferir pacote").parameters.jsCode as string;
    const rodar = (resp: any, env: any = { QDRANT_URL: "http://q" }) =>
      new Function("$input", "$env", `return (async () => { ${conferir} })();`)({ first: () => ({ json: resp }) }, env);
    await expect(rodar({ success: false })).rejects.toThrow(/Nada foi apagado/);
    const ok = await rodar({ success: true, data: pacote });
    expect(ok[0].json).toMatchObject({ collection: pacote.collection, version: pacote.version, trechos: pacote.trechos.length });
    await expect(rodar({ success: true, data: { ...pacote, embedding: { ...pacote.embedding, model: "outro" } } })).rejects.toThrow(/Modelo/);
    const trechos = noDe(ingestao, "Um item por trecho").parameters.jsCode as string;
    const $ = () => ({ first: () => ({ json: { data: pacote } }) });
    const itens = await new Function("$", `return (async () => { ${trechos} })();`)($);
    expect(itens).toHaveLength(pacote.trechos.length);
    expect(itens[0].json).toMatchObject({ text: pacote.trechos[0].text, docId: pacote.trechos[0].metadata.docId, versao: pacote.version });
  });
});

// ---------------------------------------------------------------------------
// Telegram (Fase 16 · bloco 1)
// ---------------------------------------------------------------------------

describe("Telegram: agente somente leitura e teste de conexão", () => {
  const wf = ler("workflows/b2c-finance-telegram-agent-readonly.json");
  const teste = ler("workflows/telegram-connection-test.json");
  const pacote = ler("knowledge/b2c-finance-knowledge.json");
  const no = (w: any, nome: string) => w.nodes.find((n: any) => n.name === nome);
  const js = (nome: string) => no(wf, nome).parameters.jsCode as string;
  const rodar = async (nome: string, itens: any[], extra: { $?: any; estatico?: any } = {}) => {
    const estatico = extra.estatico ?? {};
    const fn = new Function("$input", "$", "$getWorkflowStaticData", `return (async () => { ${js(nome)} })();`);
    return (await fn({ all: () => itens.map((json) => ({ json })) }, extra.$ ?? (() => ({ all: () => [] })), () => estatico)) as any[];
  };
  const update = (over: any = {}, msg: any = {}) => ({
    update_id: 1000 + Math.floor(Math.random() * 1e6),
    message: { message_id: 7, chat: { id: 555, type: "private" }, from: { id: 123456789, is_bot: false, username: "joao_b2c", first_name: "João" }, text: "Quanto recebemos hoje?", ...msg },
    ...over,
  });

  it("fluxo: gatilho → normalizar → dedupe → privado? → Telegram User ID → API → permissões → roteiro → agente → formatar → enviar", () => {
    const prox = (n: string, saida = 0) => wf.connections[n].main[saida][0].node;
    expect(no(wf, "Telegram: receber mensagem").type).toBe("n8n-nodes-base.telegramTrigger");
    expect(no(wf, "Telegram: receber mensagem").parameters.updates).toEqual(["message"]);
    expect(prox("Telegram: receber mensagem")).toBe("Normalizar update");
    expect(prox("Normalizar update")).toBe("Deduplicar update (update_id)");
    expect(prox("Deduplicar update (update_id)")).toBe("Chat privado?");
    expect(prox("Chat privado?", 0)).toBe("Limitar mensagens por pessoa"); // anti-flood antes da API
    expect(prox("Dentro do limite?", 0)).toBe("Extrair Telegram User ID");
    expect(prox("Chat privado?", 1)).toBe("Resposta: só no privado"); // grupo nunca chega na API
    expect(prox("Extrair Telegram User ID")).toBe("API: resolver identidade");
    expect(prox("API: resolver identidade")).toBe("Carregar permissões");
    expect(prox("Carregar permissões")).toBe("Roteiro da mensagem");
    expect(prox("Vai para o agente?", 0)).toBe("Montar contexto do agente");
    expect(prox("Vai para o agente?", 1)).toBe("Formatar para o Telegram");
    expect(prox("AI Agent B2C Finance (Telegram, somente leitura)")).toBe("Juntar resposta e contexto");
    expect(prox("Formatar para o Telegram")).toBe("Telegram: enviar mensagem");
    const envio = no(wf, "Telegram: enviar mensagem");
    expect(envio.parameters).toMatchObject({ resource: "message", operation: "sendMessage", additionalFields: { parse_mode: "HTML", appendAttribution: false } });
    expect(wf.active).toBe(false);
    expect(teste.active).toBe(false);
  });

  it("identidade pela API, só com o Telegram User ID (nunca username, userId ou ownerId)", () => {
    const r = no(wf, "API: resolver identidade");
    expect(r.parameters.url).toBe("={{ $env.B2C_FINANCE_API_URL }}/integrations/resolve-identity");
    expect(r.parameters.jsonBody).toBe("={{ JSON.stringify({ channel: 'TELEGRAM', externalIdentifier: $json.externalIdentifier }) }}");
    expect(JSON.stringify(r.parameters)).not.toMatch(/username|userId|ownerId/);
    const h = Object.fromEntries(r.parameters.headerParameters.parameters.map((x: any) => [x.name, x.value]));
    expect(h["X-B2C-Source"]).toBe("telegram");
  });

  it("somente leitura: 11 ferramentas GET + conhecimento; nenhuma escrita, nenhum banco", () => {
    const tipos = wf.nodes.map((n: any) => n.type);
    expect(tipos).not.toContain("n8n-nodes-base.httpRequestTool");
    const ferr = wf.nodes.filter((n: any) => n.type === "@n8n/n8n-nodes-langchain.toolHttpRequest");
    expect(ferr.map((n: any) => n.name).sort()).toEqual(catalogo.tools.map((t: any) => t.name).sort());
    for (const n of ferr) {
      expect(n.parameters.method).toBe("GET");
      const h = Object.fromEntries(n.parameters.parametersHeaders.values.map((x: any) => [x.name, x.value]));
      expect(h["X-B2C-Source"]).toBe("telegram");
      expect(h["X-B2C-Identity"]).toBe("={{ $json.identityId }}");
    }
    const conh = no(wf, "consultar_conhecimento");
    expect(conh.parameters).toMatchObject({ mode: "retrieve-as-tool" });
    expect(conh.parameters.qdrantCollection.value).toBe(pacote.collection);
    // HTTP fora das ferramentas: só a resolução de identidade.
    for (const n of wf.nodes.filter((x: any) => x.type === "n8n-nodes-base.httpRequest")) {
      expect(n.parameters.url).toBe("={{ $env.B2C_FINANCE_API_URL }}/integrations/resolve-identity");
    }
    const texto = JSON.stringify(wf.nodes.filter((n: any) => n.type !== "n8n-nodes-base.stickyNote").map((n: any) => ({ ...n, notes: undefined, parameters: { ...n.parameters, options: { ...(n.parameters?.options ?? {}), systemMessage: undefined } } }))).toLowerCase();
    for (const proibido of ["supabase", "prisma", "postgres", "database_url", "agent/pending-actions", "/payments", "status-changes"]) {
      expect(texto, proibido).not.toContain(proibido);
    }
    expect(wf.meta.b2c).toMatchObject({ channel: "TELEGRAM", readOnly: true });
  });

  it("prompt: base (10 princípios) + modo somente leitura; canal Telegram no contexto", () => {
    const doc = readFileSync(join(process.cwd(), "docs/AI_AGENT_SYSTEM_PROMPT.md"), "utf8");
    const trecho = (m: string) => doc.split(`<!-- ${m}:inicio -->`)[1].split(`<!-- ${m}:fim -->`)[0].trim();
    const sistema = no(wf, "AI Agent B2C Finance (Telegram, somente leitura)").parameters.options.systemMessage as string;
    expect(sistema.startsWith(`=${trecho("prompt-base")}\n\n${trecho("prompt-leitura")}`)).toBe(true);
    for (let i = 1; i <= 10; i++) expect(sistema).toContain(`${i}. **`);
    expect(sistema).toContain("SOMENTE LEITURA");
    expect(sistema).not.toContain("### Como propor uma escrita");
    expect(sistema).toContain("Canal: Telegram (conversa privada)");
  });

  it("normalizar: Telegram User ID como identidade; comandos com @bot; mensagem sem texto", async () => {
    const [a] = await rodar("Normalizar update", [update({}, { text: "/start@B2CFinanceBot" })]);
    expect(a.json).toMatchObject({ chatType: "private", fromId: "123456789", username: "joao_b2c", comando: "/start", tipo: "text", messageId: "tg:555:7" });
    const [b] = await rodar("Normalizar update", [update({}, { text: undefined, photo: [{}] })]);
    expect(b.json).toMatchObject({ tipo: "outro", comando: null });
    const [c] = await rodar("Normalizar update", [update({}, { from: { id: 99, is_bot: true } })]);
    expect(c.json).toMatchObject({ fromId: null, isBot: true });
    expect(await rodar("Normalizar update", [{ update_id: 1, edited_message: {} }])).toEqual([]);
  });

  it("deduplicação: o mesmo update_id passa uma vez só", async () => {
    const estatico = {};
    const m = { updateId: 42, text: "oi" };
    expect(await rodar("Deduplicar update (update_id)", [m], { estatico })).toHaveLength(1);
    expect(await rodar("Deduplicar update (update_id)", [m], { estatico })).toHaveLength(0);
    expect(await rodar("Deduplicar update (update_id)", [{ updateId: 43 }], { estatico })).toHaveLength(1);
    expect(await rodar("Deduplicar update (update_id)", [{ text: "sem id" }], { estatico })).toHaveLength(0);
  });

  it("fora do privado: grupo/supergrupo recebem orientação genérica; canal e bot, nada", async () => {
    const privado = no(wf, "Chat privado?").parameters.conditions.conditions[0].leftValue as string;
    expect(privado).toBe("={{ $json.chatType === 'private' && !!$json.fromId }}");
    for (const tipo of ["group", "supergroup"]) {
      const r = await rodar("Resposta: só no privado", [{ chatType: tipo, chatId: -100, fromId: "1" }]);
      expect(r).toHaveLength(1);
      expect(r[0].json.texto).toContain("conversa privada");
      expect(r[0].json.texto).not.toMatch(/R\$|\d{3,}/);
    }
    expect(await rodar("Resposta: só no privado", [{ chatType: "channel", chatId: -100, fromId: null }])).toEqual([]);
    expect(await rodar("Resposta: só no privado", [{ chatType: "group", chatId: -100, fromId: null }])).toEqual([]);
  });

  it("/start não vinculado mostra o próprio ID e nada financeiro; vinculado cumprimenta; /help sem escrita; /status sem scopes", async () => {
    const base = { fromId: "123456789", chatId: 555, tipo: "text", text: "/start", comando: "/start" };
    const [naoVinc] = await rodar("Roteiro da mensagem", [{ ...base, authorized: false, motivo: "numero_nao_vinculado" }]);
    expect(naoVinc.json.rota).toBe("responder");
    expect(naoVinc.json.texto).toContain("ainda não está vinculado");
    expect(naoVinc.json.texto).toContain("*123456789*");
    expect(naoVinc.json.texto).not.toMatch(/R\$|inadimpl|MRR/);
    const [erro] = await rodar("Roteiro da mensagem", [{ ...base, text: "quanto recebemos?", comando: null, authorized: false, motivo: "erro_tecnico" }]);
    expect(erro.json.texto).toContain("Não consegui acessar os dados do B2C Finance neste momento");
    const aut = { ...base, authorized: true, userName: "Raiane", roleLabel: "Financeiro", allowedScopes: ["receivables.read"] };
    const [start] = await rodar("Roteiro da mensagem", [aut]);
    expect(start.json.texto).toContain("Olá, *Raiane*");
    expect(start.json.texto).toContain("Você está conectado ao B2C Finance");
    const [help] = await rodar("Roteiro da mensagem", [{ ...aut, comando: "/help" }]);
    for (const ex of ["Quanto recebemos hoje?", "Quem está inadimplente?", "Qual nosso MRR?", "Quais clientes renovam este mês?", "Qual nosso churn?"]) {
      expect(help.json.texto).toContain(ex);
    }
    expect(help.json.texto).not.toMatch(/registr|cadastr|lanç|paga\b|SIM/i);
    const [status] = await rodar("Roteiro da mensagem", [{ ...aut, comando: "/status" }]);
    expect(status.json.texto).toContain("B2C Finance conectado");
    expect(status.json.texto).toContain("Perfil: Financeiro");
    expect(status.json.texto).not.toMatch(/scope|receivables\.read|identity/i);
    const [pergunta] = await rodar("Roteiro da mensagem", [{ ...aut, comando: null, text: "Qual nosso MRR?" }]);
    expect(pergunta.json.rota).toBe("agente");
    const [foto] = await rodar("Roteiro da mensagem", [{ ...aut, comando: null, tipo: "outro", text: "" }]);
    expect(foto.json.texto).toContain("só mensagens de texto");
  });

  it("formatação HTML: escapa TODO conteúdo dinâmico; negrito vira <b>; falha vira mensagem neutra", async () => {
    const [r] = await rodar("Formatar para o Telegram", [{ chatId: 1, texto: "Olá, *<script>alert(1)</script> & Cia*\nValor: R$ 1.500,00 <b>x</b>" }]);
    expect(r.json.text).toBe("Olá, <b>&lt;script&gt;alert(1)&lt;/script&gt; &amp; Cia</b>\nValor: R$ 1.500,00 &lt;b&gt;x&lt;/b&gt;");
    const [ia] = await rodar("Formatar para o Telegram", [{ chatId: 1, output: "**MRR**: `R$ 45.200,00`\n| Cliente | Valor |\n|---|---|\n| A | 1 |" }]);
    expect(ia.json.text).toContain("<b>MRR</b>: <code>R$ 45.200,00</code>");
    expect(ia.json.text).toContain("Cliente · Valor");
    const [falha] = await rodar("Formatar para o Telegram", [{ chatId: 1, output: null }]);
    expect(falha.json.text).toBe("Não consegui concluir essa consulta agora. A tentativa foi registrada.");
  });

  it("limite do Telegram: divide por parágrafo em 'Parte i/n' (≤ 4096), no máximo 4 partes, sem cortar no meio da palavra", async () => {
    const paragrafo = (i: number) => `Cliente ${i}: ` + "palavra ".repeat(60).trim();
    const longo = Array.from({ length: 40 }, (_, i) => paragrafo(i)).join("\n\n");
    const partes = await rodar("Formatar para o Telegram", [{ chatId: 9, output: longo }]);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.length).toBeLessThanOrEqual(4);
    partes.forEach((p: any, i: number) => {
      expect(p.json.chatId).toBe(9);
      expect(p.json.text.length).toBeLessThanOrEqual(4096);
      expect(p.json.text.startsWith(`<i>Parte ${i + 1}/${partes.length}</i>\n`)).toBe(true);
    });
    const todas = partes.map((p: any) => p.json.text).join("\n");
    expect(todas).toContain("Cliente 0: palavra");
    expect(todas).not.toMatch(/palavr\n|palav$/);
    const muitoLongo = Array.from({ length: 200 }, (_, i) => paragrafo(i)).join("\n\n");
    const cortado = await rodar("Formatar para o Telegram", [{ chatId: 9, output: muitoLongo }]);
    expect(cortado).toHaveLength(4);
    expect(cortado[3].json.text).toContain("peça um recorte menor");
    // Uma linha só, gigante, sem espaço: ainda assim respeita o limite.
    const linhaUnica = await rodar("Formatar para o Telegram", [{ chatId: 9, output: "x".repeat(9000) }]);
    for (const p of linhaUnica) expect(p.json.text.length).toBeLessThanOrEqual(4096);
  });

  it("teste de conexão: só leituras; mensagem com OK/FALHOU por dependência", async () => {
    const http = teste.nodes.filter((n: any) => n.type === "n8n-nodes-base.httpRequest");
    for (const n of http) {
      expect(n.parameters.method ?? "GET").toMatch(/GET|POST/);
      if (n.parameters.method === "POST") expect(n.parameters.url).toContain("/integrations/resolve-identity");
    }
    expect(JSON.stringify(teste)).not.toMatch(/pending-actions|payments|status-changes/);
    const consolidar = no(teste, "Consolidar resultado").parameters.jsCode as string;
    const exec = (nos: Record<string, any>) =>
      new Function("$", `return (async () => { ${consolidar} })();`)((nome: string) => ({ first: () => ({ json: nos[nome] }) }));
    const scopes = ["clients.read", "client_status.read", "receivables.read", "expenses.read", "cash.read", "upsells.read", "dashboard.read", "routine.read", "reports.read", "identities.resolve"];
    const tudoOk = await exec({
      "API: /health": { success: true }, "API: /me": { success: true, data: { scopes } },
      "API: resolver identidade (teste)": { success: true, data: { authorized: true } },
      "Qdrant: coleção de conhecimento": { result: { points_count: 87 } },
    });
    expect(tudoOk[0].json.ok).toBe(true);
    for (const l of ["Telegram: OK", "B2C API: OK", "Service Account: OK", "Identity: OK", "Qdrant: OK — 87 trechos", "Agent dependencies: OK"]) {
      expect(tudoOk[0].json.text).toContain(l);
    }
    const semQdrant = await exec({
      "API: /health": { success: true }, "API: /me": { success: true, data: { scopes: ["clients.read"] } },
      "API: resolver identidade (teste)": { success: false, error: { code: "identity_not_found" } },
      "Qdrant: coleção de conhecimento": { error: { message: "ECONNREFUSED" } },
    });
    expect(semQdrant[0].json.ok).toBe(false);
    expect(semQdrant[0].json.text).toContain("Qdrant: FALHOU");
    expect(semQdrant[0].json.text).toContain("Identity: FALHOU");
    expect(semQdrant[0].json.text).toContain("faltam scopes");
  });
});
