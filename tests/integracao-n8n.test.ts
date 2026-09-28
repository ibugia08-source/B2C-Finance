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

  it("existem o agente, os dois relatórios diários e o teste de conexão", () => {
    expect(arquivos.sort()).toEqual([
      "b2c-finance-ai-agent-readonly.json", "daily-evening-report.json", "daily-morning-report.json", "sistema.teste-conexao.v1.json",
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
    for (const t of catalogo.tools) expect(js).toContain(`"${t.name}": "${t.scope}"`);
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
