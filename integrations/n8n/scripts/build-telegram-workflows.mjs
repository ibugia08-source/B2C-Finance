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
  RAIZ_N8N, lerJson, catalogo, conhecimento, CRED_B2C, CRED_TELEGRAM, CRED_QDRANT, ferramenta, ferramentaDeEscrita, code, se, nota, apiDeControle,
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
  limite: "Limitar mensagens por pessoa",
  dentroDoLimite: "Dentro do limite?",
  falhaApi: "Falha da API?",
  registrar: "Registrar falha da API",
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

export const JS_LIMITE = `// ETAPA 2b — Anti-flood por pessoa (Telegram User ID), antes de qualquer
// chamada à API ou à IA: no máximo TELEGRAM_MAX_UPDATES_POR_MINUTO (padrão 20)
// mensagens/toques por minuto. Passou: um aviso (uma vez) e o resto é
// descartado até a janela andar. Corta laço de automação e flood no agente.
const MAX = Number($env.TELEGRAM_MAX_UPDATES_POR_MINUTO) || 20;
const JANELA = 60000;
const agora = Date.now();
const st = $getWorkflowStaticData('global');
st.telegramRitmo = st.telegramRitmo || {};
for (const k of Object.keys(st.telegramRitmo)) {
  st.telegramRitmo[k] = st.telegramRitmo[k].filter((t) => agora - t < JANELA);
  if (!st.telegramRitmo[k].length) delete st.telegramRitmo[k];
}
const saida = [];
for (const item of $input.all()) {
  const quem = String(item.json.fromId);
  const lista = (st.telegramRitmo[quem] = st.telegramRitmo[quem] || []);
  lista.push(agora);
  if (lista.length <= MAX) { saida.push({ json: { ...item.json, limitado: false } }); continue; }
  if (lista.length === MAX + 1) {
    saida.push({ json: { chatId: item.json.chatId, limitado: true, texto: 'Muitas mensagens em pouco tempo. Aguarde um minuto e tente de novo.' } });
  }
}
return saida;`;

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
    // API fora do ar (ou erro dela): nada de IA/RAG inventando dado atual; a
    // execução é marcada como erro no n8n (registro) depois do aviso.
    return { json: { ...m, rota: 'responder', falhaApi: true, texto: 'Não consegui acessar os dados do B2C Finance neste momento. Tente novamente em alguns minutos.' } };
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

/** Escape + negrito/código → HTML do Telegram (o mesmo em toda saída). */
export const JS_HTML = `const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = (s) => esc(s)
  .replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<b>$1</b>')
  .replace(/\\*([^*\\n]+)\\*/g, '<b>$1</b>')
  .replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');`;

/**
 * SAÍDA SEGURA PARA O TELEGRAM (HTML).
 *  · TODO texto é escapado (&, <, >) ANTES de virar HTML: nada que venha da
 *    API, do usuário ou da IA vira tag;
 *  · depois, só negrito (entre um ou dois asteriscos) → <b> e `código` → <code>;
 *  · limite do Telegram: 4096 caracteres por mensagem. Quebra por parágrafo,
 *    depois por linha, depois no espaço (medindo DEPOIS do escape, sem partir
 *    emoji); ordem preservada, nada repetido; no agente, no máximo 4 partes
 *    ("Parte 1/3") com aviso; nos relatórios, até 10 (sem truncar na prática);
 *  · sem texto (erro do modelo/ferramenta) → mensagem neutra, sem detalhe técnico.
 */
export const jsFormatar = (maxPartes = 4) => `// ETAPA 8 — Formatar para o Telegram (HTML seguro + divisão em partes).
const LIMITE = 3500;           // margem sob os 4096 do Telegram (o escape aumenta o texto)
const MAX_PARTES = ${maxPartes};
const FALHA = 'Não consegui concluir essa consulta agora. A tentativa foi registrada.';
${JS_HTML}
// Tabela markdown não existe no Telegram: vira linhas "a · b · c".
const semTabela = (t) => t
  .replace(/^\\s*\\|.*\\|\\s*$/gm, (l) => l.replace(/\\s*\\|\\s*/g, ' · ').replace(/^ · | · $/g, ''))
  .replace(/^\\s*[-·:\\s]+$/gm, '');
// Maior prefixo que, DEPOIS do escape, cabe no limite; nunca parte um emoji
// (par substituto) ao meio; prefere cortar num espaço.
function prefixo(linha) {
  let n = Math.min(linha.length, LIMITE);
  while (n > 1 && html(linha.slice(0, n)).length > LIMITE) n = Math.floor(n * 0.8);
  const c = linha.charCodeAt(n - 1);
  if (c >= 0xd800 && c <= 0xdbff) n -= 1;
  const espaco = linha.lastIndexOf(' ', n);
  return espaco > n / 2 ? espaco : n;
}
// Pedaços com o separador ORIGINAL antes deles: parágrafo ("\\n\\n"),
// linha ("\\n") ou continuação da mesma linha (" "). A ordem é preservada e
// nada se repete: cada caractere do texto vai para exatamente uma parte.
function partir(texto) {
  const pedacos = [];
  texto.split(/\\n{2,}/).forEach((bloco, bi) => {
    const sepBloco = bi === 0 ? '' : '\\n\\n';
    if (html(bloco).length <= LIMITE) { pedacos.push({ sep: sepBloco, t: bloco }); return; }
    bloco.split('\\n').forEach((linha0, li) => {
      let linha = linha0;
      let sep = li === 0 ? sepBloco : '\\n';
      while (html(linha).length > LIMITE) {
        const corte = prefixo(linha);
        pedacos.push({ sep, t: linha.slice(0, corte) });
        linha = linha.slice(corte).trimStart();
        sep = ' ';
      }
      pedacos.push({ sep, t: linha });
    });
  });
  const partes = [];
  let atual = '';
  for (const p of pedacos) {
    const junto = atual ? atual + p.sep + p.t : p.t;
    if (atual && html(junto).length > LIMITE) { partes.push(atual); atual = p.t; } else atual = junto;
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
    json: { chatId: j.chatId, falhaApi: j.falhaApi === true, text: (partes.length > 1 ? '<i>Parte ' + (i + 1) + '/' + partes.length + '</i>\\n' : '') + html(p) },
  }));
});`;

/** Agente: até 4 partes (resposta de chat longa demais pede recorte). */
export const JS_FORMATAR = jsFormatar(4);

// ---------------------------------------------------------------------------
// Nós do Telegram
// ---------------------------------------------------------------------------

const gatilhoTelegram = (nome, webhookId, pos, updates = ["message"]) => ({
  parameters: { updates, additionalFields: {} },
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

/**
 * API fora do ar: a pessoa já recebeu o aviso; este nó marca a EXECUÇÃO como
 * erro — ela fica salva no n8n (saveDataErrorExecution) e dispara o Error
 * Workflow, se houver. Sem token nem dado da conversa na mensagem.
 */
const registrarFalha = (nome, pos) => ({
  parameters: { errorMessage: "API B2C Finance indisponível ao atender o Telegram (a pessoa recebeu o aviso; nenhum dado foi inventado)." },
  name: nome,
  type: "n8n-nodes-base.stopAndError",
  typeVersion: 1,
  position: pos,
  notes: "Registro da falha: execução com erro no n8n.",
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
    code(T.limite, JS_LIMITE, [700, 120], "Anti-flood por Telegram User ID (antes da API e da IA)."),
    se(T.dentroDoLimite, "={{ $json.limitado !== true }}", [800, 120], "Passou do limite → um aviso, sem API/IA."),
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
    se(T.falhaApi, "={{ $node['Formatar para o Telegram'].json.falhaApi === true }}", [2900, 320], "O aviso era de API fora do ar?"),
    registrarFalha(T.registrar, [3120, 320]),
  ],
  connections: {
    [T.gatilho]: { main: [[{ node: T.normalizar, type: "main", index: 0 }]] },
    [T.normalizar]: { main: [[{ node: T.dedupe, type: "main", index: 0 }]] },
    [T.dedupe]: { main: [[{ node: T.privado, type: "main", index: 0 }]] },
    [T.privado]: { main: [[{ node: T.limite, type: "main", index: 0 }], [{ node: T.foraDoPrivado, type: "main", index: 0 }]] },
    [T.limite]: { main: [[{ node: T.dentroDoLimite, type: "main", index: 0 }]] },
    [T.dentroDoLimite]: { main: [[{ node: T.extrair, type: "main", index: 0 }], [{ node: T.formatar, type: "main", index: 0 }]] },
    [T.enviar]: { main: [[{ node: T.falhaApi, type: "main", index: 0 }]] },
    [T.falhaApi]: { main: [[{ node: T.registrar, type: "main", index: 0 }]] },
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
// Agente COM ESCRITA (Fase 16 · bloco 2) — b2c-finance-telegram-agent.json
//
// O mesmo agente do WhatsApp com escrita (ferramentas de consulta + as de
// escrita que só PROPÕEM em POST /agent/pending-actions), com a confirmação
// do jeito do Telegram:
//  · a prévia oficial da API vai com o teclado inline [Confirmar] [Cancelar];
//  · o botão leva SÓ "confirm:<id>" / "cancel:<id>" (≤ 64 bytes) — nada do
//    payload; quem decide se vale é a API (GET da ação + confirmação, com o
//    vínculo de quem TOCOU no botão);
//  · Idempotency-Key = telegram:<update_id>:<id>;
//  · a mensagem da prévia é EDITADA com o resultado (e perde os botões).
// ---------------------------------------------------------------------------

const escrita = lerJson("schemas/agent-write-tools.json");

const W = {
  ...T,
  gatilho: "Telegram: receber mensagem ou botão",
  normalizar: "Normalizar update (mensagem ou botão)",
  agente: "AI Agent B2C Finance (Telegram)",
  rota: "Rota",
  pendenteTexto: "API: ação pendente (resposta em texto)",
  decidirTexto: "Decidir resposta em texto",
  temPendente: "Há ação aguardando?",
  interpretarBotao: "Interpretar botão",
  botaoValido: "Botão válido?",
  consultarAcao: "API: consultar ação",
  decidirBotao: "Decidir botão",
  confirmarOuCancelar: "Confirmar ou cancelar?",
  apiConfirmar: "API: confirmar ação",
  apiCancelar: "API: cancelar ação",
  resultadoAcao: "Resultado da ação",
  respostaBotao: "Resposta do botão",
  responderBotao: "Telegram: responder ao botão",
  editar: "Atualizar a prévia?",
  editarPrevia: "Telegram: atualizar prévia",
  proposta: "API: ação proposta nesta mensagem",
  interpretar: "Interpretar resposta do agente",
  temPrevia: "Tem prévia para confirmar?",
  enviarPrevia: "Telegram: enviar prévia com botões",
};

export const JS_NORMALIZAR_ESCRITA = `// ETAPA 1 — Normalizar o update: MENSAGEM ou TOQUE EM BOTÃO (callback_query).
// A identidade é sempre o Telegram User ID de quem escreveu/tocou (from.id).
const COMANDOS = ['/start', '/help', '/status'];
const saida = [];
for (const item of $input.all()) {
  const u = item.json || {};
  if (u.callback_query) {
    const cq = u.callback_query;
    const de = cq.from || null;
    const msg = cq.message || null; // sem a mensagem (muito antiga/inline) = sem chat privado
    saida.push({
      json: {
        updateId: u.update_id,
        tipo: 'callback',
        messageId: 'tg:cb:' + cq.id,
        callbackQueryId: String(cq.id),
        callbackData: typeof cq.data === 'string' ? cq.data.slice(0, 64) : '',
        callbackMessageId: msg ? msg.message_id : null,
        chatId: msg && msg.chat ? msg.chat.id : null,
        chatType: msg && msg.chat ? String(msg.chat.type || '') : '',
        fromId: de && !de.is_bot && de.id ? String(de.id) : null,
        isBot: !!(de && de.is_bot),
        username: (de && de.username) || null,
        firstName: (de && de.first_name) || null,
        text: '',
        comando: null,
      },
    });
    continue;
  }
  const m = u.message;
  if (!m || !m.chat) continue;
  const de = m.from || null;
  const texto = typeof m.text === 'string' ? m.text.slice(0, 2000) : '';
  const primeira = texto.trim().split(/\\s+/)[0] || '';
  const cmd = primeira.startsWith('/') ? primeira.split('@')[0].toLowerCase() : null;
  saida.push({
    json: {
      updateId: u.update_id,
      messageId: 'tg:' + m.chat.id + ':' + m.message_id,
      chatId: m.chat.id,
      chatType: String(m.chat.type || ''),
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

// Ferramenta → scopes exigidos (TODOS). Escrita = scope da operação + agent_actions.manage.
const FERRAMENTA_SCOPES_ESCRITA = {
  ...Object.fromEntries(catalogo.tools.map((t) => [t.name, [t.scope]])),
  ...Object.fromEntries(escrita.tools.map((t) => [t.name, [t.scope, "agent_actions.manage"]])),
};
const FERRAMENTAS_DE_ESCRITA = escrita.tools.map((t) => t.name);

const JS_PERMISSOES_ESCRITA = jsPermissoes(
  T.extrair,
  FERRAMENTA_SCOPES_ESCRITA,
  `// ETAPA 4 — Carregar permissões a partir da RESPOSTA DA API (nunca da mensagem
// nem da IA). Ferramenta liberada = a API devolveu TODOS os scopes dela
// (conta ∩ RBAC do usuário). Escrita exige o scope da operação + agent_actions.manage.`
);

export const JS_ROTEIRO_ESCRITA = `// ETAPA 5 — O que NÃO vai para a IA: não vinculado, botões, /start, /help,
// /status, mensagem que não é texto e "sim"/"não" digitado (que só vale se
// houver ação aguardando — a confirmação é pelo botão).
const ESCRITA = ${JSON.stringify(FERRAMENTAS_DE_ESCRITA)};
const AJUDA = [
  'Pergunte ou peça em linguagem natural. Exemplos:',
  '• Quanto recebemos hoje?',
  '• Quem está inadimplente?',
  '• Qual nosso MRR?',
  '• Crie uma oportunidade de upsell de Google Ads para Cliente X.',
  '• A Face Love pagou R$ 1.500 hoje.',
  '• Deixe a Alpha inativa a partir de outubro.',
  '',
  'Toda alteração mostra uma *prévia* com os botões *Confirmar* e *Cancelar*: nada é gravado antes do seu toque em Confirmar.',
  'Excluir registros, reabrir competência e mexer em usuários ou permissões não são feitos por aqui.',
  '',
  'Comandos: /start · /help · /status',
].join('\\n');
const RESPOSTA_A_ACAO = /^\\s*(?:sim|s|confirmo|confirmar|confirma|ok|pode|pode sim|n[aã]o|cancela|cancelar|cancelo)\\s*[,.:;!-]?\\s*(?:\\d{4})?\\s*[.!]*\\s*$/i;
return $input.all().map((item) => {
  const m = item.json;
  const responder = (texto) => ({ json: { ...m, rota: 'responder', texto } });
  if (m.tipo === 'callback') return { json: { ...m, rota: 'botao' } };
  if (!m.authorized) {
    if (m.motivo === 'numero_nao_vinculado') {
      return responder('Olá! Seu Telegram ainda não está vinculado ao B2C Finance.\\n\\nSeu identificador Telegram é:\\n*' + m.fromId + '*\\n\\nSolicite a um administrador que vincule este ID ao seu usuário no B2C Finance.');
    }
    if (m.motivo === 'usuario_restrito_a_agencia') {
      return responder('Seu acesso é restrito a uma agência, e o atendimento pelo Telegram ainda não cobre esse caso. Use o B2C Finance.');
    }
    // API fora do ar (ou erro dela): nada de IA/RAG inventando dado atual; a
    // execução é marcada como erro no n8n (registro) depois do aviso.
    return { json: { ...m, rota: 'responder', falhaApi: true, texto: 'Não consegui acessar os dados do B2C Finance neste momento. Tente novamente em alguns minutos.' } };
  }
  const escreve = (m.allowedTools || []).some((t) => ESCRITA.includes(t));
  if (m.comando === '/start') {
    return responder('Olá, *' + m.userName + '*.\\n\\nVocê está conectado ao B2C Finance.\\n\\n' + AJUDA);
  }
  if (m.comando === '/help') return responder(AJUDA);
  if (m.comando === '/status') {
    return responder([
      '*B2C Finance conectado*',
      'Usuário: ' + m.userName,
      'Perfil: ' + (m.roleLabel || '—'),
      'Canal: Telegram',
      'Agente: ' + (escreve ? 'Leitura e ações controladas' : 'Somente leitura (seu perfil não permite alterações)'),
    ].join('\\n'));
  }
  if (m.comando === 'desconhecido') return responder('Comando não reconhecido. Mande /help para ver o que eu faço.');
  if (m.tipo !== 'text' || !m.text.trim()) return responder('Por enquanto eu entendo só mensagens de texto. Pode escrever o seu pedido?');
  if (RESPOSTA_A_ACAO.test(m.text)) return { json: { ...m, rota: 'resposta_em_texto' } };
  return { json: { ...m, rota: 'agente' } };
});`;

export const JS_DECIDIR_TEXTO = `// "sim"/"não" digitado: com ação AGUARDANDO, reenvia a prévia com os botões
// (a confirmação é pelo toque — nunca por texto solto). Sem ação aguardando,
// é conversa normal e segue para o agente.
${JS_HTML}
const msgs = $('${W.roteiro}').all();
return $input.all().map((item, i) => {
  const m = (msgs[i] || msgs[0]).json;
  const r = item.json || {};
  const acao = r.success === true && Array.isArray(r.data) ? r.data.find((a) => a.status === 'PENDING') : null;
  if (!acao) return { json: { ...m, pendente: false } };
  return {
    json: {
      pendente: true,
      chatId: m.chatId,
      actionId: acao.actionId,
      text: html('Para confirmar ou cancelar, use os botões abaixo.\\n\\n' + (acao.message || acao.preview)),
    },
  };
});`;

export const JS_INTERPRETAR_BOTAO = `// ETAPA 6b — O botão traz SÓ uma referência: "confirm:<id>" ou "cancel:<id>".
// Nada aqui é confiado: a API confere se a ação existe, é DESTE usuário e
// vínculo, está aguardando e dentro da validade — e a confirmação confere de novo.
const FORMATO = /^(confirm|cancel):([A-Za-z0-9_-]{1,56})$/;
return $input.all().map((item) => {
  const m = item.json;
  const base = { callbackQueryId: m.callbackQueryId, chatId: m.chatId, callbackMessageId: m.callbackMessageId, updateId: m.updateId, identityId: m.identityId };
  if (!m.authorized) {
    return { json: { ...base, valido: false, toast: m.motivo === 'numero_nao_vinculado' ? 'Seu Telegram não está vinculado ao B2C Finance.' : 'Não consegui acessar o B2C Finance agora. Tente em alguns minutos.', editar: false } };
  }
  const f = String(m.callbackData || '').match(FORMATO);
  if (!f) return { json: { ...base, valido: false, toast: 'Botão inválido ou antigo.', editar: false } };
  const actionId = f[2];
  return {
    json: {
      ...base,
      valido: true,
      decisao: f[1] === 'confirm' ? 'confirmar' : 'cancelar',
      actionId,
      // A mesma atualização reenviada pelo Telegram gera a MESMA chave (replay).
      idempotencyKey: 'telegram:' + m.updateId + ':' + actionId,
    },
  };
});`;

export const JS_DECIDIR_BOTAO = `// ETAPA 6c — Estado da ação NA API. Só PENDING segue para confirmar/cancelar;
// o resto responde sem executar nada ("já processada", expirada, não encontrada).
${JS_HTML}
const botoes = $('${W.interpretarBotao}').all();
const FINAL = {
  EXECUTED: '✅ Já executada.',
  EXECUTING: '⏳ Em execução.',
  FAILED: '❌ Não executada.',
  CANCELLED: '🚫 Cancelada. Nada foi alterado.',
  SUPERSEDED: '↪️ Substituída por um pedido mais novo.',
  EXPIRED: '⌛ Prazo encerrado. Nada foi alterado.',
};
return $input.all().map((item, i) => {
  const b = (botoes[i] || botoes[0]).json;
  const r = item.json || {};
  if (r.success !== true || !r.data) {
    const code = r.error && r.error.code;
    const toast = code === 'not_found' ? 'Ação não encontrada.'
      : ['user_forbidden', 'insufficient_scope', 'invalid_identity'].includes(code) ? 'Você não possui permissão para esta ação.'
      : 'Não consegui verificar a ação agora. Tente de novo.';
    return { json: { ...b, proximo: 'fim', toast, editar: false } };
  }
  const a = r.data;
  if (a.status === 'PENDING') return { json: { ...b, proximo: b.decisao, preview: a.preview } };
  const toast = a.status === 'EXPIRED' ? 'O prazo para confirmar esta ação acabou. Peça de novo, se ainda quiser.' : 'Essa ação já foi processada.';
  return {
    json: { ...b, proximo: 'fim', toast, editar: true, text: html(a.preview + '\\n\\n' + (FINAL[a.status] || 'Essa ação já foi processada.')) },
  };
});`;

export const JS_RESULTADO_ACAO = `// ETAPA 7a — Resultado da confirmação/cancelamento: o texto vem da API
// (resultado REAL da execução), nunca da IA. A prévia é editada com ele.
${JS_HTML}
const ref = $('${W.decidirBotao}');
return $input.all().map((item, i) => {
  const b = (ref.itemMatching ? ref.itemMatching(i) : ref.all()[i]).json;
  const r = item.json || {};
  let resultado;
  if (r.success === true && r.data) {
    resultado = r.data.message || (b.decisao === 'cancelar' ? 'Cancelado. Nada foi alterado.' : 'Feito.');
  } else {
    const code = r.error && r.error.code;
    resultado = code === 'action_not_pending' ? 'Essa ação já foi processada.'
      : (r.error && r.error.message) || 'Não consegui concluir agora. Confira no B2C Finance antes de pedir de novo.';
  }
  const curto = resultado.replace(/[*_]/g, '').slice(0, 190);
  return {
    json: {
      callbackQueryId: b.callbackQueryId, chatId: b.chatId, callbackMessageId: b.callbackMessageId,
      toast: curto, editar: true, text: html((b.preview ? b.preview + '\\n\\n' : '') + resultado),
    },
  };
});`;

export const JS_JUNTAR_ESCRITA = `// A saída do agente traz só o texto; chat, vínculo e mensagem vêm do contexto.
const ctxs = $('${W.contexto}').all();
return $input.all().map((item, i) => {
  const ctx = (ctxs[i] || ctxs[0] || {}).json || {};
  return {
    json: {
      chatId: ctx.chatId, identityId: ctx.identityId, messageId: ctx.messageId,
      output: typeof item.json.output === 'string' ? item.json.output : null,
    },
  };
});`;

export const JS_INTERPRETAR_ESCRITA = `// ETAPA 7 — Se a IA PROPÔS uma ação nesta mensagem, a resposta é a PRÉVIA
// montada pela API (estado atual), com os botões — nunca a paráfrase da IA.
// Senão, o texto do agente segue para a formatação normal.
${JS_HTML}
const juntos = $('${W.juntar}').all();
return $input.all().map((item, i) => {
  const ctx = (juntos[i] || juntos[0]).json;
  const r = item.json || {};
  const proposta = r.success === true && Array.isArray(r.data) ? r.data.find((a) => a.status === 'PENDING') : null;
  if (proposta && (proposta.message || proposta.preview)) {
    return { json: { comPrevia: true, chatId: ctx.chatId, actionId: proposta.actionId, text: html(proposta.message || proposta.preview) } };
  }
  return { json: { comPrevia: false, chatId: ctx.chatId, output: ctx.output } };
});`;

const enviarPrevia = (nome, pos) => ({
  parameters: {
    resource: "message",
    operation: "sendMessage",
    chatId: "={{ $json.chatId }}",
    text: "={{ $json.text }}",
    replyMarkup: "inlineKeyboard",
    inlineKeyboard: {
      rows: [
        {
          row: {
            buttons: [
              // Só a REFERÊNCIA da ação (≤ 64 bytes): nada do payload financeiro.
              { text: "Confirmar", additionalFields: { callback_data: "={{ 'confirm:' + $json.actionId }}" } },
              { text: "Cancelar", additionalFields: { callback_data: "={{ 'cancel:' + $json.actionId }}" } },
            ],
          },
        },
      ],
    },
    additionalFields: { appendAttribution: false, parse_mode: "HTML", disable_web_page_preview: true },
  },
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  credentials: CRED_TELEGRAM,
  notes: "Prévia da API + [Confirmar] [Cancelar] (callback_data = confirm:<id> / cancel:<id>).",
  notesInFlow: true,
});

const responderBotao = (nome, pos) => ({
  parameters: {
    resource: "callback",
    operation: "answerQuery",
    queryId: "={{ $json.callbackQueryId }}",
    additionalFields: { text: "={{ $json.toast }}" },
  },
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  credentials: CRED_TELEGRAM,
  onError: "continueRegularOutput",
  notes: "answerCallbackQuery: tira o \"carregando\" do botão e mostra o aviso curto.",
  notesInFlow: true,
});

const editarPrevia = (nome, pos) => ({
  parameters: {
    resource: "message",
    operation: "editMessageText",
    messageType: "message",
    chatId: "={{ $json.chatId }}",
    messageId: "={{ $json.callbackMessageId }}",
    text: "={{ $json.text }}",
    replyMarkup: "none",
    additionalFields: { parse_mode: "HTML", disable_web_page_preview: true },
  },
  name: nome,
  type: "n8n-nodes-base.telegram",
  typeVersion: 1.2,
  position: pos,
  credentials: CRED_TELEGRAM,
  onError: "continueRegularOutput",
  notes: "A prévia vira o resultado e perde os botões (não dá para tocar de novo).",
  notesInFlow: true,
});

const ferramentasLeituraTg = catalogo.tools.map((t, i) => ({
  ...ferramenta(t, i, "telegram"),
  position: [2360 + (i % 6) * 170, 1100 + Math.floor(i / 6) * 180],
}));
const ferramentasEscritaTg = escrita.tools.map((t, i) => ({
  ...ferramentaDeEscrita(t, i, "telegram"),
  position: [2360 + (i % 5) * 170, 1480 + Math.floor(i / 5) * 180],
}));
const todasFerramentasTg = [...ferramentasLeituraTg, ...ferramentasEscritaTg];
const scopesEscritaTg = [
  ...new Set([...catalogo.tools.map((t) => t.scope), ...escrita.tools.map((t) => t.scope), "identities.resolve", "agent_actions.manage"]),
].sort();

const contextoDoPromptEscrita =
  "\n\n## Contexto desta conversa\n- Canal: Telegram (conversa privada)\n- Confirmação: a prévia oficial vai com os botões Confirmar e Cancelar; o usuário TOCA no botão (não existe código para digitar no Telegram)\n- Usuário (vínculo verificado pela API): {{ $json.userName }} — {{ $json.roleLabel }}\n- Ferramentas liberadas para este usuário: {{ $json.allowedTools.join(', ') }}\n- Base de conhecimento: consultar_conhecimento (conceitos e procedimentos; nunca dados atuais)\n- Hoje: {{ $json.hoje }} (competência atual {{ $json.competenciaAtual }}, fuso America/Bahia)";

const conecta = (de, para, saida = 0) => ({ de, para, saida });
const ligacoes = [
  conecta(W.gatilho, W.normalizar),
  conecta(W.normalizar, W.dedupe),
  conecta(W.dedupe, W.privado),
  conecta(W.privado, W.limite),
  conecta(W.limite, W.dentroDoLimite),
  conecta(W.dentroDoLimite, W.extrair, 0),
  conecta(W.dentroDoLimite, W.formatar, 1),
  conecta(W.privado, W.foraDoPrivado, 1),
  conecta(W.foraDoPrivado, W.formatar),
  conecta(W.extrair, W.resolver),
  conecta(W.resolver, W.permissoes),
  conecta(W.permissoes, W.roteiro),
  conecta(W.roteiro, W.rota),
  conecta(W.rota, W.contexto, 0),
  conecta(W.rota, W.formatar, 1),
  conecta(W.rota, W.interpretarBotao, 2),
  conecta(W.rota, W.pendenteTexto, 3),
  conecta(W.pendenteTexto, W.decidirTexto),
  conecta(W.decidirTexto, W.temPendente),
  conecta(W.temPendente, W.enviarPrevia, 0),
  conecta(W.temPendente, W.contexto, 1),
  conecta(W.interpretarBotao, W.botaoValido),
  conecta(W.botaoValido, W.consultarAcao, 0),
  conecta(W.botaoValido, W.respostaBotao, 1),
  conecta(W.consultarAcao, W.decidirBotao),
  conecta(W.decidirBotao, W.confirmarOuCancelar),
  conecta(W.confirmarOuCancelar, W.apiConfirmar, 0),
  conecta(W.confirmarOuCancelar, W.apiCancelar, 1),
  conecta(W.confirmarOuCancelar, W.respostaBotao, 2),
  conecta(W.apiConfirmar, W.resultadoAcao),
  conecta(W.apiCancelar, W.resultadoAcao),
  conecta(W.resultadoAcao, W.respostaBotao),
  conecta(W.respostaBotao, W.responderBotao),
  conecta(W.respostaBotao, W.editar),
  conecta(W.editar, W.editarPrevia, 0),
  conecta(W.contexto, W.agente),
  conecta(W.agente, W.juntar),
  conecta(W.juntar, W.proposta),
  conecta(W.proposta, W.interpretar),
  conecta(W.interpretar, W.temPrevia),
  conecta(W.temPrevia, W.enviarPrevia, 0),
  conecta(W.temPrevia, W.formatar, 1),
  conecta(W.formatar, W.enviar),
  conecta(W.enviar, W.falhaApi),
  conecta(W.falhaApi, W.registrar, 0),
];
const conexoesMain = {};
for (const l of ligacoes) {
  const c = (conexoesMain[l.de] ??= { main: [] });
  while (c.main.length <= l.saida) c.main.push([]);
  c.main[l.saida].push({ node: l.para, type: "main", index: 0 });
}

const switchPor = (nome, campo, saidas, pos, nota) => ({
  parameters: { mode: "expression", numberOutputs: saidas.length, output: `={{ ${JSON.stringify(saidas)}.indexOf($json.${campo}) }}` },
  name: nome,
  type: "n8n-nodes-base.switch",
  typeVersion: 3,
  position: pos,
  notes: nota,
  notesInFlow: true,
});

const agenteEscrita = {
  name: "B2C Finance · Telegram · AI Agent (consulta + escrita com confirmação)",
  nodes: [
    nota(
      "Nota: sobre este workflow",
      `## B2C Finance · Telegram · AI Agent (consulta + escrita com confirmação)\n\nConsulta a API e PROPÕE escritas. Nada é gravado sem o usuário tocar em **Confirmar** na prévia.\n\n- **READ** executa direto · **WRITE_CONFIRMATION** gera prévia com botões · **BLOCKED** nunca (excluir, reabrir competência, permissões, usuários, plano de contas).\n- **Identidade = Telegram User ID** de quem escreve OU toca no botão, resolvida pela API.\n- **Nunca** acessa banco, Supabase ou Prisma — só a API (\`$env.B2C_FINANCE_API_URL\`).\n- Bot token só na **credencial** "Telegram Bot".\n- **Não ative** antes do teste (docs/TELEGRAM.md). Um bot = um webhook: ative este OU o somente leitura.\n\nFonte: integrations/n8n (gerado por scripts/build-telegram-workflows.mjs).`,
      [-480, -120], 440, 460, 7
    ),
    nota(
      "Nota: entrada e identidade",
      `### 1–5 · Entrada, identidade e roteiro\nGatilho com secret_token; mensagens E toques em botão (callback_query). Deduplica por update_id; só chat privado. A API resolve o Telegram User ID. /start, /help, /status e "sim"/"não" digitado não passam pela IA.`,
      [-20, 160], 1500, 330, 5
    ),
    nota(
      "Nota: botões",
      `### 6 · Botões (sem IA)\ncallback_data = **confirm:<id>** ou **cancel:<id>** — só a referência. \`GET /agent/pending-actions/{id}\` com o vínculo de quem tocou (outro usuário = 404) → só PENDING segue → \`POST …/confirm\` (via button, **Idempotency-Key = telegram:<update_id>:<id>**) ou \`…/cancel\`. A API confere usuário, vínculo, validade, estado e permissão, e executa o payload GUARDADO pela rota oficial. Já processada/expirada → aviso, nada executa. A prévia é editada com o resultado e perde os botões.`,
      [1620, -560], 1500, 380, 4
    ),
    nota(
      "Nota: agente",
      `### 7 · Agente\nDados atuais: GET na API. Conceitos: \`consultar_conhecimento\` (Qdrant). Escrita: ferramentas que só **propõem** (\`POST /agent/pending-actions\`, operação FIXA). Depois da IA, se houve proposta nesta mensagem, vai a **prévia da API com os botões**, não a paráfrase da IA.`,
      [2300, 160], 1100, 1720, 6
    ),
    gatilhoTelegram(W.gatilho, "b2c-finance-telegram-agent", [0, 300], ["message", "callback_query"]),
    code(W.normalizar, JS_NORMALIZAR_ESCRITA, [200, 300], "Mensagem ou botão → um item (quem, chat, tipo)."),
    code(W.dedupe, JS_DEDUPE, [400, 300], "Mesmo update_id não é processado duas vezes."),
    se(W.privado, "={{ $json.chatType === 'private' && !!$json.fromId }}", [600, 300], "Só conversa privada, com pessoa (não bot)."),
    code(W.foraDoPrivado, JS_FORA_DO_PRIVADO, [800, 520], "Grupo: orientação genérica. Canal/bot: nada."),
    code(W.limite, JS_LIMITE, [700, 120], "Anti-flood por Telegram User ID (antes da API e da IA)."),
    se(W.dentroDoLimite, "={{ $json.limitado !== true }}", [800, 120], "Passou do limite → um aviso, sem API/IA."),
    code(W.extrair, JS_EXTRAIR, [800, 300], "from.id — a identidade oficial (de quem escreveu ou tocou)."),
    apiDeControle(W.resolver, "POST", "/integrations/resolve-identity", [1000, 300], "Telegram User ID → usuário vinculado (API).", {
      fonte: "telegram",
      semIdentidade: true,
      jsonBody: "={{ JSON.stringify({ channel: 'TELEGRAM', externalIdentifier: $json.externalIdentifier }) }}",
    }),
    code(W.permissoes, JS_PERMISSOES_ESCRITA, [1200, 300], "Ferramentas = scopes que a API liberou para o usuário."),
    code(W.roteiro, JS_ROTEIRO_ESCRITA, [1400, 300], "Não vinculado, botões, comandos, sim/não digitado."),
    switchPor(W.rota, "rota", ["agente", "responder", "botao", "resposta_em_texto"], [1600, 300], "0 agente · 1 responder · 2 botão · 3 sim/não digitado"),
    apiDeControle(W.pendenteTexto, "GET", "/agent/pending-actions?status=PENDING&limit=1", [1820, 700], "Há ação aguardando este usuário?", { fonte: "telegram" }),
    code(W.decidirTexto, JS_DECIDIR_TEXTO, [2040, 700], "Com ação aguardando: reenvia a prévia com botões."),
    se(W.temPendente, "={{ $json.pendente === true }}", [2240, 700], "Sim → prévia com botões; não → agente."),
    code(W.interpretarBotao, JS_INTERPRETAR_BOTAO, [1820, -300], "confirm:<id> / cancel:<id> — só referência."),
    se(W.botaoValido, "={{ $json.valido === true }}", [2020, -300], "Formato e vínculo ok?"),
    apiDeControle(W.consultarAcao, "GET", "/agent/pending-actions/{{ $json.actionId }}", [2220, -380], "A ação é deste usuário? Qual o estado? (API)", { fonte: "telegram" }),
    code(W.decidirBotao, JS_DECIDIR_BOTAO, [2420, -380], "Só PENDING segue; já processada/expirada → aviso."),
    switchPor(W.confirmarOuCancelar, "proximo", ["confirmar", "cancelar", "fim"], [2620, -380], "0 confirmar · 1 cancelar · 2 fim"),
    apiDeControle(W.apiConfirmar, "POST", "/agent/pending-actions/{{ $json.actionId }}/confirm", [2840, -500], "Executa a ação guardada (RBAC, idempotência, trilha).", {
      fonte: "telegram",
      headers: [{ name: "Idempotency-Key", value: "={{ $json.idempotencyKey }}" }],
      jsonBody: "={{ JSON.stringify({ messageId: String($json.updateId), via: 'button' }) }}",
    }),
    apiDeControle(W.apiCancelar, "POST", "/agent/pending-actions/{{ $json.actionId }}/cancel", [2840, -340], "Cancela: nada é executado.", {
      fonte: "telegram",
      jsonBody: "={{ JSON.stringify({ messageId: String($json.updateId) }) }}",
    }),
    code(W.resultadoAcao, JS_RESULTADO_ACAO, [3060, -420], "Texto do resultado real (da API)."),
    code(W.respostaBotao, "// Ponto único de saída dos botões: aviso curto + (se for o caso) edição da prévia.\nreturn $input.all();", [3260, -300], "Junta os caminhos do botão."),
    responderBotao(W.responderBotao, [3480, -400]),
    se(W.editar, "={{ $json.editar === true && !!$json.callbackMessageId }}", [3480, -200], "Há prévia para atualizar?"),
    editarPrevia(W.editarPrevia, [3700, -200]),
    code(W.contexto, JS_CONTEXTO, [1820, 300], "Sessão, data de hoje e ferramentas do usuário."),
    {
      parameters: {
        promptType: "define",
        text: "={{ $json.text }}",
        options: {
          systemMessage: "=" + montarPrompt("escrita") + contextoDoPromptEscrita,
          maxIterations: 10,
          returnIntermediateSteps: false,
        },
      },
      name: W.agente,
      type: "@n8n/n8n-nodes-langchain.agent",
      typeVersion: 1.7,
      position: [2040, 300],
      onError: "continueRegularOutput",
      notes: "Consulta (GET) e PROPÕE escritas. Não confirma nada.",
      notesInFlow: true,
    },
    modeloIA(W.modelo, [2000, 560]),
    memoriaDaConversa(W.memoria, [2180, 560]),
    ...todasFerramentasTg,
    ferramentaConhecimento(W.conhecimento, [3260, 1100]),
    embeddings(W.embConhecimento, [3260, 1280]),
    code(W.juntar, JS_JUNTAR_ESCRITA, [2260, 300], "Resposta da IA + chat, vínculo e mensagem."),
    apiDeControle(
      W.proposta, "GET", "/agent/pending-actions?sourceMessageId={{ encodeURIComponent($json.messageId) }}&limit=1",
      [2460, 300], "A ação que a IA propôs nesta mensagem (prévia da API).", { fonte: "telegram" }
    ),
    code(W.interpretar, JS_INTERPRETAR_ESCRITA, [2660, 300], "Prévia da API (com botões) quando houve proposta."),
    se(W.temPrevia, "={{ $json.comPrevia === true }}", [2860, 300], "Proposta → prévia com botões; senão, texto."),
    enviarPrevia(W.enviarPrevia, [3100, 160]),
    code(W.formatar, JS_FORMATAR, [3100, 460], "HTML seguro + partes (limite do Telegram)."),
    enviarTelegram(W.enviar, [3320, 460]),
    se(W.falhaApi, "={{ $node['Formatar para o Telegram'].json.falhaApi === true }}", [3540, 460], "O aviso era de API fora do ar?"),
    registrarFalha(W.registrar, [3760, 460]),
  ],
  connections: {
    ...conexoesMain,
    [W.modelo]: { ai_languageModel: [[{ node: W.agente, type: "ai_languageModel", index: 0 }]] },
    [W.memoria]: { ai_memory: [[{ node: W.agente, type: "ai_memory", index: 0 }]] },
    ...Object.fromEntries(todasFerramentasTg.map((f) => [f.name, { ai_tool: [[{ node: W.agente, type: "ai_tool", index: 0 }]] }])),
    [W.conhecimento]: { ai_tool: [[{ node: W.agente, type: "ai_tool", index: 0 }]] },
    [W.embConhecimento]: { ai_embedding: [[{ node: W.conhecimento, type: "ai_embedding", index: 0 }]] },
  },
  settings: { executionOrder: "v1", saveDataSuccessExecution: "none", saveDataErrorExecution: "all", saveManualExecutions: true },
  pinData: {},
  active: false,
  meta: {
    b2c: {
      workflow: "b2c-finance-telegram-agent",
      channel: "TELEGRAM",
      version: 1,
      catalogVersion: catalogo.version,
      writeCatalogVersion: escrita.version,
      apiVersion: catalogo.apiVersion,
      readOnly: false,
      writeMode: "confirmation-buttons",
      knowledgeVersion: conhecimento.version,
      knowledgeCollection: conhecimento.collection,
      systemPrompt: "docs/AI_AGENT_SYSTEM_PROMPT.md (prompt-base + prompt-escrita)",
      requiredScopes: scopesEscritaTg,
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
const paraEscrita = ${JSON.stringify(scopesEscritaTg)};
const ok = (nome) => { const j = $(nome).first().json || {}; return j.success === true ? j : null; };
const health = ok('${K.health}');
const me = ok('${K.me}');
const identidade = ok('${K.identidade}');
const q = $('${K.qdrant}').first().json || {};
const pontos = q.result && typeof q.result.points_count === 'number' ? q.result.points_count : null;
const scopes = (me && me.data && me.data.scopes) || [];
const faltando = necessarios.filter((s) => !scopes.includes(s));
const faltandoEscrita = paraEscrita.filter((s) => !scopes.includes(s));
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
  // Informativo: o agente com escrita precisa também dos scopes de escrita.
  'Ações com confirmação: ' + (me ? (faltandoEscrita.length ? 'indisponíveis — faltam scopes: ' + faltandoEscrita.join(', ') : 'OK') : '—'),
];
return [{ json: { ok: tudo, ...res, faltando, faltandoEscrita, trechosNoQdrant: pontos, text: linhas.map((l, i) => (i === 0 ? l : esc(l))).join('\\n') } }];`;

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
  gravar("b2c-finance-telegram-agent.json", agenteEscrita);
  gravar("telegram-connection-test.json", teste);
  console.log(
    `Telegram: agente somente leitura (${ferramentas.length} ferramentas + conhecimento), agente com escrita (${todasFerramentasTg.length} ferramentas + conhecimento) e teste de conexão gerados.`
  );
}
