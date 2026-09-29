#!/usr/bin/env node
/**
 * Gera os workflows a partir das fontes versionadas:
 *   schemas/agent-tools.json        → uma ferramenta HTTP (GET) por item do catálogo
 *   schemas/agent-write-tools.json  → ferramentas que PROPÕEM escrita (agente com escrita)
 *   examples/system-prompt.md        → instruções do agente somente leitura
 *   docs/AI_AGENT_SYSTEM_PROMPT.md   → instruções do agente com escrita (fonte única)
 *   knowledge/b2c-finance-knowledge.json → base de conhecimento (build-knowledge.mjs)
 *
 *   node integrations/n8n/scripts/build-workflows.mjs    (npm run n8n:build)
 *
 * Saída:
 *   workflows/b2c-finance-ai-agent-readonly.json  agente de consulta (WhatsApp) — referência/backup
 *   workflows/b2c-finance-ai-agent.json           agente com escrita controlada (prévia + SIM <código>) + RAG
 *   workflows/knowledge-ingest.json               indexa a base de conhecimento no Qdrant (manual)
 *   workflows/sistema.teste-conexao.v1.json       teste de conexão e scopes
 *
 * Depois de importar e ajustar no n8n, exporte de volta (scripts/export.sh);
 * tests/integracao-n8n.test.ts confere o workflow contra o catálogo e a
 * OpenAPI (só GET, scopes, parâmetros, nenhum acesso a banco).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RAIZ_N8N as RAIZ, catalogo, ferramentasDoCanal, conhecimento, CRED_B2C, CRED_WA, CRED_IA, CRED_QDRANT, BLOQUEADA, cabecalhosDe, ferramentaDeEscrita,
  ferramenta, code, se, nota, apiDeControle, jsPermissoes, colecao, embeddings, ferramentaConhecimento, montarPrompt,
} from "./lib/pecas.mjs";

const prompt = readFileSync(join(RAIZ, "examples/system-prompt.md"), "utf8").trim();

// Nomes dos nós (referenciados em expressões — um lugar só).
const N = {
  webhook: "Webhook WhatsApp (POST)",
  assinatura: "Validar assinatura (Meta)",
  normalizar: "Normalizar payload",
  identificar: "Identificar número",
  resolver: "API: resolver identidade",
  permissoes: "Carregar permissões",
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

const cabecalhos = cabecalhosDe("whatsapp");
// Ferramentas de consulta do WhatsApp (a de inadimplência, por ora, é só do Telegram).
const ferramentasWA = ferramentasDoCanal("whatsapp");

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

// Ferramenta → scope (do catálogo): a ferramenta só é liberada se a API
// devolveu o scope dela em allowedScopes (conta ∩ RBAC do usuário).
const FERRAMENTA_SCOPE = Object.fromEntries(ferramentasWA.map((t) => [t.name, t.scope]));

const JS_PERMISSOES = `// ETAPA 5 — Carregar permissões a partir da RESPOSTA DA API (nunca da mensagem
// nem da IA). O usuário é o do VÍNCULO cadastrado no B2C Finance.
// Ferramentas liberadas = as do catálogo cujo scope a API devolveu em allowedScopes.
const FERRAMENTA_SCOPE = ${JSON.stringify(FERRAMENTA_SCOPE, null, 2)};
const mensagens = $('${N.identificar}').all();
return $input.all().map((item, i) => {
  const msg = mensagens[i] ? mensagens[i].json : {};
  const r = item.json || {};
  if (r.success === true && r.data && r.data.user) {
    const scopes = r.data.allowedScopes || [];
    return {
      json: {
        ...msg,
        authorized: true,
        identityId: r.data.identityId,
        userId: r.data.user.id,
        userName: r.data.user.name,
        roleLabel: r.data.user.roleLabel,
        allowedScopes: scopes,
        allowedTools: Object.keys(FERRAMENTA_SCOPE).filter((t) => scopes.includes(FERRAMENTA_SCOPE[t])),
        motivo: null,
      },
    };
  }
  // 404 identity_not_found / 403 agency_scope_not_supported / falha técnica.
  const texto = JSON.stringify(r.error || r);
  const motivo = texto.includes('identity_not_found') ? 'numero_nao_vinculado'
    : texto.includes('agency_scope_not_supported') ? 'usuario_restrito_a_agencia'
    : 'erro_tecnico';
  return { json: { ...msg, authorized: false, identityId: null, allowedTools: [], motivo } };
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

const ferramentas = ferramentasWA.map((t, i) => ferramenta(t, i));
// O agente usa as ferramentas do catálogo E a resolução de identidade.
const scopesUsados = [...new Set([...ferramentasWA.map((t) => t.scope), "identities.resolve"])].sort();

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
      `### 4–5 · Quem é e o que pode\nA **API** resolve o número pelo vínculo cadastrado em Configurações → Integrações → WhatsApp. Sem vínculo = resposta genérica, **nenhum dado**.\nFerramentas = scopes que a API liberou (conta ∩ RBAC do usuário): vão no prompt, travam a URL e cada chamada leva \`X-B2C-Identity\` — a API recorta de novo.`,
      [700, 180], 700, 330, 4
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
    {
      parameters: {
        method: "POST",
        url: "={{ $env.B2C_FINANCE_API_URL }}/integrations/resolve-identity",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "X-B2C-Source", value: "whatsapp" },
            { name: "x-request-id", value: "={{ 'n8n-' + $execution.id }}" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        // Só o NÚMERO (com "+": a Meta já manda o código do país). O usuário
        // quem define é o vínculo no B2C Finance — nada da mensagem ou da IA.
        jsonBody: "={{ JSON.stringify({ channel: 'WHATSAPP', externalIdentifier: '+' + $json.from }) }}",
        options: {},
      },
      name: N.resolver,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [880, 300],
      credentials: CRED_B2C,
      onError: "continueRegularOutput",
      alwaysOutputData: true,
      notes: "POST /integrations/resolve-identity: número → usuário vinculado.",
      notesInFlow: true,
    },
    code(N.permissoes, JS_PERMISSOES, [1060, 300], "Ferramentas = scopes que a API liberou para o usuário."),
    se(N.autorizado, "={{ $json.authorized }}", [1240, 300], "Número não vinculado → resposta genérica."),
    se(N.texto, "={{ $json.tipo === 'text' && $json.text.length > 0 }}", [1420, 240], "Áudio, imagem etc. → pede texto."),
    code(N.contexto, JS_CONTEXTO, [1600, 240], "Sessão, data de hoje e ferramentas do usuário."),
    {
      parameters: {
        promptType: "define",
        text: "={{ $json.text }}",
        options: {
          systemMessage:
            "=" +
            prompt +
            "\n\n## Contexto desta conversa\n- Usuário (vínculo verificado pela API): {{ $json.userName }} — {{ $json.roleLabel }}\n- Ferramentas liberadas para este usuário: {{ $json.allowedTools.join(', ') }}\n- Hoje: {{ $json.hoje }} (competência atual {{ $json.competenciaAtual }}, fuso America/Bahia)",
          maxIterations: 8,
          returnIntermediateSteps: false,
        },
      },
      name: N.agente,
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.7,
      position: [1820, 240],
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
    code(
      N.naoAutorizado,
      `// Número sem vínculo ativo (ou usuário fora do alcance da integração): NENHUM dado.\nconst TEXTO = {\n  numero_nao_vinculado: 'Este número não está autorizado a consultar o B2C Finance. Fale com o administrador da agência.',\n  usuario_restrito_a_agencia: 'Seu acesso é restrito a uma agência, e o atendimento pelo WhatsApp ainda não cobre esse caso. Use o B2C Finance.',\n  erro_tecnico: 'Não consegui verificar seu acesso agora. Tente de novo em instantes.',\n};\nreturn $input.all().map((item) => ({ json: { to: item.json.from, phoneNumberId: item.json.phoneNumberId, body: TEXTO[item.json.motivo] || TEXTO.numero_nao_vinculado } }));`,
      [1420, 520],
      "Sem vínculo / restrito / falha: resposta sem dado nenhum."
    ),
    resposta(N.soTexto, "Por enquanto eu entendo só mensagens de texto. Pode escrever a sua pergunta?", [1600, 440], "Áudio, imagem, figurinha etc."),
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
    [N.resolver]: { main: [[{ node: N.permissoes, type: "main", index: 0 }]] },
    [N.permissoes]: { main: [[{ node: N.autorizado, type: "main", index: 0 }]] },
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
      apiVersion: catalogo.apiVersion,
      readOnly: true,
      requiredScopes: scopesUsados,
      generatedBy: "integrations/n8n/scripts/build-workflows.mjs",
    },
  },
  tags: [],
};

// ---------------------------------------------------------------------------
// Agente COM ESCRITA CONTROLADA (b2c-finance-ai-agent.json)
//
// Mesma entrada e segurança do agente somente leitura, mais:
//  · ferramentas de escrita que só PROPÕEM (POST /agent/pending-actions);
//  · antes da IA, a resposta "SIM <código>" / "NÃO" do usuário é tratada de
//    forma DETERMINÍSTICA: acha a ação pendente dele na API e confirma (ou
//    cancela) com Idempotency-Key = mensagem + ação. A IA não confirma nada.
//  · depois da IA, se ela propôs uma ação nesta mensagem, a resposta é a
//    PRÉVIA montada pela API (com o código), não o texto da IA.
// ---------------------------------------------------------------------------

const escrita = JSON.parse(readFileSync(join(RAIZ, "schemas/agent-write-tools.json"), "utf8"));
// Prompt do agente com escrita: docs/AI_AGENT_SYSTEM_PROMPT.md (base + escrita).
const promptEscrita = montarPrompt("escrita");

const NE = {
  ...N,
  agente: "AI Agent B2C Finance",
  detectar: "Detectar confirmação",
  ehResposta: "Resposta a uma ação pendente?",
  pendenteAtual: "API: ação pendente atual",
  decidir: "Decidir confirmação",
  proximo: "Próximo passo",
  apiConfirmar: "API: confirmar ação",
  apiCancelar: "API: cancelar ação",
  respostaAcao: "Resposta da ação",
  juntar: "Juntar resposta e contexto",
  conhecimento: "consultar_conhecimento",
  embConhecimento: "Embeddings (conhecimento)",
  proposta: "API: ação proposta nesta mensagem",
};

// Ferramenta → scopes exigidos (TODOS). Escrita = scope da operação + agent_actions.manage.
const FERRAMENTA_SCOPES = {
  ...Object.fromEntries(ferramentasWA.map((t) => [t.name, [t.scope]])),
  ...Object.fromEntries(escrita.tools.map((t) => [t.name, [t.scope, "agent_actions.manage"]])),
};

const JS_PERMISSOES_ESCRITA = jsPermissoes(
  NE.identificar,
  FERRAMENTA_SCOPES,
  `// ETAPA 5 — Carregar permissões a partir da RESPOSTA DA API (nunca da mensagem
// nem da IA). O usuário é o do VÍNCULO cadastrado no B2C Finance.
// Ferramenta liberada = a API devolveu TODOS os scopes dela em allowedScopes
// (conta ∩ RBAC do usuário). Escrita exige o scope da operação + agent_actions.manage.`
);

const JS_DETECTAR = `// ETAPA 6a — A mensagem é RESPOSTA a uma ação pendente? (determinístico, sem IA)
//  · "SIM 4821" / "confirmo 4821"  → confirmar com o código
//  · "NÃO" / "cancelar" (com ou sem código) → cancelar
//  · "sim" / "pode" sem código     → NÃO confirma: pede o código
//  · qualquer outra coisa          → segue para o agente
const CONFIRMA = /^\\s*(?:sim|s|confirmo|confirmar|confirma|ok|pode)\\s*[,.:;!-]?\\s*(\\d{4})\\s*[.!]*\\s*$/i;
const CANCELA = /^\\s*(?:n[aã]o|cancela|cancelar|cancelo)\\s*[,.:;!-]?\\s*(\\d{4})?\\s*[.!]*\\s*$/i;
const SO_SIM = /^\\s*(?:sim|s|confirmo|confirmar|confirma|ok|pode|pode sim|isso)\\s*[.!]*\\s*$/i;
return $input.all().map((item) => {
  const t = String(item.json.text || '');
  let intencao = 'outro';
  let codigo = null;
  const c = t.match(CONFIRMA);
  if (c) { intencao = 'confirmar'; codigo = c[1]; }
  else if (CANCELA.test(t)) intencao = 'cancelar';
  else if (SO_SIM.test(t)) intencao = 'sim_sem_codigo';
  return { json: { ...item.json, intencao, codigo } };
});`;

const JS_DECIDIR = `// ETAPA 6b — Liga a resposta do usuário à ação PENDENTE dele (lida na API).
// Uma pendente por usuário: é essa que o código tem de confirmar — a API
// confere código, usuário, vínculo, validade e estado antes de executar.
// Idempotency-Key = mensagem do WhatsApp + id da ação.
const mensagens = $('${NE.detectar}').all();
const responder = (m, body) => ({ json: { ...m, proximo: 'responder', to: m.from, phoneNumberId: m.phoneNumberId, body } });
return $input.all().map((item, i) => {
  const m = mensagens[i] ? mensagens[i].json : {};
  const r = item.json || {};
  if (r.success !== true) return responder(m, 'Não consegui verificar a ação pendente agora. Tente de novo em instantes.');
  const acao = Array.isArray(r.data) ? r.data[0] : null;
  if (!acao) {
    if (m.intencao === 'confirmar') {
      return responder(m, 'Não encontrei nenhuma ação aguardando confirmação — ela pode ter expirado ou já ter sido feita. Peça de novo, se ainda quiser.');
    }
    return { json: { ...m, proximo: 'agente' } }; // "sim"/"não" soltos sem pendente: conversa normal
  }
  if (m.intencao === 'cancelar') return { json: { ...m, proximo: 'cancelar', actionId: acao.actionId } };
  if (m.intencao === 'sim_sem_codigo') {
    return responder(m, 'Para confirmar, responda *SIM* seguido do código de 4 dígitos.\\n\\n' + (acao.message || acao.preview));
  }
  const chave = 'wa:' + String(m.messageId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) + ':' + acao.actionId;
  return { json: { ...m, proximo: 'confirmar', actionId: acao.actionId, idempotencyKey: chave } };
});`;

const JS_RESPOSTA_ACAO = `// ETAPA 7a — Resposta da confirmação/cancelamento: o texto vem da API
// (resultado real da execução), nunca da IA.
const ref = $('${NE.decidir}');
return $input.all().map((item, i) => {
  const m = (ref.itemMatching ? ref.itemMatching(i) : ref.all()[i]).json;
  const r = item.json || {};
  const body = r.success === true && r.data && r.data.message
    ? r.data.message
    : (r.error && r.error.message) || 'Não consegui concluir agora. Confira no B2C Finance antes de pedir de novo.';
  return { json: { to: m.from, phoneNumberId: m.phoneNumberId, body } };
});`;

const JS_JUNTAR = `// ETAPA 7 — A saída do agente traz só o texto; o vínculo (identityId) e a
// mensagem (messageId) vêm do contexto, pelo índice do item.
const ctxs = $('${N.contexto}').all();
return $input.all().map((item, i) => ({
  json: { ...((ctxs[i] || ctxs[0] || {}).json || {}), output: item.json.output ?? null },
}));`;

const JS_INTERPRETAR_ESCRITA = `// ETAPA 7 — Resposta do agente para o WhatsApp.
// Se a IA PROPÔS uma ação nesta mensagem, a resposta é a PRÉVIA montada pela
// API (estado atual + código) — nunca a paráfrase da IA.
// Sem texto (erro do modelo/ferramenta) → mensagem neutra, sem detalhe técnico.
const LIMITE = 3900;
const juntos = $('${NE.juntar}').all();
return $input.all().map((item, i) => {
  const ctx = (juntos[i] || juntos[0]).json;
  const r = item.json || {};
  const proposta = r.success === true && Array.isArray(r.data) ? r.data.find((a) => a.status === 'PENDING') : null;
  if (proposta && proposta.message) return { json: { to: ctx.from, phoneNumberId: ctx.phoneNumberId, body: proposta.message, actionId: proposta.actionId } };
  let texto = String(ctx.output || '').trim();
  if (!texto) texto = 'Tive um problema técnico agora. Tente de novo em instantes.';
  texto = texto.replace(/^\\s*\\|.*\\|\\s*$/gm, (linha) => linha.replace(/\\s*\\|\\s*/g, ' · ').replace(/^ · | · $/g, ''));
  texto = texto.replace(/^\\s*[-·:\\s]+$/gm, '');
  if (texto.length > LIMITE) texto = texto.slice(0, LIMITE - 60).trimEnd() + '\\n\\n(Resposta resumida — peça o detalhe que quiser.)';
  return { json: { to: ctx.from, phoneNumberId: ctx.phoneNumberId, body: texto } };
});`;

const ferramentasEscrita = escrita.tools.map((t, i) => ferramentaDeEscrita(t, i, "whatsapp"));
const ferramentasLeitura = ferramentasWA.map((t, i) => ({ ...ferramenta(t, i, "whatsapp"), position: [1500 + (i % 6) * 170, 620 + Math.floor(i / 6) * 180] }));
const todasFerramentas = [...ferramentasLeitura, ...ferramentasEscrita];
const scopesEscrita = [
  ...new Set([...ferramentasWA.map((t) => t.scope), ...escrita.tools.map((t) => t.scope), "identities.resolve", "agent_actions.manage"]),
].sort();

const naoAutorizado = agente.nodes.find((n) => n.name === N.naoAutorizado);
const soTexto = agente.nodes.find((n) => n.name === N.soTexto);
const verificacaoNos = agente.nodes.filter((n) => [N.verificacao, N.desafio, N.responderDesafio, N.webhook, N.assinatura, N.normalizar, N.identificar, N.resolver].includes(n.name));

const agenteEscrita = {
  name: "B2C Finance · AI Agent (consulta + escrita com confirmação)",
  nodes: [
    nota(
      "Nota: sobre este workflow",
      `## B2C Finance · AI Agent (consulta + escrita com confirmação)\n\nConsulta a API e PROPÕE escritas. Nada é gravado sem o usuário responder **SIM <código>**.\n\n- **READ** executa direto · **WRITE_CONFIRMATION** gera prévia e pede confirmação · **BLOCKED** nunca (excluir, reabrir competência, permissões, usuários, plano de contas).\n- **Nunca** acessa banco, Supabase ou Prisma — só a API (\`$env.B2C_FINANCE_API_URL\`).\n- Tokens só nas **credenciais** — nada no workflow.\n- **Não ative** antes do teste (docs/N8N_AGENT_WRITE_ACTIONS.md).\n\nO agente somente leitura continua em b2c-finance-ai-agent-readonly.json (referência/backup).\n\nFonte: integrations/n8n (gerado por scripts/build-workflows.mjs).`,
      [-460, -40], 420, 440, 7
    ),
    nota(
      "Nota: entrada e segurança",
      `### 1–4 · Entrada, segurança e identidade\nAssinatura HMAC da Meta; payload normalizado; repetidas descartadas. A **API** resolve o número pelo vínculo (Configurações → Integrações → WhatsApp). Sem vínculo = resposta genérica.`,
      [-20, 180], 1060, 330, 5
    ),
    nota(
      "Nota: confirmação",
      `### 6 · Confirmação (sem IA)\n"SIM 4821" → acha a ação PENDENTE do usuário na API → \`POST /agent/pending-actions/{id}/confirm\` com **Idempotency-Key = wa:<mensagem>:<ação>**. A API confere código, usuário, vínculo, validade e se o estado ainda é o da prévia, e executa o payload GUARDADO pela rota de escrita oficial (RBAC do usuário).\n"sim" sem código não confirma. "NÃO" cancela.`,
      [1220, -300], 1100, 300, 4
    ),
    nota(
      "Nota: agente e ferramentas",
      `### 6–7 · Agente\nDados atuais: GET na API. Conceitos e procedimentos: \`consultar_conhecimento\` (Qdrant, RAG) — nunca número atual. Escrita: todas as ferramentas fazem \`POST /agent/pending-actions\` com a operação FIXA — só propõem. Depois da IA, se houve proposta nesta mensagem, o WhatsApp recebe a **prévia da API** (com o código), não a paráfrase da IA.`,
      [1460, 180], 1100, 1200, 6
    ),
    ...verificacaoNos,
    code(N.permissoes, JS_PERMISSOES_ESCRITA, [1060, 300], "Ferramentas = scopes que a API liberou para o usuário."),
    se(N.autorizado, "={{ $json.authorized }}", [1240, 300], "Número não vinculado → resposta genérica."),
    se(N.texto, "={{ $json.tipo === 'text' && $json.text.length > 0 }}", [1420, 240], "Áudio, imagem etc. → pede texto."),
    code(NE.detectar, JS_DETECTAR, [1600, 240], "SIM <código> / NÃO / sim sem código / outra mensagem."),
    se(NE.ehResposta, "={{ $json.intencao !== 'outro' }}", [1780, 240], "Resposta a uma ação → confirmação sem IA."),
    apiDeControle(NE.pendenteAtual, "GET", "/agent/pending-actions?status=PENDING&limit=1", [1960, 0], "A ação que aguarda confirmação deste usuário."),
    code(NE.decidir, JS_DECIDIR, [2140, 0], "Liga a resposta à ação pendente; monta a Idempotency-Key."),
    {
      parameters: {
        mode: "expression",
        numberOutputs: 4,
        output: "={{ ['confirmar', 'cancelar', 'responder', 'agente'].indexOf($json.proximo) }}",
      },
      name: NE.proximo,
      type: "n8n-nodes-base.switch",
      typeVersion: 3,
      position: [2320, 0],
      notes: "0 confirmar · 1 cancelar · 2 responder · 3 agente",
      notesInFlow: true,
    },
    apiDeControle(NE.apiConfirmar, "POST", "/agent/pending-actions/{{ $json.actionId }}/confirm", [2540, -160], "Executa a ação guardada (RBAC, idempotência, trilha).", {
      headers: [{ name: "Idempotency-Key", value: "={{ $json.idempotencyKey }}" }],
      jsonBody: "={{ JSON.stringify({ messageId: $json.messageId, confirmationCode: $json.codigo }) }}",
    }),
    apiDeControle(NE.apiCancelar, "POST", "/agent/pending-actions/{{ $json.actionId }}/cancel", [2540, 0], "Cancela: nada é executado.", {
      jsonBody: "={{ JSON.stringify({ messageId: $json.messageId }) }}",
    }),
    code(NE.respostaAcao, JS_RESPOSTA_ACAO, [2760, -80], "Texto do resultado real (da API)."),
    code(N.contexto, JS_CONTEXTO, [1960, 400], "Sessão, data de hoje e ferramentas do usuário."),
    {
      parameters: {
        promptType: "define",
        text: "={{ $json.text }}",
        options: {
          systemMessage:
            "=" +
            promptEscrita +
            "\n\n## Contexto desta conversa\n- Usuário (vínculo verificado pela API): {{ $json.userName }} — {{ $json.roleLabel }}\n- Ferramentas liberadas para este usuário: {{ $json.allowedTools.join(', ') }}\n- Base de conhecimento: consultar_conhecimento (conceitos e procedimentos; nunca dados atuais)\n- Hoje: {{ $json.hoje }} (competência atual {{ $json.competenciaAtual }}, fuso America/Bahia)",
          maxIterations: 10,
          returnIntermediateSteps: false,
        },
      },
      name: NE.agente,
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.7,
      position: [2180, 400],
      onError: "continueRegularOutput",
      notes: "Consulta (GET) e PROPÕE escritas. Não confirma nada.",
      notesInFlow: true,
    },
    { ...agente.nodes.find((n) => n.name === N.modelo), position: [1500, 460] },
    { ...agente.nodes.find((n) => n.name === N.memoria), position: [1680, 460] },
    ...todasFerramentas,
    ferramentaConhecimento(NE.conhecimento, [2200, 1400]),
    embeddings(NE.embConhecimento, [2200, 1580]),
    code(NE.juntar, JS_JUNTAR, [2400, 400], "Resposta da IA + contexto (vínculo e mensagem) no mesmo item."),
    apiDeControle(
      NE.proposta, "GET", "/agent/pending-actions?sourceMessageId={{ encodeURIComponent($json.messageId) }}&limit=1",
      [2620, 400], "A ação que a IA propôs nesta mensagem (prévia da API)."
    ),
    code(N.interpretar, JS_INTERPRETAR_ESCRITA, [2840, 400], "Prévia da API quando houve proposta; senão o texto do agente."),
    { ...naoAutorizado, position: [1420, 640] },
    { ...soTexto, position: [1600, 640] },
    { ...agente.nodes.find((n) => n.name === N.responder), position: [2980, 300] },
  ],
  connections: {
    [N.webhook]: { main: [[{ node: N.assinatura, type: "main", index: 0 }]] },
    [N.assinatura]: { main: [[{ node: N.normalizar, type: "main", index: 0 }]] },
    [N.normalizar]: { main: [[{ node: N.identificar, type: "main", index: 0 }]] },
    [N.identificar]: { main: [[{ node: N.resolver, type: "main", index: 0 }]] },
    [N.resolver]: { main: [[{ node: N.permissoes, type: "main", index: 0 }]] },
    [N.permissoes]: { main: [[{ node: N.autorizado, type: "main", index: 0 }]] },
    [N.autorizado]: { main: [[{ node: N.texto, type: "main", index: 0 }], [{ node: N.naoAutorizado, type: "main", index: 0 }]] },
    [N.texto]: { main: [[{ node: NE.detectar, type: "main", index: 0 }], [{ node: N.soTexto, type: "main", index: 0 }]] },
    [NE.detectar]: { main: [[{ node: NE.ehResposta, type: "main", index: 0 }]] },
    [NE.ehResposta]: { main: [[{ node: NE.pendenteAtual, type: "main", index: 0 }], [{ node: N.contexto, type: "main", index: 0 }]] },
    [NE.pendenteAtual]: { main: [[{ node: NE.decidir, type: "main", index: 0 }]] },
    [NE.decidir]: { main: [[{ node: NE.proximo, type: "main", index: 0 }]] },
    [NE.proximo]: {
      main: [
        [{ node: NE.apiConfirmar, type: "main", index: 0 }],
        [{ node: NE.apiCancelar, type: "main", index: 0 }],
        [{ node: N.responder, type: "main", index: 0 }],
        [{ node: N.contexto, type: "main", index: 0 }],
      ],
    },
    [NE.apiConfirmar]: { main: [[{ node: NE.respostaAcao, type: "main", index: 0 }]] },
    [NE.apiCancelar]: { main: [[{ node: NE.respostaAcao, type: "main", index: 0 }]] },
    [NE.respostaAcao]: { main: [[{ node: N.responder, type: "main", index: 0 }]] },
    [N.contexto]: { main: [[{ node: NE.agente, type: "main", index: 0 }]] },
    [NE.agente]: { main: [[{ node: NE.juntar, type: "main", index: 0 }]] },
    [NE.juntar]: { main: [[{ node: NE.proposta, type: "main", index: 0 }]] },
    [NE.proposta]: { main: [[{ node: N.interpretar, type: "main", index: 0 }]] },
    [N.interpretar]: { main: [[{ node: N.responder, type: "main", index: 0 }]] },
    [N.naoAutorizado]: { main: [[{ node: N.responder, type: "main", index: 0 }]] },
    [N.soTexto]: { main: [[{ node: N.responder, type: "main", index: 0 }]] },
    [N.modelo]: { ai_languageModel: [[{ node: NE.agente, type: "ai_languageModel", index: 0 }]] },
    [N.memoria]: { ai_memory: [[{ node: NE.agente, type: "ai_memory", index: 0 }]] },
    ...Object.fromEntries(todasFerramentas.map((f) => [f.name, { ai_tool: [[{ node: NE.agente, type: "ai_tool", index: 0 }]] }])),
    [NE.conhecimento]: { ai_tool: [[{ node: NE.agente, type: "ai_tool", index: 0 }]] },
    [NE.embConhecimento]: { ai_embedding: [[{ node: NE.conhecimento, type: "ai_embedding", index: 0 }]] },
    [N.verificacao]: { main: [[{ node: N.desafio, type: "main", index: 0 }]] },
    [N.desafio]: { main: [[{ node: N.responderDesafio, type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "all", saveManualExecutions: true },
  pinData: {},
  active: false,
  meta: {
    b2c: {
      workflow: "b2c-finance-ai-agent",
      knowledgeVersion: conhecimento.version,
      knowledgeCollection: conhecimento.collection,
      systemPrompt: "docs/AI_AGENT_SYSTEM_PROMPT.md",
      version: 1,
      catalogVersion: catalogo.version,
      writeCatalogVersion: escrita.version,
      apiVersion: catalogo.apiVersion,
      readOnly: false,
      writeMode: "confirmation",
      requiredScopes: scopesEscrita,
      generatedBy: "integrations/n8n/scripts/build-workflows.mjs",
    },
  },
  tags: [],
};
// O nó de webhook do agente com escrita tem caminho próprio (os dois podem
// coexistir no n8n; só um deve estar ligado ao número da Meta).
agenteEscrita.nodes = agenteEscrita.nodes.map((n) =>
  n.name === N.webhook ? { ...n, parameters: { ...n.parameters, path: "b2c-finance-ai-agent-v2" }, webhookId: "b2c-finance-ai-agent-v2" }
  : n.name === N.verificacao ? { ...n, parameters: { ...n.parameters, path: "b2c-finance-ai-agent-v2" }, webhookId: "b2c-finance-ai-agent-v2-verificacao" }
  : n
);

// ---------------------------------------------------------------------------
// Indexação da base de conhecimento (knowledge-ingest.json) — manual
//   API (GET /knowledge/documents) → apaga a coleção → um item por trecho →
//   Qdrant (embeddings OpenAI). Rodar de novo sempre que a versão mudar.
// ---------------------------------------------------------------------------

const NK = {
  gatilho: "Reindexar agora",
  api: "API: base de conhecimento",
  conferir: "Conferir pacote",
  apagar: "Qdrant: apagar coleção",
  trechos: "Um item por trecho",
  gravar: "Qdrant: gravar trechos",
  emb: "Embeddings (indexação)",
  loader: "Trecho → documento",
  splitter: "Sem nova divisão",
  resumo: "Resumo da indexação",
};

const JS_CONFERIR = `// Confere o pacote antes de apagar qualquer coisa: se a API falhou, a
// coleção atual fica intacta.
const r = $input.first().json || {};
if (r.success !== true || !r.data || !Array.isArray(r.data.trechos) || r.data.trechos.length === 0) {
  throw new Error('A API não devolveu a base de conhecimento (confira o scope knowledge.read). Nada foi apagado.');
}
if (r.data.embedding.model !== ${JSON.stringify(conhecimento.embedding.model)}) {
  throw new Error('Modelo de embedding do pacote (' + r.data.embedding.model + ') diferente do workflow: gere o workflow de novo.');
}
if (!$env.QDRANT_URL) throw new Error('QDRANT_URL não configurado.');
return [{ json: { collection: r.data.collection, version: r.data.version, trechos: r.data.trechos.length } }];`;

const JS_TRECHOS = `// Um item por trecho: texto + metadados (documento, seção, fonte, versão).
const pacote = $('${NK.api}').first().json.data;
return pacote.trechos.map((t) => ({ json: { text: t.text, ...t.metadata, trechoId: t.id, versao: pacote.version } }));`;

const metaCampo = (nome) => ({ name: nome, value: `={{ $json.${nome} }}` });

const ingestao = {
  name: "B2C · Conhecimento · Indexar base (manual)",
  nodes: [
    nota(
      "Nota: sobre este workflow",
      `## Indexar a base de conhecimento (RAG)\n\n**RAG = conhecimento e documentação. API = dados atuais.** Esta base só tem conceitos, regras e procedimentos — nunca saldo, MRR, clientes ativos, recebimentos, despesas, status atual ou inadimplência.\n\n1. Lê o pacote na API (\`GET /knowledge/documents\`, scope \`knowledge.read\`).\n2. Apaga a coleção \`${conhecimento.collection}\` no Qdrant e grava os trechos de novo (embeddings ${conhecimento.embedding.model}).\n\nRode de novo sempre que a versão do pacote mudar (docs alterados + deploy). Guia: docs/AI_AGENT_KNOWLEDGE.md.\n\nNunca use o banco do B2C Finance (nem Supabase) como vector store.`,
      [-460, -60], 420, 420, 6
    ),
    { parameters: {}, name: NK.gatilho, type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 200], notes: "Indexação manual (não há gatilho automático).", notesInFlow: true },
    {
      parameters: {
        url: "={{ $env.B2C_FINANCE_API_URL }}/knowledge/documents",
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "X-B2C-Source", value: "n8n" }, { name: "x-request-id", value: "={{ 'n8n-' + $execution.id }}" }] },
        options: {},
      },
      name: NK.api,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [220, 200],
      credentials: CRED_B2C,
      notes: "GET /knowledge/documents (scope knowledge.read).",
      notesInFlow: true,
    },
    code(NK.conferir, JS_CONFERIR, [440, 200], "Pacote válido antes de apagar a coleção."),
    {
      parameters: {
        method: "DELETE",
        url: "={{ $env.QDRANT_URL }}/collections/{{ $json.collection }}",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "qdrantApi",
        options: { response: { response: { neverError: true } } },
      },
      name: NK.apagar,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [660, 200],
      credentials: CRED_QDRANT,
      notes: "Reindexação limpa (coleção inexistente = segue).",
      notesInFlow: true,
    },
    code(NK.trechos, JS_TRECHOS, [880, 200], "Um item por trecho, com metadados."),
    {
      parameters: { mode: "insert", qdrantCollection: colecao, options: {} },
      name: NK.gravar,
      type: "@n8n/n8n-nodes-langchain.vectorStoreQdrant",
      typeVersion: 1.3,
      position: [1100, 200],
      credentials: CRED_QDRANT,
      notes: `Grava na coleção ${conhecimento.collection} (recriada aqui).`,
      notesInFlow: true,
    },
    embeddings(NK.emb, [1040, 420]),
    {
      parameters: {
        dataType: "json",
        jsonMode: "expressionData",
        jsonData: "={{ $json.text }}",
        textSplittingMode: "custom",
        options: {
          metadata: {
            metadataValues: ["docId", "titulo", "categoria", "secao", "fonte", "atualizado_em", "tipo", "trechoId", "versao"].map(metaCampo),
          },
        },
      },
      name: NK.loader,
      type: "@n8n/n8n-nodes-langchain.documentDefaultDataLoader",
      typeVersion: 1.1,
      position: [1220, 420],
      notes: "Texto do trecho + metadados.",
      notesInFlow: true,
    },
    {
      parameters: { chunkSize: 4000, chunkOverlap: 0, options: {} },
      name: NK.splitter,
      type: "@n8n/n8n-nodes-langchain.textSplitterRecursiveCharacterTextSplitter",
      typeVersion: 1,
      position: [1320, 600],
      notes: "Os trechos já vêm no tamanho certo (por seção): não dividir de novo.",
      notesInFlow: true,
    },
    code(
      NK.resumo,
      `// Quantos trechos foram gravados e de qual versão.\nconst p = $('${NK.conferir}').first().json;\nreturn [{ json: { colecao: p.collection, versao: p.version, trechosNoPacote: p.trechos, gravados: $input.all().length } }];`,
      [1320, 200],
      "Versão indexada e contagem."
    ),
  ],
  connections: {
    [NK.gatilho]: { main: [[{ node: NK.api, type: "main", index: 0 }]] },
    [NK.api]: { main: [[{ node: NK.conferir, type: "main", index: 0 }]] },
    [NK.conferir]: { main: [[{ node: NK.apagar, type: "main", index: 0 }]] },
    [NK.apagar]: { main: [[{ node: NK.trechos, type: "main", index: 0 }]] },
    [NK.trechos]: { main: [[{ node: NK.gravar, type: "main", index: 0 }]] },
    [NK.gravar]: { main: [[{ node: NK.resumo, type: "main", index: 0 }]] },
    [NK.emb]: { ai_embedding: [[{ node: NK.gravar, type: "ai_embedding", index: 0 }]] },
    [NK.loader]: { ai_document: [[{ node: NK.gravar, type: "ai_document", index: 0 }]] },
    [NK.splitter]: { ai_textSplitter: [[{ node: NK.loader, type: "ai_textSplitter", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
  pinData: {},
  active: false,
  meta: {
    b2c: {
      workflow: "knowledge-ingest",
      version: 1,
      knowledgeVersion: conhecimento.version,
      collection: conhecimento.collection,
      embeddingModel: conhecimento.embedding.model,
      requiredScopes: ["knowledge.read"],
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
// Agente com escrita (b2c-finance-ai-agent): além dos de consulta.
const paraEscrita = ${JSON.stringify(scopesEscrita)};
// Indexação da base de conhecimento (knowledge-ingest).
const paraConhecimento = ["knowledge.read"];
const me = $input.first().json;
const tem = (me.data && me.data.scopes) || [];
const faltando = necessarios.filter((s) => !tem.includes(s));
const faltandoParaEscrita = paraEscrita.filter((s) => !tem.includes(s));
const faltandoParaConhecimento = paraConhecimento.filter((s) => !tem.includes(s));
const excesso = tem.filter((s) => !paraEscrita.includes(s) && !paraConhecimento.includes(s));
return [{ json: { ok: faltando.length === 0, okParaEscrita: faltandoParaEscrita.length === 0, okParaConhecimento: faltandoParaConhecimento.length === 0, integracao: me.data && me.data.name, faltando, faltandoParaEscrita, faltandoParaConhecimento, scopesAlemDoNecessario: excesso, requestId: me.meta && me.meta.requestId } }];`,
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
gravar("b2c-finance-ai-agent.json", agenteEscrita);
gravar("knowledge-ingest.json", ingestao);
gravar("sistema.teste-conexao.v1.json", teste);
console.log(`Workflows gerados (somente leitura: ${ferramentas.length} ferramentas; com escrita: ${todasFerramentas.length} ferramentas, scopes: ${scopesEscrita.join(", ")}).`);
