#!/usr/bin/env node
/**
 * Gera os workflows do canal TELEGRAM (Fase 16 · bloco 1) — parte do
 * `npm run n8n:build`:
 *
 *   workflows/b2c-finance-telegram-agent-readonly.json  agente de consulta no Telegram
 *   workflows/telegram-connection-test.json             teste de conexão (Telegram, API, identidade, Qdrant)
 *
 * O agente é o MESMO do WhatsApp (ferramentas da API, base de conhecimento,
 * prompt de docs/AI_AGENT_SYSTEM_PROMPT.md, RBAC pelo vínculo); o que muda é
 * a entrada e a saída:
 *  · identidade = Telegram User ID (message.from.id), resolvida pela API;
 *  · só chat PRIVADO; grupo recebe uma orientação genérica; canal é ignorado;
 *  · deduplicação por update_id;
 *  · /start, /help e /status respondidos sem IA;
 *  · saída em HTML com escape de TODO conteúdo dinâmico e divisão em partes.
 * docs/TELEGRAM.md explica instalação e configuração.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RAIZ_N8N, catalogo, conhecimento, CRED_B2C, CRED_TELEGRAM, CRED_QDRANT, ferramenta, code, se, nota, apiDeControle,
  jsPermissoes, embeddings, ferramentaConhecimento, montarPrompt, modeloIA, memoriaDaConversa, JS_HOJE,
} from "./lib/pecas.mjs";

// Nomes dos nós (referenciados em expressões — um lugar só).
const T = {
  gatilho: "Telegram: receber mensagem",
  normalizar: "Normalizar update",
  dedupe: "Deduplicar update (update_id)",
  privado: "Chat privado?",
  foraDoPrivado: "Resposta: só no privado",
  extrair: "Extrair Telegram User ID",
  resolver: "API: resolver identidade",
  permissoes: "Carregar permissões",
  roteiro: "Roteiro da mensagem",
  vaiAgente: "Vai para o agente?",
  contexto: "Montar contexto do agente",
  agente: "AI Agent B2C Finance (Telegram, somente leitura)",
  modelo: "Modelo de IA",
  memoria: "Memória da conversa",
  conhecimento: "consultar_conhecimento",
  embConhecimento: "Embeddings (conhecimento)",
  juntar: "Juntar resposta e contexto",
  formatar: "Formatar para o Telegram",
  enviar: "Telegram: enviar mensagem",
};

// ---------------------------------------------------------------------------
// Código dos nós
// ---------------------------------------------------------------------------

export const JS_NORMALIZAR = `// ETAPA 1 — Normalizar o update do Telegram em UMA mensagem por item.
// Só "message" (texto ou não). Outros updates (edições, posts de canal,
// callbacks) não chegam aqui: o gatilho escuta só "message".
const COMANDOS = ['/start', '/help', '/status'];
const saida = [];
for (const item of $input.all()) {
  const u = item.json || {};
  const m = u.message;
  if (!m || !m.chat) continue;
  const de = m.from || null;
  const texto = typeof m.text === 'string' ? m.text.slice(0, 2000) : '';
  const primeira = texto.trim().split(/\\s+/)[0] || '';
  // "/start@MeuBot" (grupos) → "/start"
  const cmd = primeira.startsWith('/') ? primeira.split('@')[0].toLowerCase() : null;
  saida.push({
    json: {
      updateId: u.update_id,
      messageId: 'tg:' + m.chat.id + ':' + m.message_id,
      chatId: m.chat.id,
      chatType: String(m.chat.type || ''),
      // Identidade = Telegram User ID. username/nome são só exibição.
      fromId: de && !de.is_bot && de.id ? String(de.id) : null,
      isBot: !!(de && de.is_bot),
      username: (de && de.username) || null,
      firstName: (de && de.first_name) || null,
      tipo: typeof m.text === 'string' ? 'text' : 'outro',
      text: texto,
      comando: cmd ? (COMANDOS.includes(cmd) ? cmd : 'desconhecido') : null,
    },
  });
}
return saida;`;

export const JS_DEDUPE = `// ETAPA 2 — Deduplicar pelo update_id: o Telegram REENVIA o update quando não
// recebe 200 a tempo, e o mesmo update não pode gerar duas respostas.
// Guarda os últimos ids no static data do workflow (vale nas execuções de
// produção — o mesmo mecanismo do agente do WhatsApp).
const vistos = $getWorkflowStaticData('global');
vistos.telegramUpdates = vistos.telegramUpdates || [];
const saida = [];
for (const item of $input.all()) {
  const id = item.json.updateId;
  if (id === undefined || id === null || vistos.telegramUpdates.includes(id)) continue;
  vistos.telegramUpdates.push(id);
  saida.push(item);
}
vistos.telegramUpdates = vistos.telegramUpdates.slice(-1000);
return saida;`;

export const JS_FORA_DO_PRIVADO = `// Fora do chat privado NADA financeiro acontece: não consulta a API, não
// identifica, não chama a IA. Grupo/supergrupo recebe uma orientação
// genérica; canal, bot e remetente anônimo são ignorados em silêncio.
return $input.all().flatMap((item) => {
  const m = item.json;
  const grupo = m.chatType === 'group' || m.chatType === 'supergroup';
  if (!grupo || !m.fromId) return [];
  // Em grupo, só responde a comando ou menção (bot com modo de privacidade só recebe isso).
  return [{ json: { chatId: m.chatId, texto: 'Por segurança, eu só atendo em conversa privada. Fale comigo no privado.' } }];
});`;

export const JS_EXTRAIR = `// ETAPA 3 — Telegram User ID de quem escreveu (message.from.id). É ele — e
// nunca o @username — que a API usa para achar o vínculo.
return $input.all().filter((item) => !!item.json.fromId).map((item) => ({ json: { ...item.json, externalIdentifier: item.json.fromId } }));`;

const FERRAMENTA_SCOPES = Object.fromEntries(catalogo.tools.map((t) => [t.name, [t.scope]]));

const JS_PERMISSOES = jsPermissoes(
  T.extrair,
  FERRAMENTA_SCOPES,
  `// ETAPA 4 — Carregar permissões a partir da RESPOSTA DA API (nunca da mensagem
// nem da IA). O usuário é o do VÍNCULO (Configurações → Integrações → Canais).
// Ferramenta liberada = a API devolveu o scope dela em allowedScopes
// (conta ∩ RBAC do usuário). Não existe scope "de Telegram".`
);

export const JS_ROTEIRO = `// ETAPA 5 — O que responder SEM IA: não vinculado, /start, /help, /status,
// mensagem que não é texto. O resto vai para o agente.
// Texto com *negrito*; o conteúdo dinâmico é escapado na formatação.
const AJUDA = [
  'Pergunte em linguagem natural. Exemplos:',
  '• Quanto recebemos hoje?',
  '• Quem está inadimplente?',
  '• Qual nosso MRR?',
  '• Quais clientes renovam este mês?',
  '• Qual nosso churn?',
  '• O que é TCV?',
  '',
  'Comandos: /start · /help · /status',
].join('\\n');
return $input.all().map((item) => {
  const m = item.json;
  const responder = (texto) => ({ json: { ...m, rota: 'responder', texto } });
  if (!m.authorized) {
    if (m.motivo === 'numero_nao_vinculado') {
      return responder('Olá! Seu Telegram ainda não está vinculado ao B2C Finance.\\n\\nSeu identificador Telegram é:\\n*' + m.fromId + '*\\n\\nSolicite a um administrador que vincule este ID ao seu usuário no B2C Finance.');
    }
    if (m.motivo === 'usuario_restrito_a_agencia') {
      return responder('Seu acesso é restrito a uma agência, e o atendimento pelo Telegram ainda não cobre esse caso. Use o B2C Finance.');
    }
    return responder('Não consegui verificar seu acesso agora. Tente de novo em instantes.');
  }
  if (m.comando === '/start') {
    return responder('Olá, *' + m.userName + '*.\\n\\nVocê está conectado ao B2C Finance.\\n\\n' + AJUDA);
  }
  if (m.comando === '/help') return responder(AJUDA);
  if (m.comando === '/status') {
    return responder('*B2C Finance conectado*\\nUsuário: ' + m.userName + '\\nPerfil: ' + (m.roleLabel || '—'));
  }
  if (m.comando === 'desconhecido') return responder('Comando não reconhecido. Mande /help para ver o que eu faço.');
  if (m.tipo !== 'text' || !m.text.trim()) return responder('Por enquanto eu entendo só mensagens de texto. Pode escrever a sua pergunta?');
  return { json: { ...m, rota: 'agente' } };
});`;

export const JS_CONTEXTO = `// ETAPA 6 — Contexto do agente: quem pergunta, o que pode usar, canal e a
// data de hoje (fuso America/Bahia) para resolver "mês passado", "ontem" etc.
const hoje = ${JS_HOJE};
return $input.all().map((item) => ({
  json: {
    ...item.json,
    sessionId: 'tg:' + item.json.fromId,
    hoje,
    competenciaAtual: hoje.slice(0, 7),
  },
}));`;

export const JS_JUNTAR = `// A saída do agente traz só o texto; o chat vem do contexto, pelo índice.
const ctxs = $('${T.contexto}').all();
return $input.all().map((item, i) => {
  const ctx = (ctxs[i] || ctxs[0] || {}).json || {};
  return { json: { chatId: ctx.chatId, output: typeof item.json.output === 'string' ? item.json.output : null } };
});`;

/**
 * SAÍDA SEGURA PARA O TELEGRAM (HTML).
 *  · TODO texto é escapado (&, <, >) ANTES de virar HTML: nada que venha da
 *    API, do usuário ou da IA vira tag;
 *  · depois, só negrito (entre um ou dois asteriscos) → <b> e `código` → <code>;
 *  · limite do Telegram: 4096 caracteres por mensagem. Quebra por parágrafo,
 *    depois por linha; no máximo 4 partes ("Parte 1/3"), e avisa quando corta;
 *  · sem texto (erro do modelo/ferramenta) → mensagem neutra, sem detalhe técnico.
 */
export const JS_FORMATAR = `// ETAPA 8 — Formatar para o Telegram (HTML seguro + divisão em partes).
const LIMITE = 3500;           // margem sob os 4096 do Telegram (o escape aumenta o texto)
const MAX_PARTES = 4;
const FALHA = 'Não consegui concluir essa consulta agora. A tentativa foi registrada.';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = (s) => esc(s)
  .replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<b>$1</b>')
  .replace(/\\*([^*\\n]+)\\*/g, '<b>$1</b>')
  .replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
// Tabela markdown não existe no Telegram: vira linhas "a · b · c".
const semTabela = (t) => t
  .replace(/^\\s*\\|.*\\|\\s*$/gm, (l) => l.replace(/\\s*\\|\\s*/g, ' · ').replace(/^ · | · $/g, ''))
  .replace(/^\\s*[-·:\\s]+$/gm, '');
function partir(texto) {
  const partes = [];
  let atual = '';
  const blocos = texto.split(/\\n{2,}/);
  const pedacos = [];
  for (const b of blocos) {
    if (html(b).length <= LIMITE) { pedacos.push(b); continue; }
    // parágrafo enorme: por linha; linha enorme: por tamanho, no último espaço
    for (let linha of b.split('\\n')) {
      while (html(linha).length > LIMITE) {
        let corte = linha.lastIndexOf(' ', LIMITE / 2);
        if (corte < 1) corte = Math.floor(LIMITE / 2);
        pedacos.push(linha.slice(0, corte));
        linha = linha.slice(corte).trimStart();
      }
      pedacos.push(linha);
    }
  }
  for (const p of pedacos) {
    const junto = atual ? atual + '\\n\\n' + p : p;
    if (html(junto).length > LIMITE && atual) { partes.push(atual); atual = p; } else atual = junto;
  }
  if (atual.trim()) partes.push(atual);
  return partes;
}
return $input.all().flatMap((item) => {
  const j = item.json;
  let texto = typeof j.texto === 'string' ? j.texto : j.output;
  if (typeof texto !== 'string' || !texto.trim()) texto = FALHA;
  let partes = partir(semTabela(texto.trim()));
  if (partes.length > MAX_PARTES) {
    partes = partes.slice(0, MAX_PARTES);
    partes[MAX_PARTES - 1] += '\\n\\n(Resposta longa — peça um recorte menor para ver o resto.)';
  }
  return partes.map((p, i) => ({
    json: { chatId: j.chatId, text: (partes.length > 1 ? '<i>Parte ' + (i + 1) + '/' + partes.length + '</i>\\n' : '') + html(p) },
  }));
});`;

// ---------------------------------------------------------------------------
// Nós do Telegram
// ---------------------------------------------------------------------------

const gatilhoTelegram = (nome, webhookId, pos) => ({
  parameters: { updates: ["message"], additionalFields: {} },
  name: nome,
  type: "n8n-nodes-base.telegramTrigger",
  typeVersion: 1.2,
  position: pos,
  webhookId,
  credentials: CRED_TELEGRAM,
  notes:
    "Registra o webhook no Telegram ao ativar, com secret_token: update sem o header X-Telegram-Bot-Api-Secret-Token certo é recusado (403). Um gatilho por bot.",
  notesInFlow: true,
});

const enviarTelegram = (nome, pos, chatId = "={{ $json.chatId }}") => ({
  parameters: {
    resource: "message",
    operation: "sendMessage",
    chatId,
    text: "={{ $json.text }}",
    additionalFields: { appendAttribution: false, parse_mode: "HTML", disable_web_page_preview: true },
  },
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  credentials: CRED_TELEGRAM,
  notes: "sendMessage em HTML (o texto já vem escapado e dividido).",
  notesInFlow: true,
});

// ---------------------------------------------------------------------------
// Agente somente leitura
// ---------------------------------------------------------------------------

const ferramentas = catalogo.tools.map((t, i) => ({
  ...ferramenta(t, i, "telegram"),
  position: [2160 + (i % 6) * 170, 700 + Math.floor(i / 6) * 180],
}));
const scopesLeitura = [...new Set([...catalogo.tools.map((t) => t.scope), "identities.resolve"])].sort();

const contextoDoPrompt =
  "\n\n## Contexto desta conversa\n- Canal: Telegram (conversa privada)\n- Usuário (vínculo verificado pela API): {{ $json.userName }} — {{ $json.roleLabel }}\n- Ferramentas liberadas para este usuário: {{ $json.allowedTools.join(', ') }}\n- Base de conhecimento: consultar_conhecimento (conceitos e procedimentos; nunca dados atuais)\n- Hoje: {{ $json.hoje }} (competência atual {{ $json.competenciaAtual }}, fuso America/Bahia)";

const agenteLeitura = {
  name: "B2C Finance · Telegram · AI Agent (somente leitura)",
  nodes: [
    nota(
      "Nota: sobre este workflow",
      `## B2C Finance · Telegram · AI Agent (somente leitura)\n\nAtende a equipe no **Telegram** (conversa privada com o bot), CONSULTANDO a API do B2C Finance.\n\n- **Somente leitura:** nenhuma ferramenta escreve.\n- **Identidade = Telegram User ID** (message.from.id), resolvida pela API pelo vínculo em Configurações → Integrações → Canais. O @username nunca identifica.\n- **Nunca** acessa banco, Supabase ou Prisma — só a API (\`$env.B2C_FINANCE_API_URL\`).\n- Bot token só na **credencial** "Telegram Bot" — nada no workflow.\n- **Não ative** antes do teste (docs/TELEGRAM.md).\n\nFonte: integrations/n8n (gerado por scripts/build-telegram-workflows.mjs).`,
      [-480, -80], 440, 420, 7
    ),
    nota(
      "Nota: entrada e segurança",
      `### 1–3 · Entrada e segurança\nO gatilho confere o secret_token do webhook (o Telegram manda em cada update). Normaliza, **deduplica por update_id** e só segue em **chat privado**: grupo recebe orientação genérica; canal, bot e remetente anônimo são ignorados. Nada financeiro fora do privado.`,
      [-20, 160], 900, 330, 5
    ),
    nota(
      "Nota: identidade e comandos",
      `### 4–5 · Quem é, o que pode, comandos\nA **API** resolve o Telegram User ID. Não vinculado → mostra o próprio ID para o administrador vincular, **nenhum dado**. /start, /help e /status são respondidos sem IA. Ferramentas = scopes que a API liberou (conta ∩ RBAC).`,
      [900, 160], 900, 330, 4
    ),
    nota(
      "Nota: agente e saída",
      `### 6–8 · Agente e resposta\nDados atuais: GET na API (ferramentas). Conceitos: \`consultar_conhecimento\` (Qdrant) — nunca número atual. Se o Qdrant cair, só essa ferramenta falha; as consultas à API seguem.\nSaída em **HTML** com escape de todo conteúdo dinâmico, dividida em partes (limite de 4096 do Telegram).`,
      [1900, 160], 1300, 1100, 6
    ),
    gatilhoTelegram(T.gatilho, "b2c-finance-telegram-agent-readonly", [0, 300]),
    code(T.normalizar, JS_NORMALIZAR, [200, 300], "Update → uma mensagem (id, chat, tipo, comando)."),
    code(T.dedupe, JS_DEDUPE, [400, 300], "Mesmo update_id não é processado duas vezes."),
    se(T.privado, "={{ $json.chatType === 'private' && !!$json.fromId }}", [600, 300], "Só conversa privada, com pessoa (não bot)."),
    code(T.foraDoPrivado, JS_FORA_DO_PRIVADO, [800, 520], "Grupo: orientação genérica. Canal/bot: nada."),
    code(T.extrair, JS_EXTRAIR, [800, 300], "message.from.id — a identidade oficial."),
    apiDeControle(T.resolver, "POST", "/integrations/resolve-identity", [1000, 300], "Telegram User ID → usuário vinculado (API).", {
      fonte: "telegram",
      semIdentidade: true,
      jsonBody: "={{ JSON.stringify({ channel: 'TELEGRAM', externalIdentifier: $json.externalIdentifier }) }}",
    }),
    code(T.permissoes, JS_PERMISSOES, [1200, 300], "Ferramentas = scopes que a API liberou para o usuário."),
    code(T.roteiro, JS_ROTEIRO, [1400, 300], "Não vinculado, /start, /help, /status: sem IA."),
    se(T.vaiAgente, "={{ $json.rota === 'agente' }}", [1600, 300], "Pergunta de verdade → agente; o resto já tem resposta."),
    code(T.contexto, JS_CONTEXTO, [1800, 240], "Sessão, data de hoje e ferramentas do usuário."),
    {
      parameters: {
        promptType: "define",
        text: "={{ $json.text }}",
        options: {
          systemMessage: "=" + montarPrompt("leitura") + contextoDoPrompt,
          maxIterations: 8,
          returnIntermediateSteps: false,
        },
      },
      name: T.agente,
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.7,
      position: [2020, 240],
      onError: "continueRegularOutput",
      notes: "Escolhe as ferramentas (GET na API + conhecimento) e redige a resposta. Somente leitura.",
      notesInFlow: true,
    },
    modeloIA(T.modelo, [1980, 520]),
    memoriaDaConversa(T.memoria, [2160, 520]),
    ...ferramentas,
    ferramentaConhecimento(T.conhecimento, [2340, 1100]),
    embeddings(T.embConhecimento, [2340, 1280]),
    code(T.juntar, JS_JUNTAR, [2240, 240], "Resposta da IA + chat de destino."),
    code(T.formatar, JS_FORMATAR, [2460, 320], "HTML seguro + partes (limite do Telegram)."),
    enviarTelegram(T.enviar, [2680, 320]),
  ],
  connections: {
    [T.gatilho]: { main: [[{ node: T.normalizar, type: "main", index: 0 }]] },
    [T.normalizar]: { main: [[{ node: T.dedupe, type: "main", index: 0 }]] },
    [T.dedupe]: { main: [[{ node: T.privado, type: "main", index: 0 }]] },
    [T.privado]: { main: [[{ node: T.extrair, type: "main", index: 0 }], [{ node: T.foraDoPrivado, type: "main", index: 0 }]] },
    [T.foraDoPrivado]: { main: [[{ node: T.formatar, type: "main", index: 0 }]] },
    [T.extrair]: { main: [[{ node: T.resolver, type: "main", index: 0 }]] },
    [T.resolver]: { main: [[{ node: T.permissoes, type: "main", index: 0 }]] },
    [T.permissoes]: { main: [[{ node: T.roteiro, type: "main", index: 0 }]] },
    [T.roteiro]: { main: [[{ node: T.vaiAgente, type: "main", index: 0 }]] },
    [T.vaiAgente]: { main: [[{ node: T.contexto, type: "main", index: 0 }], [{ node: T.formatar, type: "main", index: 0 }]] },
    [T.contexto]: { main: [[{ node: T.agente, type: "main", index: 0 }]] },
    [T.agente]: { main: [[{ node: T.juntar, type: "main", index: 0 }]] },
    [T.juntar]: { main: [[{ node: T.formatar, type: "main", index: 0 }]] },
    [T.formatar]: { main: [[{ node: T.enviar, type: "main", index: 0 }]] },
    [T.modelo]: { ai_languageModel: [[{ node: T.agente, type: "ai_languageModel", index: 0 }]] },
    [T.memoria]: { ai_memory: [[{ node: T.agente, type: "ai_memory", index: 0 }]] },
    ...Object.fromEntries(ferramentas.map((f) => [f.name, { ai_tool: [[{ node: T.agente, type: "ai_tool", index: 0 }]] }])),
    [T.conhecimento]: { ai_tool: [[{ node: T.agente, type: "ai_tool", index: 0 }]] },
    [T.embConhecimento]: { ai_embedding: [[{ node: T.conhecimento, type: "ai_embedding", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "all", saveManualExecutions: true },
  pinData: {},
  active: false,
  meta: {
    b2c: {
      workflow: "b2c-finance-telegram-agent-readonly",
      channel: "TELEGRAM",
      version: 1,
      catalogVersion: catalogo.version,
      apiVersion: catalogo.apiVersion,
      readOnly: true,
      knowledgeVersion: conhecimento.version,
      knowledgeCollection: conhecimento.collection,
      systemPrompt: "docs/AI_AGENT_SYSTEM_PROMPT.md (prompt-base + prompt-leitura)",
      requiredScopes: scopesLeitura,
      generatedBy: "integrations/n8n/scripts/build-telegram-workflows.mjs",
    },
  },
  tags: [],
};

// ---------------------------------------------------------------------------
// Teste de conexão do Telegram (manual): API, identidade, Qdrant → mensagem
// ---------------------------------------------------------------------------

const K = {
  gatilho: "Executar teste",
  health: "API: /health",
  me: "API: /me",
  identidade: "API: resolver identidade (teste)",
  qdrant: "Qdrant: coleção de conhecimento",
  consolidar: "Consolidar resultado",
  enviar: "Telegram: enviar resultado",
};

export const JS_CONSOLIDAR = `// Junta o resultado de cada dependência numa mensagem. "Telegram: OK" é
// provado pela própria mensagem chegar no seu Telegram.
const necessarios = ${JSON.stringify(scopesLeitura)};
const ok = (nome) => { const j = $(nome).first().json || {}; return j.success === true ? j : null; };
const health = ok('${K.health}');
const me = ok('${K.me}');
const identidade = ok('${K.identidade}');
const q = $('${K.qdrant}').first().json || {};
const pontos = q.result && typeof q.result.points_count === 'number' ? q.result.points_count : null;
const scopes = (me && me.data && me.data.scopes) || [];
const faltando = necessarios.filter((s) => !scopes.includes(s));
const linha = (nome, bom, detalhe) => nome + ': ' + (bom ? 'OK' : 'FALHOU') + (detalhe ? ' — ' + detalhe : '');
const res = {
  api: !!health,
  conta: !!me && faltando.length === 0,
  identidade: !!identidade,
  qdrant: pontos !== null && pontos > 0,
};
const tudo = res.api && res.conta && res.identidade && res.qdrant;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const linhas = [
  '<b>Teste de conexão — B2C Finance</b>',
  'Telegram: OK',
  linha('B2C API', res.api),
  linha('Service Account', res.conta, me ? (faltando.length ? 'faltam scopes: ' + faltando.join(', ') : '') : 'token recusado'),
  linha('Identity', res.identidade, res.identidade ? '' : 'confira TELEGRAM_TEST_USER_ID e o vínculo em Integrações → Canais'),
  linha('Qdrant', res.qdrant, pontos === null ? 'coleção inacessível' : pontos === 0 ? 'coleção vazia — rode a indexação' : pontos + ' trechos'),
  linha('Agent dependencies', tudo),
];
return [{ json: { ok: tudo, ...res, faltando, trechosNoQdrant: pontos, text: linhas.map((l, i) => (i === 0 ? l : esc(l))).join('\\n') } }];`;

const getDeTeste = (nome, caminho, pos) =>
  apiDeControle(nome, "GET", caminho, pos, `GET ${caminho}`, { fonte: "telegram", semIdentidade: true });

const teste = {
  name: "B2C · Telegram · Teste de conexão",
  nodes: [
    nota(
      "Nota: sobre este teste",
      `## Teste de conexão do Telegram\n\nExecute manualmente. Confere, **sem nenhuma escrita**: API (\`/health\`), conta de serviço e scopes (\`/me\`), o vínculo do seu Telegram (\`TELEGRAM_TEST_USER_ID\`), a coleção de conhecimento no Qdrant — e manda o resultado para o seu Telegram (o que prova o bot).\n\nEsperado: Telegram, B2C API, Service Account, Identity, Qdrant e Agent dependencies = OK.`,
      [-460, -120], 420, 320, 6
    ),
    { parameters: {}, name: K.gatilho, type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 200], notes: "Execução manual.", notesInFlow: true },
    getDeTeste(K.health, "/health", [200, 200]),
    getDeTeste(K.me, "/me", [400, 200]),
    apiDeControle(K.identidade, "POST", "/integrations/resolve-identity", [600, 200], "Seu Telegram User ID está vinculado?", {
      fonte: "telegram",
      semIdentidade: true,
      jsonBody: "={{ JSON.stringify({ channel: 'TELEGRAM', externalIdentifier: String($env.TELEGRAM_TEST_USER_ID || '') }) }}",
    }),
    {
      parameters: {
        url: `={{ $env.QDRANT_URL }}/collections/${conhecimento.collection}`,
        authentication: "predefinedCredentialType",
        nodeCredentialType: "qdrantApi",
        options: { response: { response: { neverError: true } } },
      },
      name: K.qdrant,
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [800, 200],
      credentials: CRED_QDRANT,
      onError: "continueRegularOutput",
      alwaysOutputData: true,
      notes: "Coleção existe e tem trechos?",
      notesInFlow: true,
    },
    code(K.consolidar, JS_CONSOLIDAR, [1000, 200], "OK/FALHOU por dependência."),
    enviarTelegram(K.enviar, [1200, 200], "={{ $env.TELEGRAM_TEST_USER_ID }}"),
  ],
  connections: {
    [K.gatilho]: { main: [[{ node: K.health, type: "main", index: 0 }]] },
    [K.health]: { main: [[{ node: K.me, type: "main", index: 0 }]] },
    [K.me]: { main: [[{ node: K.identidade, type: "main", index: 0 }]] },
    [K.identidade]: { main: [[{ node: K.qdrant, type: "main", index: 0 }]] },
    [K.qdrant]: { main: [[{ node: K.consolidar, type: "main", index: 0 }]] },
    [K.consolidar]: { main: [[{ node: K.enviar, type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
  pinData: {},
  active: false,
  meta: {
    b2c: {
      workflow: "telegram-connection-test",
      channel: "TELEGRAM",
      version: 1,
      readOnly: true,
      requiredScopes: scopesLeitura,
      generatedBy: "integrations/n8n/scripts/build-telegram-workflows.mjs",
    },
  },
  tags: [],
};

if (process.argv[1] && process.argv[1].endsWith("build-telegram-workflows.mjs")) {
  const gravar = (arquivo, wf) => writeFileSync(join(RAIZ_N8N, "workflows", arquivo), JSON.stringify(wf, null, 2) + "\n");
  gravar("b2c-finance-telegram-agent-readonly.json", agenteLeitura);
  gravar("telegram-connection-test.json", teste);
  console.log(`Telegram: agente somente leitura (${ferramentas.length} ferramentas + conhecimento) e teste de conexão gerados.`);
}
