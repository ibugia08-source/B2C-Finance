#!/usr/bin/env node
/**
 * Gera os workflows v1 a partir das fontes versionadas:
 *   schemas/agent-tools.json   → uma ferramenta HTTP (GET) por item do catálogo
 *   examples/system-prompt.md  → mensagem de sistema do agente
 *
 *   node integrations/n8n/scripts/build-workflows.mjs    (npm run n8n:build)
 *
 * Depois de importar e ajustar no n8n, exporte de volta (scripts/export.sh);
 * o teste tests/integracao-n8n.test.ts confere que o workflow continua
 * batendo com o catálogo e com a OpenAPI (só GET, scopes, parâmetros).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogo = JSON.parse(readFileSync(join(RAIZ, "schemas/agent-tools.json"), "utf8"));
const prompt = readFileSync(join(RAIZ, "examples/system-prompt.md"), "utf8").trim();

const BASE = "={{ $env.B2C_FINANCE_API_URL }}";
const CRED_B2C = { httpHeaderAuth: { id: "CONFIGURAR_NO_N8N", name: "B2C Finance API" } };
const CRED_WA = { httpHeaderAuth: { id: "CONFIGURAR_NO_N8N", name: "WhatsApp API" } };
const CRED_IA = { openAiApi: { id: "CONFIGURAR_NO_N8N", name: "OpenAI" } };
const NO_EXTRAIR = "Validar assinatura e extrair mensagem";

const cabecalhos = (origem) => ({
  sendHeaders: true,
  specifyHeaders: "keypair",
  parametersHeaders: {
    values: [
      { name: "X-B2C-Source", valueProvider: "fieldValue", value: origem },
      { name: "x-request-id", valueProvider: "fieldValue", value: "={{ 'n8n-' + $execution.id }}" },
    ],
  },
});

// ---------------------------------------------------------------------------
// Ferramentas do agente (uma por item do catálogo)
// ---------------------------------------------------------------------------

function ferramenta(t, i) {
  const props = t.inputSchema.properties;
  const obrigatorios = new Set(t.inputSchema.required ?? []);
  const query = [
    ...Object.entries(t.http.fixedQuery ?? {}).map(([name, value]) => ({ name, valueProvider: "fieldValue", value })),
    ...t.http.query.map((name) => ({
      name,
      valueProvider: obrigatorios.has(name) ? "modelRequired" : "modelOptional",
    })),
  ];
  const url = `${BASE}${t.http.path}`;
  return {
    parameters: {
      toolDescription: t.description,
      method: "GET",
      url,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      ...(query.length ? { sendQuery: true, specifyQuery: "keypair", parametersQuery: { values: query } } : {}),
      ...cabecalhos("whatsapp"),
      placeholderDefinitions: {
        values: [
          ...(t.http.pathParams ?? []).map((name) => ({ name, description: props[name]?.description ?? name, type: "string" })),
          ...t.http.query.map((name) => ({ name, description: props[name]?.description ?? name, type: props[name]?.type === "integer" ? "number" : "string" })),
        ],
      },
      optimizeResponse: false,
    },
    name: t.name,
    type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
    typeVersion: 1.1,
    position: [560 + (i % 6) * 160, 520 + Math.floor(i / 6) * 180],
    credentials: CRED_B2C,
    notes: `Scope: ${t.scope} · GET ${t.http.path}`,
  };
}

const CODIGO_VALIDAR = `// Valida a assinatura do webhook do WhatsApp e extrai as mensagens de texto.
// Meta (WhatsApp Cloud API): header X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(App Secret, corpo CRU).
// Requer: webhook com a opção "Raw Body" ligada e NODE_FUNCTION_ALLOW_BUILTIN=crypto no n8n.
// Assinatura ausente/errada → o item é DESCARTADO (nada segue para o agente).
const crypto = require('crypto');
const segredo = $env.WHATSAPP_WEBHOOK_SECRET;
const autorizados = String($env.WHATSAPP_ALLOWED_NUMBERS || '')
  .split(',').map((s) => s.replace(/\\D/g, '')).filter(Boolean);
if (!segredo) throw new Error('WHATSAPP_WEBHOOK_SECRET não configurado — recusando processar o webhook.');

const saida = [];
const itens = $input.all();
for (let i = 0; i < itens.length; i++) {
  const headers = itens[i].json.headers || {};
  const recebida = String(headers['x-hub-signature-256'] || '');
  let cru = null;
  try { cru = await this.helpers.getBinaryDataBuffer(i, 'data'); } catch (e) { cru = null; }
  if (!cru || !recebida.startsWith('sha256=')) continue;
  const esperada = 'sha256=' + crypto.createHmac('sha256', segredo).update(cru).digest('hex');
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) continue; // tempo constante

  const corpo = JSON.parse(cru.toString('utf8'));
  for (const entrada of corpo.entry || []) {
    for (const mudanca of entrada.changes || []) {
      const v = mudanca.value || {};
      for (const m of v.messages || []) {
        if (m.type !== 'text' || !m.text || !m.text.body) continue; // só texto na v1
        const de = String(m.from || '').replace(/\\D/g, '');
        saida.push({
          json: {
            from: de,
            text: String(m.text.body).slice(0, 2000),
            messageId: m.id,
            phoneNumberId: (v.metadata && v.metadata.phone_number_id) || $env.WHATSAPP_PHONE_NUMBER_ID,
            autorizado: autorizados.includes(de),
          },
        });
      }
    }
  }
}
return saida;`;

const CODIGO_DESAFIO = `// Verificação do webhook (Meta): devolve hub.challenge se o hub.verify_token confere.
const q = $input.first().json.query || {};
const ok = q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === $env.WHATSAPP_VERIFY_TOKEN;
return [{ json: { ok, challenge: ok ? String(q['hub.challenge'] || '') : '' } }];`;

const enviar = (nome, texto, pos) => ({
  parameters: {
    method: "POST",
    url: `={{ $env.WHATSAPP_API_URL }}/{{ $('${NO_EXTRAIR}').item.json.phoneNumberId }}/messages`,
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendBody: true,
    specifyBody: "json",
    jsonBody: `={{ JSON.stringify({ messaging_product: 'whatsapp', to: $('${NO_EXTRAIR}').item.json.from, type: 'text', text: { body: ${texto} } }) }}`,
    options: {},
  },
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  credentials: CRED_WA,
});

const ferramentas = catalogo.tools.map(ferramenta);

const agente = {
  name: "B2C · Agente WhatsApp · Consulta (v1)",
  nodes: [
    {
      parameters: { httpMethod: "POST", path: "b2c-agente-whatsapp", responseMode: "onReceived", options: { rawBody: true } },
      name: "WhatsApp Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 300],
      webhookId: "b2c-agente-whatsapp",
    },
    {
      parameters: { jsCode: CODIGO_VALIDAR },
      name: NO_EXTRAIR,
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [220, 300],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict" },
          conditions: [
            { leftValue: "={{ $json.autorizado }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } },
          ],
          combinator: "and",
        },
        options: {},
      },
      name: "Número autorizado?",
      type: "n8n-nodes-base.if",
      typeVersion: 2,
      position: [440, 300],
    },
    {
      parameters: {
        promptType: "define",
        text: "={{ $json.text }}",
        options: { systemMessage: prompt, maxIterations: 8 },
      },
      name: "Agente B2C Finance",
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.7,
      position: [700, 200],
    },
    {
      parameters: { model: { __rl: true, value: "gpt-4o-mini", mode: "list" }, options: { temperature: 0.2 } },
      name: "Modelo de IA",
      type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      typeVersion: 1.2,
      position: [560, 380],
      credentials: CRED_IA,
    },
    {
      parameters: {
        sessionIdType: "customKey",
        sessionKey: `={{ 'wa:' + $('${NO_EXTRAIR}').item.json.from }}`,
        contextWindowLength: 10,
      },
      name: "Memória da conversa",
      type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
      typeVersion: 1.3,
      position: [720, 380],
    },
    ...ferramentas,
    enviar("Responder no WhatsApp", "$json.output", [1000, 200]),
    enviar(
      "Responder número não autorizado",
      "'Este número não está autorizado a consultar o B2C Finance. Fale com o administrador da agência.'",
      [700, 420 + 380]
    ),
    {
      parameters: { httpMethod: "GET", path: "b2c-agente-whatsapp", responseMode: "responseNode", options: {} },
      name: "WhatsApp Verificação (GET)",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 60],
      webhookId: "b2c-agente-whatsapp-verificacao",
    },
    {
      parameters: { jsCode: CODIGO_DESAFIO },
      name: "Conferir verify token",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [220, 60],
    },
    {
      parameters: {
        respondWith: "text",
        responseBody: "={{ $json.challenge }}",
        options: { responseCode: "={{ $json.ok ? 200 : 403 }}" },
      },
      name: "Responder desafio",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [440, 60],
    },
  ],
  connections: {
    "WhatsApp Webhook": { main: [[{ node: NO_EXTRAIR, type: "main", index: 0 }]] },
    [NO_EXTRAIR]: { main: [[{ node: "Número autorizado?", type: "main", index: 0 }]] },
    "Número autorizado?": {
      main: [
        [{ node: "Agente B2C Finance", type: "main", index: 0 }],
        [{ node: "Responder número não autorizado", type: "main", index: 0 }],
      ],
    },
    "Agente B2C Finance": { main: [[{ node: "Responder no WhatsApp", type: "main", index: 0 }]] },
    "Modelo de IA": { ai_languageModel: [[{ node: "Agente B2C Finance", type: "ai_languageModel", index: 0 }]] },
    "Memória da conversa": { ai_memory: [[{ node: "Agente B2C Finance", type: "ai_memory", index: 0 }]] },
    ...Object.fromEntries(
      ferramentas.map((f) => [f.name, { ai_tool: [[{ node: "Agente B2C Finance", type: "ai_tool", index: 0 }]] }])
    ),
    "WhatsApp Verificação (GET)": { main: [[{ node: "Conferir verify token", type: "main", index: 0 }]] },
    "Conferir verify token": { main: [[{ node: "Responder desafio", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "all" },
  pinData: {},
  active: false,
  meta: {
    b2c: {
      workflow: "agente-whatsapp.consulta",
      version: 1,
      catalogVersion: catalogo.version,
      apiVersion: catalogo.apiVersion,
      readOnly: true,
      generatedBy: "integrations/n8n/scripts/build-workflows.mjs",
    },
  },
  tags: [],
};

// ---------------------------------------------------------------------------
// Teste de conexão (manual): /health, /me e os scopes que o agente precisa
// ---------------------------------------------------------------------------

const scopesNecessarios = [...new Set(catalogo.tools.map((t) => t.scope))].sort();
const getSimples = (nome, caminho, pos) => ({
  parameters: {
    url: `${BASE}${caminho}`,
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "X-B2C-Source", value: "n8n" }] },
    options: {},
  },
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  credentials: CRED_B2C,
});

const teste = {
  name: "B2C · Sistema · Teste de conexão (v1)",
  nodes: [
    { parameters: {}, name: "Executar teste", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 0] },
    getSimples("GET /health", "/health", [220, 0]),
    getSimples("GET /me", "/me", [440, 0]),
    {
      parameters: {
        jsCode: `// Confere se a integração tem os scopes que o agente de consulta usa.
const necessarios = ${JSON.stringify(scopesNecessarios)};
const me = $input.first().json;
const tem = (me.data && me.data.scopes) || [];
const faltando = necessarios.filter((s) => !tem.includes(s));
return [{ json: { ok: faltando.length === 0, integracao: me.data && me.data.name, faltando, requestId: me.meta && me.meta.requestId } }];`,
      },
      name: "Conferir scopes",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [660, 0],
    },
  ],
  connections: {
    "Executar teste": { main: [[{ node: "GET /health", type: "main", index: 0 }]] },
    "GET /health": { main: [[{ node: "GET /me", type: "main", index: 0 }]] },
    "GET /me": { main: [[{ node: "Conferir scopes", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
  pinData: {},
  active: false,
  meta: { b2c: { workflow: "sistema.teste-conexao", version: 1, apiVersion: "v1", readOnly: true, generatedBy: "integrations/n8n/scripts/build-workflows.mjs" } },
  tags: [],
};

const gravar = (arquivo, wf) => writeFileSync(join(RAIZ, "workflows", arquivo), JSON.stringify(wf, null, 2) + "\n");
gravar("agente-whatsapp.consulta.v1.json", agente);
gravar("sistema.teste-conexao.v1.json", teste);
console.log(`Workflows gerados (${ferramentas.length} ferramentas; scopes: ${scopesNecessarios.join(", ")}).`);
