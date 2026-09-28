# Telegram — canal principal do Agente B2C Finance

Fase 16 · bloco 1 (29/09/2026). O Telegram é só um **canal**: o agente, as ferramentas, a API, o RBAC, a base de conhecimento e a auditoria são os mesmos do WhatsApp, que continua disponível.

```
Telegram (conversa privada)
→ n8n: gatilho (secret_token) → normalizar → deduplicar (update_id) → chat privado?
→ API: resolve-identity (Telegram User ID) → permissões (conta ∩ RBAC)
→ /start /help /status sem IA   |   pergunta → AI Agent
→ ferramentas GET na API + consultar_conhecimento (Qdrant)
→ HTML escapado, dividido em partes → sendMessage
```

O n8n nunca acessa banco, Supabase ou Prisma: tudo passa pela API oficial.

## 1. Identidade: Telegram User ID

- **A identidade é o `message.from.id`** (um inteiro positivo), guardado em `MessagingIdentity` com `channel = TELEGRAM` e `externalIdentifier = "123456789"`.
- **O @username nunca identifica:** a pessoa troca quando quer, e outra pode passar a usá-lo. Ele fica só em `metadata`, para exibição, junto com o nome.
  - A API recusa username como identificador (400).
  - O banco também recusa, pela checagem `MessagingIdentity_telegram_formato`.
- **A API devolve** usuário, papel, permissões relevantes e scopes efetivos (conta ∩ RBAC). Não existe scope "de Telegram".
- **Chat privado:** o `chat.id` é igual ao User ID, e é para ele que a resposta vai.

## 2. Descobrir o ID e vincular

1. A pessoa manda **/start** para o bot. Se ainda não estiver vinculada, recebe:
   > Olá! Seu Telegram ainda não está vinculado ao B2C Finance.
   > Seu identificador Telegram é: **123456789**
   > Solicite a um administrador que vincule este ID ao seu usuário no B2C Finance.

   Nenhuma informação financeira aparece.
2. O administrador abre **Configurações → Integrações → Canais → Vincular canal**:
   - Canal: Telegram;
   - Telegram User ID: `123456789`;
   - username (opcional): `@pessoa`;
   - o usuário do B2C Finance.

   Só quem tem `integracoes.gerenciar` (administrador) vincula, desvincula ou reativa. Tudo fica no AuditLog.
3. A pessoa manda /start de novo: "Olá, *nome*. Você está conectado ao B2C Finance."

O endereço antigo `/configuracoes/integracoes/whatsapp` redireciona para a aba Canais.

## 3. Só conversa privada

| Onde chegou | O que acontece |
|---|---|
| Conversa privada, de uma pessoa | Segue o fluxo normal. |
| Grupo / supergrupo | Uma orientação genérica ("eu só atendo em conversa privada"). Nenhuma consulta, identificação ou IA. |
| Canal, bot ou remetente anônimo | Ignorado, sem resposta. |

Com o modo de privacidade padrão do BotFather, o bot em grupo só recebe comandos e menções. A arquitetura deixa um ponto único ("Chat privado?") para, no futuro, liberar grupos com regras próprias.

## 4. Segurança da entrada

- **Webhook assinado:** ao ativar, o gatilho do n8n registra o webhook no Telegram com um `secret_token`. Todo update precisa trazer esse valor no header `X-Telegram-Bot-Api-Secret-Token`; sem ele, o n8n responde 403, com comparação em tempo constante.
- **Deduplicação por `update_id`:** o Telegram reenvia o update quando não recebe 200 a tempo. Os últimos 1000 ids ficam no static data do workflow, o mesmo mecanismo do WhatsApp, sem banco paralelo. Vale nas execuções de produção (workflow ativo).
- **Bot token** só na credencial do n8n **"Telegram Bot"** (tipo Telegram API). Nunca em workflow, código, repositório ou chat. Em documentação, só o placeholder `TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN`.

## 5. Comandos

| Comando | Resposta (sem IA) |
|---|---|
| `/start` | Vinculado: saudação e exemplos. Não vinculado: o próprio Telegram User ID. |
| `/help` | Exemplos de perguntas: "Quanto recebemos hoje?", "Quem está inadimplente?", "Qual nosso MRR?", "Quais clientes renovam este mês?", "Qual nosso churn?". Nenhum exemplo de escrita. |
| `/status` | "B2C Finance conectado", com o usuário e o perfil. Não mostra scopes nem ids. |
| Outro `/comando` | "Comando não reconhecido. Mande /help…" |

## 6. Formatação e tamanho

- **HTML** (`parse_mode: HTML`). Todo texto, venha da API, do usuário ou da IA, é **escapado** (`&`, `<`, `>`) antes de virar HTML. Só `*negrito*` / `**negrito**` viram `<b>` e `` `código` `` vira `<code>`. Tabela markdown vira linhas "a · b · c".
- **Limite do Telegram:** 4096 caracteres por mensagem. A resposta é dividida por parágrafo (depois por linha, nunca no meio de uma palavra), em "Parte 1/3"…, com no máximo 4 partes. Passou disso, a última parte avisa para pedir um recorte menor.
- **O prompt pede resumo primeiro** ("Encontrei 47 inadimplentes, R$ X em aberto. Quer a lista?") em vez de despejar centenas de linhas.

## 7. Erros (mensagens padronizadas no prompt)

| Situação | Mensagem |
|---|---|
| 403 | Você não possui permissão para acessar essa informação. |
| 404 | Não encontrei o registro solicitado. |
| 422 | Não foi possível concluir: + a mensagem da API. |
| 500 / falha | Não consegui concluir essa consulta agora. A tentativa foi registrada. |
| API fora do ar (identidade) | Não consegui verificar seu acesso agora. Tente de novo em instantes. |

Nunca stack trace, token ou detalhe técnico.

## 8. Base de conhecimento (Qdrant) e fallback

- **RAG = conhecimento; API = dados atuais.** O workflow usa a mesma coleção e o mesmo `knowledge-ingest.json` do WhatsApp; nada foi duplicado.
- **Qdrant fora do ar:** o nó do Qdrant só abre conexão quando a ferramenta é usada.
  - Perguntas de dados ("Quanto recebemos hoje?") **continuam funcionando** pela API.
  - Perguntas de conceito: a ferramenta falha, e o prompt manda avisar que a base está indisponível e responder só com o que vier da API.
  - Os dois casos foram verificados no E2E com o Qdrant parado.
- **Credencial do Qdrant ausente** é outra situação: o agente não inicia. Configure a credencial antes de ativar.

## 9. Workflows deste bloco

| Arquivo | O que faz | Credenciais | Variáveis |
|---|---|---|---|
| `b2c-finance-telegram-agent-readonly.json` | Agente de consulta no Telegram | Telegram Bot, B2C Finance API, OpenAI, Qdrant (conhecimento) | `B2C_FINANCE_API_URL` |
| `telegram-connection-test.json` | Teste manual: `/health`, `/me` (scopes), identidade, Qdrant → mensagem com OK/FALHOU | Telegram Bot, B2C Finance API, Qdrant (conhecimento) | `B2C_FINANCE_API_URL`, `QDRANT_URL`, `TELEGRAM_TEST_USER_ID` |
| `knowledge-ingest.json` (existente, reaproveitado) | Indexa a base no Qdrant | B2C Finance API, OpenAI, Qdrant | `B2C_FINANCE_API_URL`, `QDRANT_URL` |

Todos chegam **desativados**. O **Telegram só aceita um webhook por bot**: não ative dois workflows de Telegram com o mesmo bot ao mesmo tempo. Quando o agente com escrita chegar (bloco 2), ele substitui este.

**Scopes da integração** para o Telegram somente leitura:
- `clients.read`, `client_status.read`, `receivables.read`, `expenses.read`, `cash.read`, `upsells.read`, `dashboard.read`, `routine.read`, `reports.read`;
- `identities.resolve`;
- `knowledge.read`, se a mesma integração for usada na indexação.

## 10. Instalação (quando for para a instância real)

1. **BotFather:** `/newbot` → guarde o token **só** na credencial "Telegram Bot" do n8n.
2. **Credenciais no n8n:**
   - "Telegram Bot" (Telegram API: access token; base URL padrão);
   - "B2C Finance API";
   - "OpenAI";
   - "Qdrant (conhecimento)".
3. **Variáveis:** as de `integrations/n8n/ENV.example`, incluindo `TELEGRAM_TEST_USER_ID`.
4. **Base de conhecimento:** rode `knowledge-ingest.json` (a versão do pacote mudou nesta fase).
5. **Vínculo:** vincule o seu Telegram em Integrações → Canais.
6. **Teste de conexão:** importe e execute `telegram-connection-test.json`. Tudo deve voltar OK no seu Telegram.
7. **Agente:** importe `b2c-finance-telegram-agent-readonly.json`, teste manualmente e só então ative. A ativação registra o webhook no Telegram.

## 11. Testes

| Arquivo | Cobre |
|---|---|
| `tests/api-identidade-telegram.test.ts` | Canal TELEGRAM, Telegram User ID, username recusado (regra, API e banco), metadata, duplicidade, usuário inativo, outro workspace, compatibilidade do WhatsApp, delegação/RBAC e ação pendente nascendo no canal TELEGRAM |
| `tests/integracao-n8n.test.ts` ("Telegram") | Fluxo, identidade só pelo ID, somente leitura, prompt, normalização, `update_id`, privado × grupo × canal, `/start` `/help` `/status`, escape HTML, divisão em partes, teste de conexão |

**E2E no n8n 1.123.82** (Bot API do Telegram simulada, API e Qdrant locais, IA simulada): 17 cenários, todos com o resultado esperado.

| Grupo | Cenários |
|---|---|
| Comandos | `/start` não vinculado; `/start` vinculado; `/status` |
| Perguntas | "Quanto recebemos hoje?"; "Qual nosso MRR?"; "Explique MRR e TCV."; cliente ambíguo |
| Entrada | mensagem em grupo; update duplicado; segredo do webhook errado (403) |
| Falhas | Qdrant fora (pergunta de dados continua; conceito falha sem quebrar); API fora (resposta segura, sem IA) |
| Teste de conexão | Qdrant fora e tudo no ar |
