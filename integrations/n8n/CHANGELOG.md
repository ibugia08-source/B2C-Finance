# Changelog — integrações n8n

Formato: data · arquivo · mudança. Mudança **incompatível** da API gera `vN+1` do workflow, que convive com o anterior até a troca.

## 2026-09-29 — Fase 16 · bloco 2: Telegram com escrita e relatórios

- **Novos** (todos desativados):
  - `workflows/b2c-finance-telegram-agent.json` — consulta + escrita com confirmação por **botões** (callback `confirm:<id>`/`cancel:<id>`, Idempotency-Key `telegram:<update_id>:<id>`, prévia editada com o resultado);
  - `workflows/telegram-daily-morning-report.json` e `telegram-daily-evening-report.json` — destinatários pela API (preferência "Envios" do vínculo), um relatório por pessoa com `X-B2C-Identity`.
- **Peças comuns:** a ferramenta de escrita foi para `scripts/lib/pecas.mjs` (parâmetro de canal); a consolidação dos relatórios é a mesma do WhatsApp. Os workflows do WhatsApp saíram **byte a byte iguais**, exceto o prompt do agente com escrita.
- **Prompt** (`prompt-escrita`): confirmação por canal (código no WhatsApp, botões no Telegram), regra de status com vigência, pagamento, cadastro sem inventar dado e pedido BLOCKED.
- **Teste de conexão do Telegram:** nova linha "Ações com confirmação" (scopes de escrita).
- **Variáveis novas:** `TELEGRAM_MORNING_REPORT_CRON`, `TELEGRAM_EVENING_REPORT_CRON`.
- **API usada:** `GET /integrations/recipients`, `GET /agent/pending-actions/{id}`, confirmação com `via: "button"`.
- **Base de conhecimento:** o pacote mudou (AI_AGENT.md, API.md). Rode `knowledge-ingest.json` de novo.

## 2026-09-29 — Fase 16 · bloco 1: Telegram

- **Novos:** `workflows/b2c-finance-telegram-agent-readonly.json` e `workflows/telegram-connection-test.json`, gerados por `scripts/build-telegram-workflows.mjs`. Os workflows do WhatsApp continuam; nenhum foi removido.
- **Peças comuns** em `scripts/lib/pecas.mjs`. O agente somente leitura do WhatsApp continua byte a byte igual.
- **Prompt** (`docs/AI_AGENT_SYSTEM_PROMPT.md`):
  - dividido em `prompt-base` + `prompt-escrita` / `prompt-leitura`, sem canal fixo;
  - mensagens de erro padronizadas;
  - aviso quando a base de conhecimento está indisponível.
- **Base de conhecimento:** o pacote mudou (AI_AGENT.md e API.md cobrem o Telegram). Rode `knowledge-ingest.json` de novo.
- **Variável nova** `TELEGRAM_TEST_USER_ID`; **credencial nova** "Telegram Bot".

## 2026-09-28 (7) — auditoria final

- `b2c-finance-ai-agent.json`: as 10 ferramentas de escrita passaram de `toolHttpRequest` para **`httpRequestTool`** (parâmetros do modelo por `$fromAI`, `neverError`).
  - Motivo: o `toolHttpRequest` entregava ao modelo só "Request failed with status code 422", sem `error.code`/`error.message` da API.
  - Agora a recusa ("Esta cobrança já está quitada.", o campo inválido) chega ao modelo, que pode explicar ao usuário.
  - As ferramentas de consulta continuam como estavam; o prompt mapeia o status HTTP delas.
- `scripts/validate-with-n8n.cjs`: agora valida nós "…Tool" (usableAsTool) e HTTP Request com credencial pré-definida.
- Testes novos: nenhum nó com nome padrão, toda `$env` documentada, todos desativados e só com credenciais placeholder.

## 2026-09-28 (6)

- **Base de conhecimento (RAG):**
  - `knowledge/manifest.json` + `scripts/build-knowledge.mjs` → `knowledge/b2c-finance-knowledge.json`;
  - servida em `GET /api/v1/knowledge/documents`, com o scope novo `knowledge.read`.
- **Novo** `workflows/knowledge-ingest.json`: indexação manual no Qdrant. Ele apaga a coleção e grava os trechos, com embeddings `text-embedding-3-small` de 1536 dimensões.
- `b2c-finance-ai-agent.json`:
  - ferramenta `consultar_conhecimento` (Qdrant, retrieve-as-tool), só para conceitos e procedimentos;
  - o prompt passa a vir de `docs/AI_AGENT_SYSTEM_PROMPT.md`, com os 10 princípios.
- `examples/system-prompt-write.md` removido; o prompt agora vive em `docs/AI_AGENT_SYSTEM_PROMPT.md`.
- **Credencial nova** "Qdrant (conhecimento)"; variável `QDRANT_URL`.
- O teste de conexão mostra `faltandoParaConhecimento`.

## 2026-09-28 (5)

- **Novo** `workflows/b2c-finance-ai-agent.json`: agente com escrita controlada. O somente leitura fica intacto.
  - **Classificação:** READ executa; WRITE_CONFIRMATION gera prévia e pede confirmação; BLOCKED nunca.
  - **10 ferramentas de escrita** (`schemas/agent-write-tools.json`) que só **propõem** (`POST /agent/pending-actions`, operação fixa no corpo).
  - **"SIM <código>" / "NÃO"** são tratados antes da IA: ação pendente do usuário → `/confirm` ou `/cancel`, com `Idempotency-Key = wa:<mensagem>:<ação>`. "sim" sem código não confirma.
  - **Depois da IA**, se houve proposta nesta mensagem, o WhatsApp recebe a prévia montada pela API.
  - **Webhook próprio:** `/webhook/b2c-finance-ai-agent-v2`.
- **Scopes novos na integração:** `agent_actions.manage` e os de escrita. O teste de conexão mostra `faltandoParaEscrita`.
- `examples/system-prompt-write.md`: prompt do agente com escrita (substituído depois por `docs/AI_AGENT_SYSTEM_PROMPT.md`).

## 2026-09-28 (4)

- **Identidade pela API:** o agente não usa mais o diretório `B2C_WHATSAPP_USERS` nem `schemas/user-profiles.json` (removidos). A sequência passou a ser:
  1. "API: resolver identidade" (`POST /integrations/resolve-identity`, só o número);
  2. "Carregar permissões" (ferramentas = `allowedScopes` da API);
  3. `X-B2C-Identity` em toda ferramenta; a API recorta pelo RBAC do usuário e o registra como ator.
- A integração do agente precisa do scope `identities.resolve`, e o teste de conexão confere isso.
- O número é vinculado em **Configurações → Integrações → WhatsApp**.

## 2026-09-28 (3)

- `workflows/daily-morning-report.json` e `workflows/daily-evening-report.json`: relatórios por WhatsApp.
  - O fluxo é: cron (por variável) → API → mensagem padrão só com dados → IA organiza → validação (R$ desconhecido → mensagem padrão) → envio.
  - Os dois chegam desativados e têm o gatilho "Executar agora (teste)".
- `ENV.example`: variáveis novas de horário, destinatários, fuso e modo de envio:
  - `B2C_REPORT_RECIPIENTS`;
  - `B2C_MORNING_REPORT_CRON` / `B2C_EVENING_REPORT_CRON`;
  - `B2C_REPORT_TIMEZONE`;
  - `WHATSAPP_REPORT_MODE` / `_TEMPLATE` / `_TEMPLATE_LANG`.
- `schemas/agent-tools.json` 1.0.0: a descrição de `gerar_relatorio_diario` cita as seções novas do `/reports/daily`.

## 2026-09-28 (2)

- `workflows/b2c-finance-ai-agent-readonly.json` **substitui** `agente-whatsapp.consulta.v1.json`. O fluxo completo é:
  1. webhook;
  2. assinatura (Meta);
  3. normalizar payload;
  4. identificar número e descartar repetidas;
  5. resolver usuário e permissões (diretório `B2C_WHATSAPP_USERS` + perfis);
  6. agente, com contexto do usuário, data e ferramentas liberadas;
  7. interpretar resposta;
  8. responder no WhatsApp.

  Além do fluxo: notas explicativas, e cada ferramenta travada pelo perfil também na URL.
- `schemas/user-profiles.json` **1.0.0**: perfis `admin`, `financeiro`, `comercial` e `leitura`.
- `examples/system-prompt.md`: novas regras.
  - A API é a única fonte.
  - Não inventar dados nem ids.
  - Buscar antes de usar id.
  - Perguntar na ambiguidade (caso "Alpha").
  - Somente leitura; respeitar 403.
- `ENV.example`: `WHATSAPP_ALLOWED_NUMBERS` → `B2C_WHATSAPP_USERS` (número → nome e perfil).
- Credenciais com placeholders distintos (`CONFIGURAR_B2C_FINANCE_API`, `CONFIGURAR_WHATSAPP_API`, `CONFIGURAR_OPENAI`).
- `scripts/validate-with-n8n.cjs`: valida os nós contra uma instalação real do n8n.

## 2026-09-28

- `schemas/agent-tools.json` **1.0.0**: 11 ferramentas **somente leitura** (buscar_clientes, consultar_cliente, consultar_status_cliente, consultar_dashboard, consultar_recebimentos, consultar_despesas, consultar_caixa, consultar_upsells, consultar_rotina, gerar_relatorio_diario, gerar_relatorio_mensal).
- `workflows/agente-whatsapp.consulta.v1.json`: webhook do WhatsApp (Meta) com validação de assinatura, lista de números autorizados, AI Agent com as 11 ferramentas, memória por número e resposta no WhatsApp. Sem escrita.
- `workflows/sistema.teste-conexao.v1.json`: `/health`, `/me` e conferência dos scopes.
