#!/usr/bin/env node
/**
 * Gera os workflows a partir das fontes versionadas:
 *   schemas/agent-tools.json    → uma ferramenta HTTP (GET) por item do catálogo
 *   schemas/user-profiles.json  → perfis (ferramentas liberadas por pessoa)
 *   examples/system-prompt.md   → instruções do agente
 *
 *   node integrations/n8n/scripts/build-workflows.mjs    (npm run n8n:build)
 *
 * Saída:
 *   workflows/b2c-finance-ai-agent-readonly.json  agente de consulta (WhatsApp)
 *   workflows/sistema.teste-conexao.v1.json       teste de conexão e scopes
 *
 * Depois de importar e ajustar no n8n, exporte de volta (scripts/export.sh);
 * tests/integracao-n8n.test.ts confere o workflow contra o catálogo e a
 * OpenAPI (só GET, scopes, parâmetros, nenhum acesso a banco).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogo = JSON.parse(readFileSync(join(RAIZ, "schemas/agent-tools.json"), "utf8"));
const perfis = JSON.parse(readFileSync(join(RAIZ, "schemas/user-profiles.json"), "utf8"));
const prompt = readFileSync(join(RAIZ, "examples/system-prompt.md"), "utf8").trim();

// Ids PLACEHOLDER, um por credencial: na importação o n8n liga pelo nome e
// tipo (ou você escolhe no nó). Nunca um id real — check-secrets barra.
const CRED_B2C = { httpHeaderAuth: { id: "CONFIGURAR_B2C_FINANCE_API", name: "B2C Finance API" } };
const CRED_WA = { httpHeaderAuth: { id: "CONFIGURAR_WHATSAPP_API", name: "WhatsApp API" } };
const CRED_IA = { openAiApi: { id: "CONFIGURAR_OPENAI", name: "OpenAI" } };

// Nomes dos nós (referenciados em expressões — um lugar só).
const N = {
  webhook: "Webhook WhatsApp (POST)",
  assinatura: "Validar assinatura (Meta)",
  normalizar: "Normalizar payload",
  identificar: "Identificar número",
  resolver: "Resolver usuário e permissões",
  autorizado: "Usuário autorizado?",
  texto: "Mensagem de texto?",
  contexto: "Montar contexto do agente",
  agente: "AI Agent B2C Finance (somente leitura)",
  modelo: "Modelo de IA",
  memoria: "Memória da conversa",
  interpretar: "Interpretar resposta do agente",
  naoAutorizado: "Resposta: número não autorizado",
  soTexto: "Resposta: só texto",
  responder: "Responder no WhatsApp",
  verificacao: "Webhook WhatsApp (verificação GET)",
  desafio: "Conferir verify token",
  responderDesafio: "Responder desafio da Meta",
};

// Host que nunca resolve: ferramenta fora do perfil do usuário não chega à API.
const BLOQUEADA = "https://ferramenta-nao-liberada-para-este-perfil.invalid";

const cabecalhos = {
  sendHeaders: true,
  specifyHeaders: "keypair",
  parametersHeaders: {
    values: [
      { name: "X-B2C-Source", valueProvider: "fieldValue", value: "whatsapp" },
      { name: "x-request-id", valueProvider: "fieldValue", value: "={{ 'n8n-' + $execution.id }}" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Ferramentas (uma por item do catálogo)
// ---------------------------------------------------------------------------

function ferramenta(t, i) {
  const props = t.inputSchema.properties;
  const obrigatorios = new Set(t.inputSchema.required ?? []);
  const query = [
    ...Object.entries(t.http.fixedQuery ?? {}).map(([name, value]) => ({ name, valueProvider: "fieldValue", value })),
    ...t.http.query.map((name) => ({ name, valueProvider: obrigatorios.has(name) ? "modelRequired" : "modelOptional" })),
  ];
  return {
    parameters: {
      toolDescription: t.description,
      method: "GET",
      // Base da API só para ferramenta liberada no perfil de quem pergunta
      // ($json = item que entrou no agente: "Montar contexto do agente").
      url: `={{ ($json.allowedTools || []).includes('${t.name}') ? $env.B2C_FINANCE_API_URL : '${BLOQUEADA}' }}${t.http.path}`,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      ...(query.length ? { sendQuery: true, specifyQuery: "keypair", parametersQuery: { values: query } } : {}),
      ...cabecalhos,
      placeholderDefinitions: {
        values: [
          ...(t.http.pathParams ?? []).map((name) => ({ name, description: props[name]?.description ?? name, type: "string" })),
          ...t.http.query.map((name) => ({
            name,
            description: props[name]?.description ?? name,
            type: props[name]?.type === "integer" ? "number" : "string",
          })),
        ],
      },
      optimizeResponse: false,
    },
    name: t.name,
    type: "@n8n/n8n-nodes-langchain.toolHttpRequest",
    typeVersion: 1.1,
    position: [1260 + (i % 6) * 170, 620 + Math.floor(i / 6) * 180],
    credentials: CRED_B2C,
    notes: `GET ${t.http.path} · scope ${t.scope}`,
    notesInFlow: true,
  };
}

// ---------------------------------------------------------------------------
// Código dos nós (JavaScript do nó Code)
// ---------------------------------------------------------------------------

const JS_ASSINATURA = `// ETAPA 1 — Validar a assinatura do webhook (Meta WhatsApp Cloud API).
// X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(App Secret, corpo CRU).
// Requer: "Raw Body" ligado no webhook e NODE_FUNCTION_ALLOW_BUILTIN=crypto.
// Assinatura ausente ou diferente → o item é DESCARTADO (nada segue).
const crypto = require('crypto');
const segredo = $env.WHATSAPP_WEBHOOK_SECRET;
if (!segredo) throw new Error('WHATSAPP_WEBHOOK_SECRET não configurado — recusando processar o webhook.');

const validos = [];
const itens = $input.all();
for (let i = 0; i < itens.length; i++) {
  const recebida = String((itens[i].json.headers || {})['x-hub-signature-256'] || '');
  let cru = null;
  try { cru = await this.helpers.getBinaryDataBuffer(i, 'data'); } catch (e) { cru = null; }
  if (!cru || !recebida.startsWith('sha256=')) continue;
  const esperada = 'sha256=' + crypto.createHmac('sha256', segredo).update(cru).digest('hex');
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) continue; // tempo constante
  validos.push({ json: { payload: JSON.parse(cru.toString('utf8')) } });
}
return validos;`;

const JS_NORMALIZAR = `// ETAPA 2 — Normalizar o payload da Meta em UMA mensagem por item.
// Ignora atualizações de status (entregue/lido). Mensagem que não é texto
// segue marcada (tipo) para receber a resposta "só texto".
const saida = [];
for (const item of $input.all()) {
  const corpo = item.json.payload || {};
  for (const entrada of corpo.entry || []) {
    for (const mudanca of entrada.changes || []) {
      const v = mudanca.value || {};
      const nomes = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
      for (const m of v.messages || []) {
        saida.push({
          json: {
            messageId: m.id,
            fromRaw: String(m.from || ''),
            profileName: nomes[m.from] || null,
            timestamp: Number(m.timestamp || 0),
            tipo: m.type,
            text: m.type === 'text' && m.text ? String(m.text.body || '').slice(0, 2000) : '',
            phoneNumberId: (v.metadata && v.metadata.phone_number_id) || $env.WHATSAPP_PHONE_NUMBER_ID,
          },
        });
      }
    }
  }
}
return saida;`;

const JS_IDENTIFICAR = `// ETAPA 3 — Identificar o número (E.164, só dígitos) e descartar repetidas.
// A Meta REENVIA o webhook quando não recebe 200 a tempo: a mesma mensagem
// (messageId) não pode gerar duas respostas. Guarda os últimos ids no
// static data do workflow (vale nas execuções de produção).
const vistos = $getWorkflowStaticData('global');
vistos.ids = vistos.ids || [];
const saida = [];
for (const item of $input.all()) {
  const m = item.json;
  if (!m.messageId || vistos.ids.includes(m.messageId)) continue;
  vistos.ids.push(m.messageId);
  saida.push({ json: { ...m, from: String(m.fromRaw).replace(/\\D/g, '') } });
}
vistos.ids = vistos.ids.slice(-500);
return saida;`;

const JS_RESOLVER = `// ETAPA 4 — Resolver usuário e permissões.
// Diretório: B2C_WHATSAPP_USERS (JSON número → { name, profile }).
// Perfis e ferramentas: schemas/user-profiles.json (embutido abaixo pelo gerador).
// Número fora do diretório → authorized = false (resposta genérica, nenhum dado).
const PERFIS = ${JSON.stringify(Object.fromEntries(Object.entries(perfis.profiles).map(([k, p]) => [k, { label: p.label, tools: p.tools }])), null, 2)};
let diretorio;
try {
  diretorio = JSON.parse($env.B2C_WHATSAPP_USERS || '{}');
} catch (e) {
  throw new Error('B2C_WHATSAPP_USERS não é um JSON válido — ver integrations/n8n/ENV.example.');
}
const normalizado = Object.fromEntries(Object.entries(diretorio).map(([num, u]) => [String(num).replace(/\\D/g, ''), u]));
return $input.all().map((item) => {
  const u = normalizado[item.json.from];
  const perfil = u && PERFIS[u.profile];
  return {
    json: {
      ...item.json,
      authorized: Boolean(u && perfil),
      userName: u ? u.name : null,
      profile: perfil ? u.profile : null,
      profileLabel: perfil ? perfil.label : null,
      allowedTools: perfil ? perfil.tools : [],
      motivo: !u ? 'numero_fora_do_diretorio' : !perfil ? 'perfil_desconhecido' : null,
    },
  };
});`;

const JS_CONTEXTO = `// ETAPA 5 — Contexto do agente: quem pergunta, o que pode usar e a data de
// hoje (fuso America/Bahia) para resolver "mês passado", "ontem" etc.
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
return $input.all().map((item) => ({
  json: {
    ...item.json,
    sessionId: 'wa:' + item.json.from,
    hoje,
    competenciaAtual: hoje.slice(0, 7),
  },
}));`;

const JS_INTERPRETAR = `// ETAPA 7 — Interpretar a resposta do agente para o WhatsApp.
// Sem texto (erro do modelo/ferramenta) → mensagem neutra, sem detalhe técnico.
// Limita ao tamanho do WhatsApp e tira tabela markdown (o WhatsApp não desenha).
const LIMITE = 3900;
return $input.all().map((item, i) => {
  const ctx = $('${N.contexto}').all()[i]?.json || $('${N.contexto}').first().json;
  let texto = String(item.json.output || '').trim();
  if (!texto) texto = 'Tive um problema técnico para consultar agora. Tente de novo em instantes.';
  texto = texto.replace(/^\\s*\\|.*\\|\\s*$/gm, (linha) => linha.replace(/\\s*\\|\\s*/g, ' · ').replace(/^ · | · $/g, ''));
  texto = texto.replace(/^\\s*[-·:\\s]+$/gm, '');
  if (texto.length > LIMITE) texto = texto.slice(0, LIMITE - 60).trimEnd() + '\\n\\n(Resposta resumida — peça o detalhe que quiser.)';
  return { json: { to: ctx.from, phoneNumberId: ctx.phoneNumberId, body: texto } };
});`;

const resposta = (nome, texto, pos, nota) => ({
  parameters: {
    jsCode: `// ${nota}\nreturn $input.all().map((item) => ({ json: { to: item.json.from, phoneNumberId: item.json.phoneNumberId, body: ${JSON.stringify(texto)} } }));`,
  },
  name: nome,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: pos,
  notes: nota,
  notesInFlow: true,
});

const code = (nome, js, pos, nota) => ({
  parameters: { jsCode: js },
  name: nome,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: pos,
  notes: nota,
  notesInFlow: true,
});

const se = (nome, expr, pos, nota) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
      conditions: [{ id: nome, leftValue: expr, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }],
      combinator: "and",
    },
    options: {},
  },
  name: nome,
  type: "n8n-nodes-base.if",
  typeVersion: 2,
  position: pos,
  notes: nota,
  notesInFlow: true,
});

const nota = (nome, conteudo, pos, largura, altura, cor) => ({
  parameters: { content: conteudo, height: altura, width: largura, color: cor },
  name: nome,
  type: "n8n-nodes-base.stickyNote",
  typeVersion: 1,
  position: pos,
});

const ferramentas = catalogo.tools.map(ferramenta);
const scopesUsados = [...new Set(catalogo.tools.map((t) => t.scope))].sort();

const agente = {
  name: "B2C Finance · AI Agent (somente leitura)",
  nodes: [
    nota(
      "Nota: sobre este workflow",
      `## B2C Finance · AI Agent (somente leitura)\n\nRecebe mensagens do WhatsApp, identifica quem escreveu e responde CONSULTANDO a API do B2C Finance pelas ferramentas.\n\n- **Somente leitura:** nenhuma ferramenta escreve; a integração só tem scopes \`*.read\`.\n- **Nunca** acessa banco, Supabase ou Prisma — só a API (\`$env.B2C_FINANCE_API_URL\`).\n- Tokens só nas **credenciais** (B2C Finance API, WhatsApp API, OpenAI) — nada no workflow.\n- **Não ative** antes do teste (docs/N8N_READONLY_AGENT.md §5).\n\nFonte: integrations/n8n (gerado por scripts/build-workflows.mjs).`,
      [-460, -40], 400, 380, 7
    ),
    nota(
      "Nota: entrada e segurança",
      `### 1–3 · Entrada e segurança\nAssinatura HMAC da Meta em tempo constante (App Secret em \`WHATSAPP_WEBHOOK_SECRET\`). Assinatura inválida = descarta.\nNormaliza o payload (uma mensagem por item) e descarta **repetidas** (a Meta reenvia).`,
      [-20, 180], 700, 330, 5
    ),
    nota(
      "Nota: identificação e permissões",
      `### 4 · Quem é e o que pode\n\`B2C_WHATSAPP_USERS\` (número → nome e perfil). Fora da lista = resposta genérica, **nenhum dado**.\nO perfil define as ferramentas liberadas (schemas/user-profiles.json): vai no prompt **e** trava a URL da ferramenta.`,
      [700, 180], 520, 330, 4
    ),
    nota(
      "Nota: agente e ferramentas",
      `### 5–6 · Agente e ferramentas (GET)\nO agente escolhe a ferramenta; cada uma é um GET na API V1 com o scope indicado na nota do nó.\nRegras do prompt: API é a fonte; não inventar dados nem ids; buscar antes de usar id; perguntar na ambiguidade; nunca escrever; respeitar 403.`,
      [1220, 180], 1080, 800, 6
    ),
    nota(
      "Nota: resposta",
      `### 7 · Resposta\nTexto curto para o WhatsApp; erro vira mensagem neutra (sem detalhe técnico). Envio pela Graph API (\`WHATSAPP_API_URL\`).`,
      [2320, 180], 460, 330, 3
    ),
    {
      parameters: { httpMethod: "POST", path: "b2c-finance-ai-agent", responseMode: "onReceived", options: { rawBody: true } },
      name: N.webhook,
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 300],
      webhookId: "b2c-finance-ai-agent",
      notes: "Recebe o POST da Meta e responde 200 na hora (a Meta reenvia se demorar).",
      notesInFlow: true,
    },
    code(N.assinatura, JS_ASSINATURA, [220, 300], "HMAC X-Hub-Signature-256; inválida = descarta."),
    code(N.normalizar, JS_NORMALIZAR, [440, 300], "Payload da Meta → uma mensagem por item."),
    code(N.identificar, JS_IDENTIFICAR, [660, 300], "Número E.164 + descarte de mensagem repetida."),
    code(N.resolver, JS_RESOLVER, [880, 300], "Número → usuário e perfil (B2C_WHATSAPP_USERS)."),
    se(N.autorizado, "={{ $json.authorized }}", [1060, 300], "Fora do diretório → resposta genérica."),
    se(N.texto, "={{ $json.tipo === 'text' && $json.text.length > 0 }}", [1240, 240], "Áudio, imagem etc. → pede texto."),
    code(N.contexto, JS_CONTEXTO, [1440, 240], "Sessão, data de hoje e ferramentas do perfil."),
    {
      parameters: {
        promptType: "define",
        text: "={{ $json.text }}",
        options: {
          systemMessage:
            "=" +
            prompt +
            "\n\n## Contexto desta conversa\n- Usuário: {{ $json.userName }} (perfil {{ $json.profileLabel }})\n- Ferramentas liberadas para este perfil: {{ $json.allowedTools.join(', ') }}\n- Hoje: {{ $json.hoje }} (competência atual {{ $json.competenciaAtual }}, fuso America/Bahia)",
          maxIterations: 8,
          returnIntermediateSteps: false,
        },
      },
      name: N.agente,
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.7,
      position: [1680, 240],
      onError: "continueRegularOutput",
      notes: "Escolhe as ferramentas (GET na API) e redige a resposta. Somente leitura.",
      notesInFlow: true,
    },
    {
      parameters: { model: { __rl: true, value: "gpt-4o-mini", mode: "list", cachedResultName: "gpt-4o-mini" }, options: { temperature: 0.2 } },
      name: N.modelo,
      type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      typeVersion: 1.2,
      position: [1260, 460],
      credentials: CRED_IA,
      notes: "Qualquer modelo com tool calling. Temperatura baixa: respostas factuais.",
      notesInFlow: true,
    },
    {
      parameters: { sessionIdType: "customKey", sessionKey: "={{ $json.sessionId }}", contextWindowLength: 10 },
      name: N.memoria,
      type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
      typeVersion: 1.3,
      position: [1440, 460],
      notes: "Últimas 10 trocas, por número.",
      notesInFlow: true,
    },
    ...ferramentas,
    code(N.interpretar, JS_INTERPRETAR, [2000, 240], "Formata para o WhatsApp; erro → mensagem neutra."),
    resposta(N.naoAutorizado, "Este número não está autorizado a consultar o B2C Finance. Fale com o administrador da agência.", [1240, 420 + 380 * 0 + 260], "Número fora de B2C_WHATSAPP_USERS: nenhum dado."),
    resposta(N.soTexto, "Por enquanto eu entendo só mensagens de texto. Pode escrever a sua pergunta?", [1440, 440 + 0], "Áudio, imagem, figurinha etc."),
    {
      parameters: {
        method: "POST",
        url: "={{ $env.WHATSAPP_API_URL }}/{{ $json.phoneNumberId }}/messages",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify({ messaging_product: 'whatsapp', to: $json.to, type: 'text', text: { preview_url: false, body: $json.body } }) }}",
        options: {},
      },
      name: N.responder,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [2400, 300],
      credentials: CRED_WA,
      notes: "Envia a resposta pela WhatsApp Cloud API.",
      notesInFlow: true,
    },
    {
      parameters: { httpMethod: "GET", path: "b2c-finance-ai-agent", responseMode: "responseNode", options: {} },
      name: N.verificacao,
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 60],
      webhookId: "b2c-finance-ai-agent-verificacao",
      notes: "Verificação inicial do webhook no painel da Meta.",
      notesInFlow: true,
    },
    code(
      N.desafio,
      `// Verificação do webhook (Meta): devolve hub.challenge se o hub.verify_token confere.\nconst q = $input.first().json.query || {};\nconst ok = q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === $env.WHATSAPP_VERIFY_TOKEN;\nreturn [{ json: { ok, challenge: ok ? String(q['hub.challenge'] || '') : '' } }];`,
      [220, 60],
      "hub.verify_token = WHATSAPP_VERIFY_TOKEN."
    ),
    {
      parameters: { respondWith: "text", responseBody: "={{ $json.challenge }}", options: { responseCode: "={{ $json.ok ? 200 : 403 }}" } },
      name: N.responderDesafio,
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [440, 60],
    },
  ],
  connections: {
    [N.webhook]: { main: [[{ node: N.assinatura, type: "main", index: 0 }]] },
    [N.assinatura]: { main: [[{ node: N.normalizar, type: "main", index: 0 }]] },
    [N.normalizar]: { main: [[{ node: N.identificar, type: "main", index: 0 }]] },
    [N.identificar]: { main: [[{ node: N.resolver, type: "main", index: 0 }]] },
    [N.resolver]: { main: [[{ node: N.autorizado, type: "main", index: 0 }]] },
    [N.autorizado]: {
      main: [[{ node: N.texto, type: "main", index: 0 }], [{ node: N.naoAutorizado, type: "main", index: 0 }]],
    },
    [N.texto]: { main: [[{ node: N.contexto, type: "main", index: 0 }], [{ node: N.soTexto, type: "main", index: 0 }]] },
    [N.contexto]: { main: [[{ node: N.agente, type: "main", index: 0 }]] },
    [N.agente]: { main: [[{ node: N.interpretar, type: "main", index: 0 }]] },
    [N.interpretar]: { main: [[{ node: N.responder, type: "main", index: 0 }]] },
    [N.naoAutorizado]: { main: [[{ node: N.responder, type: "main", index: 0 }]] },
    [N.soTexto]: { main: [[{ node: N.responder, type: "main", index: 0 }]] },
    [N.modelo]: { ai_languageModel: [[{ node: N.agente, type: "ai_languageModel", index: 0 }]] },
    [N.memoria]: { ai_memory: [[{ node: N.agente, type: "ai_memory", index: 0 }]] },
    ...Object.fromEntries(ferramentas.map((f) => [f.name, { ai_tool: [[{ node: N.agente, type: "ai_tool", index: 0 }]] }])),
    [N.verificacao]: { main: [[{ node: N.desafio, type: "main", index: 0 }]] },
    [N.desafio]: { main: [[{ node: N.responderDesafio, type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "all", saveManualExecutions: true },
  pinData: {},
  active: false,
  meta: {
    b2c: {
      workflow: "b2c-finance-ai-agent-readonly",
      version: 1,
      catalogVersion: catalogo.version,
      profilesVersion: perfis.version,
      apiVersion: catalogo.apiVersion,
      readOnly: true,
      requiredScopes: scopesUsados,
      generatedBy: "integrations/n8n/scripts/build-workflows.mjs",
    },
  },
  tags: [],
};

// ---------------------------------------------------------------------------
// Teste de conexão (manual): /health, /me e os scopes que o agente precisa
// ---------------------------------------------------------------------------

const getSimples = (nome, caminho, pos) => ({
  parameters: {
    url: `={{ $env.B2C_FINANCE_API_URL }}${caminho}`,
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
const necessarios = ${JSON.stringify(scopesUsados)};
const me = $input.first().json;
const tem = (me.data && me.data.scopes) || [];
const faltando = necessarios.filter((s) => !tem.includes(s));
const excesso = tem.filter((s) => !necessarios.includes(s));
return [{ json: { ok: faltando.length === 0, integracao: me.data && me.data.name, faltando, scopesAlemDoNecessario: excesso, requestId: me.meta && me.meta.requestId } }];`,
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
gravar("b2c-finance-ai-agent-readonly.json", agente);
gravar("sistema.teste-conexao.v1.json", teste);
console.log(`Workflows gerados (${ferramentas.length} ferramentas; scopes: ${scopesUsados.join(", ")}).`);
