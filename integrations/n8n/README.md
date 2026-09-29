# B2C Finance × n8n

Integração do B2C Finance com o n8n: o **agente** (Telegram, canal principal; WhatsApp, opcional) e os relatórios diários. Tudo fica versionado neste repositório, junto com a API que ela consome.

> **Telegram é o canal principal** (Fase 16): `b2c-finance-telegram-agent.json` (consulta + escrita com botões Confirmar/Cancelar) ou `b2c-finance-telegram-agent-readonly.json`, `telegram-connection-test.json` e os relatórios `telegram-daily-*-report.json`. Implantação passo a passo: [`docs/TELEGRAM_INTEGRATION.md`](../../docs/TELEGRAM_INTEGRATION.md). Referência técnica: [`docs/TELEGRAM.md`](../../docs/TELEGRAM.md).
>
> **Agentes do WhatsApp (canal opcional, mantido):**
> - `b2c-finance-ai-agent.json` consulta e **propõe escritas com confirmação**. Nada é gravado sem o usuário responder `SIM <código>`. Detalhes em [`docs/N8N_AGENT_WRITE_ACTIONS.md`](../../docs/N8N_AGENT_WRITE_ACTIONS.md).
> - `b2c-finance-ai-agent-readonly.json` é o somente leitura, mantido como referência e alternativa de volta.
>
> **RAG = conhecimento e documentação. API = dados atuais.** A base de conhecimento (`consultar_conhecimento`, no Qdrant) explica conceitos e procedimentos, mas nunca é fonte de saldo, MRR, clientes ativos, recebimentos, despesas, status atual ou inadimplência. Guia: [`docs/AI_AGENT_KNOWLEDGE.md`](../../docs/AI_AGENT_KNOWLEDGE.md). Prompt do agente: [`docs/AI_AGENT_SYSTEM_PROMPT.md`](../../docs/AI_AGENT_SYSTEM_PROMPT.md).

```
integrations/n8n/
├── README.md                         este guia
├── ENV.example                       variáveis (sem segredo real)
├── CHANGELOG.md
├── workflows/
│   ├── b2c-finance-ai-agent.json          WhatsApp → identidade → SIM/NÃO (sem IA) ou AI Agent (11 GET + 10 que propõem + conhecimento) → WhatsApp
│   ├── b2c-finance-ai-agent-readonly.json WhatsApp → identidade (API) → AI Agent (11 ferramentas GET) → WhatsApp
│   ├── knowledge-ingest.json              indexa a base de conhecimento no Qdrant (manual; serve aos dois canais)
│   ├── b2c-finance-telegram-agent.json    Telegram (mensagem ou botão) → identidade → botão: GET/confirm/cancel na API | AI Agent (11 GET + 10 que propõem + conhecimento) → prévia com [Confirmar] [Cancelar]
│   ├── b2c-finance-telegram-agent-readonly.json Telegram → identidade (API) → AI Agent (12 GET, inclui consultar_inadimplencia, + conhecimento) → Telegram
│   ├── telegram-connection-test.json      Telegram + API + identidade + Qdrant (manual)
│   ├── telegram-daily-morning-report.json relatório da manhã no Telegram: destinatários pela API, um por pessoa com o RBAC dela
│   ├── telegram-daily-evening-report.json relatório da noite no Telegram (idem + ações do agente)
│   ├── daily-morning-report.json          relatório da manhã por WhatsApp (cron)
│   ├── daily-evening-report.json          relatório da noite por WhatsApp (cron)
│   └── sistema.teste-conexao.v1.json      /health + /me + conferência de scopes
├── knowledge/
│   ├── manifest.json                 o que entra (e o que nunca entra) na base de conhecimento
│   └── b2c-finance-knowledge.json    pacote gerado: documentos + trechos (servido em GET /knowledge/documents)
├── schemas/
│   ├── agent-tools.json              catálogo das ferramentas de consulta (fonte de verdade)
│   ├── agent-write-tools.json        ferramentas que propõem escrita + classificação de risco
│   └── agent-tools.schema.json       JSON Schema do catálogo
├── examples/
│   ├── system-prompt.md              instruções do agente somente leitura
│   ├── tool-calls.md                 conversa de exemplo, chamadas e respostas
│   └── whatsapp-webhook-payload.json payload de exemplo da Meta
└── scripts/
    ├── build-knowledge.mjs           gera o pacote da base de conhecimento (docs → trechos)
    ├── build-workflows.mjs           gera os agentes do WhatsApp, a indexação e o teste de conexão
    ├── build-telegram-workflows.mjs  gera os workflows do Telegram
    ├── lib/pecas.mjs                 peças comuns aos canais (ferramentas, conhecimento, prompt)
    ├── build-report-workflows.mjs    gera os relatórios da manhã e da noite (WhatsApp e Telegram)
    ├── check-secrets.mjs             barra segredo versionado (roda no CI)
    ├── validate-with-n8n.cjs         confere os nós contra uma instalação real do n8n
    ├── import.sh / export.sh         CLI do n8n (exportação normalizada)
```

**Referências da API:**

| O que | Onde |
|---|---|
| OpenAPI | `https://b2-c-finance.vercel.app/api/openapi.json` |
| Documentação interativa | `/api/docs` |
| Guia de uso da API | [`docs/API_CONSUMER_GUIDE.md`](../../docs/API_CONSUMER_GUIDE.md) |

---

## 0. Pré-requisitos

- **n8n 1.50 ou superior,** com os nós de IA:
  - AI Agent;
  - OpenAI Chat Model;
  - Window Buffer Memory;
  - HTTP Request Tool.
- **Configuração do n8n:**
  - `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, para o nó Code validar a assinatura do webhook;
  - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`, para os nós lerem `$env.B2C_FINANCE_API_URL` e as demais variáveis.
- **n8n acessível por HTTPS público,** porque a Meta só entrega webhook em HTTPS.
- **Variáveis de ambiente:** as de [`ENV.example`](./ENV.example), definidas no ambiente do n8n.

> Os JSONs são **gerados** por `scripts/build-workflows.mjs` e conferidos de três formas:
> - **Contra a OpenAPI**, por teste: só `GET`, scopes e parâmetros certos.
> - **Contra as definições reais dos nós do n8n 1.123:** tipo, versão, parâmetros e credenciais. O comando é `N8N_MODULES=<node_modules do n8n> npm run n8n:validate`.
> - **Importando e executando num n8n real** (ver [`docs/N8N_READONLY_AGENT.md`](../../docs/N8N_READONLY_AGENT.md) §7).
>
> Se uma versão diferente do n8n acusar algum parâmetro, recrie o nó da ferramenta a partir de [`schemas/agent-tools.json`](./schemas/agent-tools.json).

> **Relatórios diários (manhã e noite) por WhatsApp:** configuração, horário, fuso e envio por modelo aprovado estão em [`docs/N8N_DAILY_REPORTS.md`](../../docs/N8N_DAILY_REPORTS.md).
>
> **Guia completo do agente somente leitura** (fluxo nó a nó, regras do prompt, perfis, testes executados num n8n real): [`docs/N8N_READONLY_AGENT.md`](../../docs/N8N_READONLY_AGENT.md).

## 1. Como importar o workflow

**Pela interface:**

1. No n8n, abra **Workflows → Import from File**.
2. Importe `workflows/sistema.teste-conexao.v1.json`.
3. Importe `workflows/b2c-finance-ai-agent-readonly.json`.

**Pela CLI:** rode `scripts/import.sh`, dentro do container do n8n ou com a CLI instalada.

Os workflows chegam **desativados** e com as credenciais **por ligar**: os nós mostram um aviso até você escolher a credencial (§2 a §4). Nenhum JSON contém segredo; os ids de credencial são placeholders (`CONFIGURAR_B2C_FINANCE_API`, `CONFIGURAR_WHATSAPP_API`, `CONFIGURAR_OPENAI`).

## 2. Como configurar a API B2C

1. **Crie a integração.** No B2C Finance, como administrador, abra **Configurações → Integrações (API) → Nova integração** e preencha:
   - **Nome:** `B2C Finance AI Agent`.
   - **Scopes:** marque **só os de leitura** que o agente usa, mais `identities.resolve` (para identificar quem fala): `identities.resolve`, `clients.read`, `client_status.read`, `receivables.read`, `expenses.read`, `cash.read`, `upsells.read`, `dashboard.read`, `routine.read`, `reports.read`. Nenhum scope de escrita.
   - **Validade:** 180 dias.
2. **Guarde o token.** Ele aparece **uma única vez**: copie direto para o passo 3.
3. **Crie a credencial no n8n.** Em **Credentials → New → Header Auth**, preencha:
   - Nome: `B2C Finance API` (exatamente assim, porque os nós procuram esse nome).
   - Name: `Authorization`.
   - Value: `Bearer YOUR_API_TOKEN` (o token do passo 2 no lugar de `YOUR_API_TOKEN`).
4. **Defina a URL da API.** No ambiente do n8n, defina `B2C_FINANCE_API_URL=https://b2-c-finance.vercel.app/api/v1`.

O token **nunca** vai em variável de ambiente, em nó, em expressão nem no Git. Só a credencial do n8n, que é criptografada, guarda o token.

## 3. Como configurar o WhatsApp (Meta WhatsApp Cloud API)

1. **Crie a credencial.** Em **Credentials → New → Header Auth**, preencha:
   - Nome: `WhatsApp API`.
   - Name: `Authorization`.
   - Value: `Bearer <token de acesso do app/usuário do sistema>`.
2. **Defina as variáveis** (valores em `ENV.example`):

   | Variável | Conteúdo |
   |---|---|
   | `WHATSAPP_API_URL` | Por exemplo, `https://graph.facebook.com/v21.0`. |
   | `WHATSAPP_WEBHOOK_SECRET` | O **App Secret** do app na Meta. Valida a assinatura (§8). |
   | `WHATSAPP_VERIFY_TOKEN` | Um texto longo aleatório que você inventa. |
   | `WHATSAPP_PHONE_NUMBER_ID` | O id do número na Meta. |

3. **Configure o webhook no painel da Meta.** Em **WhatsApp → Configuration → Webhook**, preencha:
   - **Callback URL:** a URL de produção do webhook `b2c-finance-ai-agent` do workflow, por exemplo `https://SEU-N8N/webhook/b2c-finance-ai-agent`.
   - **Verify token:** o mesmo `WHATSAPP_VERIFY_TOKEN`. O nó "Webhook WhatsApp (verificação GET)" responde o desafio.
   - **Assine o campo `messages`.**

4. **Vincule os números da equipe.** No B2C Finance, em **Configurações → Integrações → WhatsApp → Vincular WhatsApp**, escolha o usuário e digite o número. Quem pode consultar, e o quê, é decidido **pelo B2C Finance**:
   - o workflow pergunta à API quem é o dono do número (`POST /integrations/resolve-identity`);
   - o agente atende com o **RBAC desse usuário**, limitado aos scopes da integração;
   - cada chamada leva `X-B2C-Identity`, e a API confere de novo.

   **Número sem vínculo:** recebe só uma resposta genérica e **nenhum dado**. Ao desligar alguém da equipe, **desative o usuário** ou **desvincule o número**. Os dois cortam o acesso na hora. Detalhes: [`docs/N8N_READONLY_AGENT.md`](../../docs/N8N_READONLY_AGENT.md) §4.

> Se usar outro provedor de WhatsApp (Evolution API, Z-API, Twilio), troque três nós: "Validar assinatura (Meta)" (assinatura do provedor), "Normalizar payload" (formato da mensagem) e "Responder no WhatsApp" (endpoint e corpo de envio). O agente e as ferramentas não mudam.

## 4. Como configurar o modelo de IA

1. **Crie a credencial.** Em **Credentials → New → OpenAI**, com o nome `OpenAI` e a chave da conta (`OPENAI_API_KEY`, que fica só na credencial).
2. **Escolha o modelo.** O nó "Modelo de IA" vem com `gpt-4o-mini` e temperatura 0.2, porque respostas factuais pedem temperatura baixa. Qualquer modelo com **tool calling** serve.
3. **Para usar outro provedor:** troque o nó por outro chat model do n8n (Anthropic, Azure OpenAI, Gemini) e ligue-o na entrada *Chat Model* do agente. As ferramentas e o prompt não mudam.
4. **Instruções do agente.** O prompt está em [`examples/system-prompt.md`](./examples/system-prompt.md) e já vai dentro do nó "AI Agent B2C Finance (somente leitura)", junto com o contexto de quem pergunta: nome e papel (vindos da API), ferramentas liberadas e a data de hoje. Para mudar as instruções, edite o `.md` e rode `npm run n8n:build`, ou edite no n8n e exporte (§6). Regras principais:
   - buscar o cliente antes de consultar e **perguntar** se houver mais de um resultado;
   - usar o status **da competência** para meses passados;
   - usar os totais que a API já calcula;
   - tratar seção omitida como "sem acesso";
   - não escrever nada.
5. **Memória.** A conversa fica guardada por número (as últimas 10 trocas), no nó "Memória da conversa".

**Ferramentas disponíveis ao agente** (catálogo completo com JSON Schema de entrada em [`schemas/agent-tools.json`](./schemas/agent-tools.json)):

| Ferramenta | Chamada | Scope |
|---|---|---|
| `buscar_clientes` | `GET /search?q=&type=client` | `clients.read` |
| `consultar_cliente` | `GET /clients/{id}` | `clients.read` |
| `consultar_status_cliente` | `GET /clients/{id}/status-history` | `client_status.read` |
| `consultar_dashboard` | `GET /dashboard/summary` | `dashboard.read` |
| `consultar_recebimentos` | `GET /receivables` | `receivables.read` |
| `consultar_despesas` | `GET /expenses` | `expenses.read` |
| `consultar_caixa` | `GET /cash/summary` | `cash.read` |
| `consultar_upsells` | `GET /upsells` | `upsells.read` |
| `consultar_rotina` | `GET /routine/daily` | `routine.read` |
| `gerar_relatorio_diario` | `GET /reports/daily` | `reports.read` |
| `gerar_relatorio_mensal` | `GET /reports/monthly` | `reports.read` |

O catálogo usa JSON Schema, o mesmo formato de `parameters`/`input_schema` das APIs de *tool calling*. Um agente fora do n8n pode usar o mesmo arquivo.

## 5. Como testar

1. **Teste a conexão.** Abra "B2C · Sistema · Teste de conexão (v1)" e clique em **Execute workflow**. O último nó deve mostrar `ok: true`. Se aparecer `faltando: [...]`, marque esses scopes numa integração nova ou rotacione a atual (§7).
2. **Teste as ferramentas isoladas.** No workflow do agente, abra uma ferramenta (por exemplo `buscar_clientes`) e use **Test step** com um valor. A resposta deve vir no formato `{ "success": true, … }`.
3. **Teste a conversa ponta a ponta.** Com o workflow **desativado**, clique em **Test workflow** (o webhook de teste fica ouvindo) e mande uma mensagem de um número do diretório. Por exemplo, "a Face Love está devendo este mês?".
   - O webhook de **teste** tem outra URL: `/webhook-test/…`. Use a de produção no painel da Meta só depois de ativar.
4. **Teste a segurança.** Estes três casos **não** podem chegar ao agente:
   - payload com assinatura errada ou sem assinatura: descartado, sem resposta;
   - número fora do diretório: recebe só a resposta genérica;
   - ferramenta que o usuário não pode usar: não chega à API (e, se chegasse, a API responderia 403 `user_forbidden`);
   - a mesma mensagem reenviada pela Meta (mesmo `messageId`): não gera segunda resposta;
   - pedido de escrita ("registra o pagamento da Face Love"): o agente explica que não pode.
5. **Confira no B2C Finance.** Em **Configurações → Integrações → Atividades da IA/API**, cada consulta aparece com a origem **WhatsApp**. As ferramentas enviam `X-B2C-Source: whatsapp` e `x-request-id = n8n-<id da execução>`, que ligam a atividade à execução no n8n.

Se quiser testar sem o n8n, use o curl de [`examples/tool-calls.md`](./examples/tool-calls.md).

## 6. Como ativar (e manter)

1. **Ative.** Com o teste ok, ative o workflow com o *toggle* **Active**. O webhook de produção passa a valer.
2. **Aponte a Meta para produção.** No painel da Meta, use a URL de produção (`/webhook/b2c-finance-ai-agent`).
3. **Execuções salvas:** o workflow salva só as execuções **com erro** (`saveDataSuccessExecution: none`). Assim, conversas com dados financeiros não se acumulam no banco do n8n.
4. **Mudar o workflow segue o mesmo fluxo de código:**
   1. Edite no n8n.
   2. Rode `scripts/export.sh <id> b2c-finance-ai-agent-readonly.json`. O script remove ids e datas, desativa o workflow no JSON e roda o verificador de segredos.
   3. Abra um PR. O CI roda `tests/integracao-n8n.test.ts`, que confere o workflow contra o catálogo e a OpenAPI, e o `check-secrets`.
   4. Registre a mudança no `CHANGELOG.md`.
   - Mudança **incompatível** da API gera `…v2.json`, que convive com a v1 até a troca.

## 7. Como rotacionar o token

A rotação troca o token **na hora**. O token antigo para de funcionar assim que você rotaciona, então faça os passos em sequência:

1. **Rotacione.** No B2C Finance, em **Configurações → Integrações**, clique em **Rotacionar** na integração e copie o token novo (ele aparece uma vez).
2. **Atualize a credencial.** No n8n, abra **Credentials → B2C Finance API** e coloque `Bearer <novo token>` no Value. Os workflows usam a credencial pelo nome e não precisam ser reimportados.
3. **Confira.** Rode o **Teste de conexão** (§5.1).

| Situação | O que fazer |
|---|---|
| Suspeita de vazamento | **Revogar** (irreversível) em vez de rotacionar, criar uma integração nova e seguir os passos 2 e 3. Depois, conferir em **Atividades da IA/API** o que foi chamado no período. |
| Validade vencendo | O token expira no prazo escolhido; a resposta é `401 expired_token`. Rotacione **antes** do vencimento; a data aparece no card da integração. |
| Token da Meta ou chave da IA | Troque só o valor na credencial correspondente (`WhatsApp API` / `OpenAI`). |

## 8. Como validar a assinatura de webhook

### 8.1 Entrada: WhatsApp → n8n (já implementado)

A Meta assina cada POST com o **App Secret**:

```
X-Hub-Signature-256: sha256=<hex de HMAC-SHA256(App Secret, corpo CRU da requisição)>
```

O nó **"Validar assinatura (Meta)"** faz a validação:

1. Lê o **corpo cru**. O webhook tem a opção **Raw Body** ligada, porque o JSON reserializado não bate byte a byte com o que a Meta assinou.
2. Calcula o HMAC com `WHATSAPP_WEBHOOK_SECRET`.
3. Compara com o header em **tempo constante** (`crypto.timingSafeEqual`).
4. Assinatura ausente ou diferente: **descarta** a requisição, que não segue para o agente. Sem o segredo configurado, o nó falha em vez de aceitar tudo.

Trecho essencial, para portar a outro provedor:

```js
const crypto = require('crypto');
const esperada = 'sha256=' + crypto.createHmac('sha256', segredo).update(corpoCru).digest('hex');
const a = Buffer.from(recebida), b = Buffer.from(esperada);
const valida = a.length === b.length && crypto.timingSafeEqual(a, b);
```

A **verificação inicial** do webhook (GET com `hub.challenge`) só é respondida quando `hub.verify_token` confere com `WHATSAPP_VERIFY_TOKEN`; caso contrário, a resposta é 403.

### 8.2 Saída: B2C Finance → n8n (eventos; próxima fase)

Quando o B2C Finance começar a **enviar eventos** ao n8n (fase de eventos do plano, [`docs/API_IMPLEMENTATION_PLAN.md`](../../docs/API_IMPLEMENTATION_PLAN.md) §12), cada POST vai trazer:

```
X-B2C-Signature: t=<unix epoch em segundos>,v1=<hex de HMAC-SHA256(B2C_WEBHOOK_SECRET, "<t>.<corpo cru>")>
X-B2C-Event-Id: <id único do evento>
```

Para validar no n8n:

1. Ligue **Raw Body** no webhook.
2. Recuse se `|agora − t| > 300 s` (proteção contra *replay*).
3. Recalcule o HMAC sobre `"<t>.<corpo cru>"` e compare em tempo constante.
4. Descarte `X-B2C-Event-Id` já processado (idempotência na ponta do n8n).

O segredo `B2C_WEBHOOK_SECRET` vai ser gerado na tela de Integrações quando a fase entrar.

---

## Segurança, em resumo

- **Integração só de leitura, com scopes mínimos:** mesmo que o agente "queira", a API recusa escrita (`403`).
- **O dono dos dados vem da integração:** o agente não consegue pedir dados de outro workspace.
- **Travas antes e em volta do agente:**
  - assinatura do webhook;
  - diretório de usuários;
  - identidade resolvida pela API (vínculo no B2C Finance) e delegação `X-B2C-Identity` em cada chamada;
  - ferramentas liberadas pelo RBAC do usuário (no prompt e na URL de cada ferramenta);
  - descarte de mensagens repetidas;
  - o prompt, que proíbe escrita, inventar dados ou ids e expor dados de quem não foi perguntado.
- **Nenhum segredo no Git:** `npm run n8n:check` e o CI barram tokens (`b2c_live_…`, `sk-…`, `EAA…`, `Bearer …`) e ids reais de credencial.
- **Rastreabilidade:** tudo o que o agente consulta aparece em **Atividades da IA/API**, com origem, ação e resultado.
