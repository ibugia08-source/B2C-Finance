/**
 * PEÇAS COMPARTILHADAS pelos geradores de workflow (WhatsApp e Telegram).
 *
 * Um lugar só para: credenciais placeholder, ferramentas de consulta da API,
 * nós Code/IF/nota, base de conhecimento (Qdrant) e o prompt do agente. Os
 * canais mudam só a entrada e a saída — o que o agente sabe fazer é igual.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ_N8N = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RAIZ_REPO = join(RAIZ_N8N, "..", "..");
export const lerJson = (rel) => JSON.parse(readFileSync(join(RAIZ_N8N, rel), "utf8"));

export const catalogo = lerJson("schemas/agent-tools.json");

/** Ferramentas de consulta que os agentes de um canal recebem (`channels` ausente = todos). */
export const ferramentasDoCanal = (canal) => catalogo.tools.filter((t) => !t.channels || t.channels.includes(canal));

/** Ferramenta → permissões finas do RBAC exigidas além do scope (catálogo: `userPermission`). */
export const permissoesDasFerramentas = (tools) =>
  Object.fromEntries(tools.filter((t) => t.userPermission).map((t) => [t.name, [t.userPermission]]));
export const conhecimento = lerJson("knowledge/b2c-finance-knowledge.json");

// Ids PLACEHOLDER, um por credencial: na importação o n8n liga pelo nome e
// tipo (ou você escolhe no nó). Nunca um id real — check-secrets barra.
export const CRED_B2C = { httpHeaderAuth: { id: "CONFIGURAR_B2C_FINANCE_API", name: "B2C Finance API" } };
export const CRED_WA = { httpHeaderAuth: { id: "CONFIGURAR_WHATSAPP_API", name: "WhatsApp API" } };
export const CRED_IA = { openAiApi: { id: "CONFIGURAR_OPENAI", name: "OpenAI" } };
export const CRED_QDRANT = { qdrantApi: { id: "CONFIGURAR_QDRANT", name: "Qdrant (conhecimento)" } };
export const CRED_TELEGRAM = { telegramApi: { id: "CONFIGURAR_TELEGRAM", name: "Telegram Bot" } };

// Host que nunca resolve: ferramenta fora do perfil do usuário não chega à API.
export const BLOQUEADA = "https://ferramenta-nao-liberada-para-este-perfil.invalid";

/** Cabeçalhos das ferramentas: origem (canal) na trilha + delegação pelo vínculo. */
export const cabecalhosDe = (fonte) => ({
  sendHeaders: true,
  specifyHeaders: "keypair",
  parametersHeaders: {
    values: [
      { name: "X-B2C-Source", valueProvider: "fieldValue", value: fonte },
      { name: "x-request-id", valueProvider: "fieldValue", value: "={{ 'n8n-' + $execution.id }}" },
      // Delegação: a API recorta cada chamada pelo RBAC de quem está falando.
      { name: "X-B2C-Identity", valueProvider: "fieldValue", value: "={{ $json.identityId }}" },
    ],
  },
});

// ---------------------------------------------------------------------------
// Ferramentas de consulta (uma por item do catálogo)
// ---------------------------------------------------------------------------

export function ferramenta(t, i, fonte = "whatsapp") {
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
      ...cabecalhosDe(fonte),
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
// Ferramentas de escrita (uma por item de schemas/agent-write-tools.json)
// ---------------------------------------------------------------------------

// Texto seguro dentro de '...' numa expressão do n8n.
export const aspas = (t) => t.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/**
 * Ferramenta de escrita = nó HTTP Request usado como ferramenta
 * (n8n-nodes-base.httpRequestTool, parâmetros do modelo por $fromAI).
 *
 * Por que não o toolHttpRequest das consultas: ele descarta o corpo da
 * resposta de ERRO e entrega ao modelo só "Request failed with status code
 * 422". Numa proposta recusada o usuário precisa ouvir o PORQUÊ ("essa
 * cobrança já está quitada", "falta o valor", "seu perfil não pode"), que
 * vem em error.code/error.message da API. Com `neverError`, o JSON de erro
 * chega inteiro ao modelo (auditoria final, 28/09/2026).
 */
export function ferramentaDeEscrita(t, i, fonte = "whatsapp") {
  const campos = Object.entries(t.input)
    .map(([k, v]) => `${k} (${v.type}${t.required.includes(k) ? ", obrigatório" : ""}): ${v.description}`)
    .join("; ");
  const semInput = Object.keys(t.input).length === 0;
  // Operação FIXA no corpo: a ferramenta não escolhe outra operação.
  const partes = [`operation: '${t.operation}'`];
  if (t.target) partes.push(`targetId: $fromAI('targetId', '${aspas(t.target.description)}', 'string')`);
  partes.push(
    semInput
      ? "input: {}"
      : `input: $fromAI('input', '${aspas(`Objeto JSON só com os campos que o usuário informou. Campos: ${campos}.`)}', 'json')`
  );
  return {
    parameters: {
      toolDescription: `${t.description} Risco: WRITE_CONFIRMATION — não executa nada; a API monta a prévia e o usuário confirma.`,
      method: "POST",
      url: `={{ ($json.allowedTools || []).includes('${t.name}') ? $env.B2C_FINANCE_API_URL : '${BLOQUEADA}' }}/agent/pending-actions`,
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "X-B2C-Source", value: fonte },
          { name: "x-request-id", value: "={{ 'n8n-' + $execution.id }}" },
          // Delegação: a API recorta pelo RBAC de quem está falando.
          { name: "X-B2C-Identity", value: "={{ $json.identityId }}" },
          // A ação fica ligada à mensagem que a pediu (o workflow a acha depois da IA).
          { name: "X-B2C-Message-Id", value: "={{ $json.messageId }}" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({ ${partes.join(", ")} }) }}`,
      // Erro da API (4xx) volta como JSON para o modelo explicar ao usuário.
      options: { response: { response: { neverError: true } } },
    },
    name: t.name,
    type: "n8n-nodes-base.httpRequestTool",
    typeVersion: 4.2,
    position: [1500 + (i % 5) * 170, 1000 + Math.floor(i / 5) * 180],
    credentials: CRED_B2C,
    notes: `POST /agent/pending-actions · ${t.operation} · scope ${t.scope} + agent_actions.manage · WRITE_CONFIRMATION`,
    notesInFlow: true,
  };
}

// ---------------------------------------------------------------------------
// Nós genéricos
// ---------------------------------------------------------------------------

export const code = (nome, js, pos, nota) => ({
  parameters: { jsCode: js },
  name: nome,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: pos,
  notes: nota,
  notesInFlow: true,
});

export const se = (nome, expr, pos, nota) => ({
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

export const nota = (nome, conteudo, pos, largura, altura, cor) => ({
  parameters: { content: conteudo, height: altura, width: largura, color: cor },
  name: nome,
  type: "n8n-nodes-base.stickyNote",
  typeVersion: 1,
  position: pos,
});

/**
 * HTTP de controle (fora das ferramentas): com o vínculo e sem lançar erro —
 * a resposta de erro da API vira texto para o usuário.
 */
export const apiDeControle = (nome, metodo, caminho, pos, nota, extra = {}) => ({
  parameters: {
    method: metodo,
    url: `={{ $env.B2C_FINANCE_API_URL }}${caminho}`,
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "X-B2C-Source", value: extra.fonte ?? "whatsapp" },
        { name: "x-request-id", value: "={{ 'n8n-' + $execution.id }}" },
        ...(extra.semIdentidade ? [] : [{ name: "X-B2C-Identity", value: extra.identidade ?? "={{ $json.identityId }}" }]),
        ...(extra.headers ?? []),
      ],
    },
    ...(extra.jsonBody ? { sendBody: true, specifyBody: "json", jsonBody: extra.jsonBody } : {}),
    options: { response: { response: { neverError: true } } },
  },
  name: nome,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  credentials: CRED_B2C,
  onError: "continueRegularOutput",
  alwaysOutputData: true,
  notes: nota,
  notesInFlow: true,
});

/**
 * Permissões a partir da RESPOSTA DA API (nunca da mensagem nem da IA).
 * Ferramenta liberada = a API devolveu TODOS os scopes dela em allowedScopes
 * (conta ∩ RBAC do usuário).
 */
export const jsPermissoes = (noMensagens, mapa, cabecalho, permissoes = null) => `${cabecalho}
const FERRAMENTA_SCOPES = ${JSON.stringify(mapa, null, 2)};${
  permissoes && Object.keys(permissoes).length
    ? `
// Além do scope, algumas ferramentas exigem uma permissão FINA do RBAC da
// pessoa (a mesma da tela) — a API devolve as dela em data.permissions e
// confere de novo na chamada.
const FERRAMENTA_PERMISSOES = ${JSON.stringify(permissoes, null, 2)};`
    : ""
}
const mensagens = $('${noMensagens}').all();
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
        allowedTools: Object.keys(FERRAMENTA_SCOPES).filter((t) => FERRAMENTA_SCOPES[t].every((s) => scopes.includes(s))${
          permissoes && Object.keys(permissoes).length
            ? " && (FERRAMENTA_PERMISSOES[t] || []).every((p) => (r.data.permissions || []).includes(p))"
            : ""
        }),
        motivo: null,
      },
    };
  }
  const texto = JSON.stringify(r.error || r);
  const motivo = texto.includes('identity_not_found') ? 'numero_nao_vinculado'
    : texto.includes('agency_scope_not_supported') ? 'usuario_restrito_a_agencia'
    : 'erro_tecnico';
  return { json: { ...msg, authorized: false, identityId: null, allowedTools: [], motivo } };
});`;

// ---------------------------------------------------------------------------
// Base de conhecimento (RAG) — o MESMO pacote que a API serve e a ingestão indexa
// ---------------------------------------------------------------------------

export const colecao = { __rl: true, value: conhecimento.collection, mode: "id" };

export const embeddings = (nome, pos) => ({
  // Dimensões FIXAS (as do pacote): indexação e consulta precisam do mesmo tamanho.
  parameters: { model: conhecimento.embedding.model, options: { dimensions: conhecimento.embedding.dimensions } },
  name: nome,
  type: "@n8n/n8n-nodes-langchain.embeddingsOpenAi",
  typeVersion: 1.2,
  position: pos,
  credentials: CRED_IA,
  notes: `Mesmo modelo na indexação e na consulta (${conhecimento.embedding.model}).`,
  notesInFlow: true,
});

export const DESCRICAO_CONHECIMENTO =
  "Base de CONHECIMENTO do B2C Finance: conceitos, regras e procedimentos (o que é MRR/TCV, como se calcula o resultado, status com vigência, fechamento de mês, plano de contas, políticas, o que o agente faz). NUNCA use para número ou situação atual — saldo, MRR, clientes ativos, recebimentos, despesas, status de hoje e inadimplência vêm das ferramentas de consulta da API. Valores citados nos trechos são exemplos.";

export const ferramentaConhecimento = (nome, pos) => ({
  parameters: {
    mode: "retrieve-as-tool",
    toolDescription: DESCRICAO_CONHECIMENTO,
    qdrantCollection: colecao,
    topK: 4,
    includeDocumentMetadata: true,
    options: {},
  },
  name: nome,
  type: "@n8n/n8n-nodes-langchain.vectorStoreQdrant",
  typeVersion: 1.3,
  position: pos,
  credentials: CRED_QDRANT,
  notes: `RAG (READ): coleção ${conhecimento.collection}, indexada por knowledge-ingest.json. Só conceitos.`,
  notesInFlow: true,
});

// ---------------------------------------------------------------------------
// Prompt do agente — fonte única em docs/AI_AGENT_SYSTEM_PROMPT.md
// ---------------------------------------------------------------------------

const docPrompt = readFileSync(join(RAIZ_REPO, "docs/AI_AGENT_SYSTEM_PROMPT.md"), "utf8");
const trecho = (marca) => {
  const t = (docPrompt.split(`<!-- ${marca}:inicio -->`)[1] ?? "").split(`<!-- ${marca}:fim -->`)[0].trim();
  if (!t) throw new Error(`docs/AI_AGENT_SYSTEM_PROMPT.md sem o trecho <!-- ${marca}:inicio --> … <!-- ${marca}:fim -->.`);
  return t;
};

/** Prompt completo: base (princípios, fontes, formato) + o modo (escrita com confirmação ou somente leitura). */
export const montarPrompt = (modo) => `${trecho("prompt-base")}\n\n${trecho(modo === "escrita" ? "prompt-escrita" : "prompt-leitura")}`;

// ---------------------------------------------------------------------------
// Modelo e memória do agente
// ---------------------------------------------------------------------------

export const modeloIA = (nome, pos) => ({
  parameters: { model: { __rl: true, value: "gpt-4o-mini", mode: "list", cachedResultName: "gpt-4o-mini" }, options: { temperature: 0.2 } },
  name: nome,
  type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  typeVersion: 1.2,
  position: pos,
  credentials: CRED_IA,
  notes: "Qualquer modelo com tool calling. Temperatura baixa: respostas factuais.",
  notesInFlow: true,
});

export const memoriaDaConversa = (nome, pos) => ({
  parameters: { sessionIdType: "customKey", sessionKey: "={{ $json.sessionId }}", contextWindowLength: 10 },
  name: nome,
  type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
  typeVersion: 1.3,
  position: pos,
  notes: "Últimas 10 trocas, por pessoa.",
  notesInFlow: true,
});

/** Data de hoje no fuso do workspace (para "mês passado", "ontem"…). */
export const JS_HOJE = "new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())";
