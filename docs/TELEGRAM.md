# Telegram — canal principal do Agente B2C Finance

Fase 16 · blocos 1 e 2 (29/09/2026). O Telegram é só um **canal**: o agente, as ferramentas, a API, o RBAC, a base de conhecimento e a auditoria são os mesmos do WhatsApp, que continua disponível.

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
| `/help` | Somente leitura: exemplos de perguntas. Agente com escrita: também "Crie uma oportunidade de upsell de Google Ads para Cliente X.", "A Face Love pagou R$ 1.500 hoje.", "Deixe a Alpha inativa a partir de outubro." e o aviso de que toda alteração pede confirmação. |
| `/status` | "B2C Finance conectado", com usuário e perfil. No agente com escrita, também "Canal: Telegram" e "Agente: Leitura e ações controladas" (ou "Somente leitura", se o perfil não escreve). Não mostra scopes, tokens nem ids. |
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
| `b2c-finance-telegram-agent.json` (bloco 2) | Agente de consulta + escrita com botões Confirmar/Cancelar | Telegram Bot, B2C Finance API, OpenAI, Qdrant (conhecimento) | `B2C_FINANCE_API_URL` |
| `telegram-daily-morning-report.json` (bloco 2) | Relatório da manhã, por pessoa | Telegram Bot, B2C Finance API, OpenAI | `B2C_FINANCE_API_URL`, `TELEGRAM_MORNING_REPORT_CRON` |
| `telegram-daily-evening-report.json` (bloco 2) | Relatório da noite, por pessoa | Telegram Bot, B2C Finance API, OpenAI | `B2C_FINANCE_API_URL`, `TELEGRAM_EVENING_REPORT_CRON` |

Todos chegam **desativados**. O **Telegram só aceita um webhook por bot**: ative **o agente com escrita OU o somente leitura**, nunca os dois com o mesmo bot. Os relatórios não usam webhook (só enviam) e podem ficar ligados junto.

**Scopes da integração** para o Telegram somente leitura:
- `clients.read`, `client_status.read`, `receivables.read`, `expenses.read`, `cash.read`, `upsells.read`, `dashboard.read`, `routine.read`, `reports.read`;
- `identities.resolve`;
- `knowledge.read`, se a mesma integração for usada na indexação.

## 10. Instalação

O passo a passo de implantação (bot, credenciais, ordem, testes, ativação e rollback) está em [`docs/TELEGRAM_INTEGRATION.md`](TELEGRAM_INTEGRATION.md).

## 11. Agente com escrita e botões (bloco 2)

```
Mensagem → … → AI Agent (consulta + ferramentas que só PROPÕEM)
→ API: ação proposta nesta mensagem? → prévia da API + [Confirmar] [Cancelar]

Toque no botão (callback_query) → deduplicar → privado? → resolve-identity (from.id de quem tocou)
→ "confirm:<id>" / "cancel:<id>" válido? → GET /agent/pending-actions/{id} (é desta pessoa? estado?)
→ só PENDING: POST …/confirm (via button, Idempotency-Key telegram:<update_id>:<id>) ou …/cancel
→ answerCallbackQuery (aviso curto) + editMessageText (prévia com o resultado real, sem botões)
```

- **READ / WRITE_CONFIRMATION / BLOCKED** como no WhatsApp: 11 consultas, 10 escritas que só propõem, nenhuma ferramenta para excluir, reabrir competência, usuários, permissões ou plano de contas.
- **O botão leva só a referência** (`confirm:<id>`, até 64 bytes). Quem decide se vale é a API: usuário, vínculo, estado, validade, permissão e se os dados ainda são os da prévia.
- **Estados:** confirmada → `EXECUTED`; cancelada → `CANCELLED`; vencida (10 min) → `EXPIRED`. Tocar de novo: "Essa ação já foi processada." — nada executa outra vez.
- **"sim"/"não" digitado** com ação aguardando: o bot reenvia a prévia com os botões. Sem ação aguardando, é conversa normal.
- **Cliente ambíguo:** lista numerada (o agente pergunta qual). Botões por cliente ficaram de fora: a lista funciona igual nos dois canais e não põe ids de cliente em botões.
- **Trilha:** proposta, confirmação e a escrita ficam em Atividades da IA/API com origem **Telegram**, o usuário como ator, a ação, o rótulo (cliente), o valor e o resultado. Nenhum segredo.

## 12. Relatórios diários e preferências de envio

- **Quem recebe:** só quem tiver **Relatório da manhã** / **Relatório da noite** marcado em Integrações → Canais → **Envios** (preferência no próprio vínculo; padrão desligado) **e** puder ver relatórios no B2C Finance (quem não pode não entra, mesmo marcado). O workflow pergunta à API: `GET /integrations/recipients?channel=TELEGRAM&purpose=morning_report`.
- **Um relatório por pessoa, com o RBAC dela:** as consultas usam `X-B2C-Identity` = vínculo da pessoa. Quem não vê o caixa não recebe o caixa.
- **Manhã:** recebimentos previstos, recebido, vencidos, despesas vencendo, MRR, churn, renovações, prioridades da rotina.
- **Noite:** recebido no dia, despesas pagas, cobranças em aberto, clientes cadastrados, mudanças de status, upsells, ações executadas (rotina e agente), pendências.
- **Sem dado inventado:** a mesma consolidação e a mesma validação dos relatórios do WhatsApp (a IA só reorganiza; R$ que não está nos dados → vai a mensagem padrão).
- **Fuso:** a data vem da API (`today`, America/Bahia). O cron roda no fuso do workflow (Settings → Timezone).

## 13. Avisos proativos (preparados, não ligados)

- **Catálogo** (`src/lib/messaging/notifications.ts`): recebimento registrado, cobrança vencida, renovação chegando, despesa perto do vencimento.
- **Preferência:** no mesmo diálogo **Envios**, por vínculo; padrão nenhum.
- **Destinatários:** o mesmo `GET /integrations/recipients` (`purpose=receivable.overdue` etc.).
- **Falta o entregador:** os eventos de negócio já vão para o Outbox (canal `integracao`) e ficam pendentes. Ligar o envio exige um workflow de avisos e regras anti-spam (agrupamento, horário). Nada é enviado hoje.

## 14. Hardening (bloco 3)

- **Anti-flood:** nó "Limitar mensagens por pessoa", logo depois do filtro de chat privado e antes da API e da IA.
  - No máximo `TELEGRAM_MAX_UPDATES_POR_MINUTO` (padrão 20) por Telegram User ID; o excedente recebe um aviso uma vez e o resto é descartado.
  - É melhor esforço: o static data não é atômico, então uma rajada simultânea pode passar. Flood contínuo e laço são cortados.
- **Limite na API:** por usuário do vínculo, 20 propostas e 30 confirmações/cancelamentos por minuto (429 + `Retry-After: 60`). A contagem usa a própria trilha de atividades, então vale entre instâncias. O limite por IP (120/min) continua.
- **API fora do ar:** "Não consegui acessar os dados do B2C Finance neste momento. Tente novamente em alguns minutos." Depois do aviso, o nó "Registrar falha da API" marca a execução como erro no n8n.
- **Formatação:** o texto é dividido medindo o tamanho **depois** do escape, sem partir emoji e preservando os separadores originais. Relatório vai em até 10 partes, sem truncar; o agente, em até 4, com aviso.
- **Referência a nós:** em parâmetro de nó HTTP, use `$node['Nó'].json`, nunca `$('Nó')`. No n8n 1.123, `$('Nó')` não resolve dentro de loop e o valor sai vazio. O teste `tests/telegram-hardening-n8n.test.ts` barra.
- **Resposta delegada:** a API devolve `meta.onBehalfOf.identityId`. O relatório só é entregue se toda consulta respondeu em nome da pessoa.

## 15. Testes

| Arquivo | Cobre |
|---|---|
| `tests/api-identidade-telegram.test.ts` | Canal TELEGRAM, Telegram User ID, username recusado (regra, API e banco), metadata, duplicidade, usuário inativo, outro workspace, compatibilidade do WhatsApp, delegação/RBAC e ação pendente nascendo no canal TELEGRAM |
| `tests/integracao-n8n.test.ts` ("Telegram") | Fluxo, identidade só pelo ID, somente leitura, prompt, normalização, `update_id`, privado × grupo × canal, `/start` `/help` `/status`, escape HTML, divisão em partes, teste de conexão |
| `tests/api-telegram-escrita.test.ts` (bloco 2) | Confirmação por botão: válida, inválida, de outro usuário, vencida, repetida (replay e novo toque), cancelada; Idempotency-Key `telegram:`; pagamento, cadastro, status futuro, despesa, upsell, rotina; operação bloqueada; permissão (sem `cash.read`); trilha com origem Telegram; destinatários por preferência |
| `tests/api-telegram-seguranca.test.ts` (bloco 3) | Callback de outra pessoa e de outro workspace, id inexistente e adulterado; dois toques simultâneos, o mesmo update repetido, dois pagamentos simultâneos (uma escrita); limite por usuário (429); matriz de perfis; trilha sem segredo |
| `tests/telegram-hardening-n8n.test.ts` (bloco 3) | Escape (&, < >, emoji, acento, R$), relatório longo (ordem, sem repetir, sem truncar), conteúdo hostil, anti-flood, API fora do ar, privado × grupo × canal, identidade por from.id, credenciais placeholder, nenhuma referência `$('…')` em nó HTTP |
| `tests/telegram-escrita-n8n.test.ts` (bloco 2) | Workflow com escrita (ferramentas, botões, callback, prompt), lógica dos nós com entradas simuladas, relatórios (destinatários, RBAC por pessoa, mesma consolidação) |

**E2E final (bloco 3), no n8n 1.123.82** com a API em build de produção, Qdrant local com chave, Bot API do Telegram e IA simulados (IA roteirizada). Os 20 cenários do bloco 3 deram o resultado esperado, mais: importação sem credenciais, teste de conexão, dois toques simultâneos e anti-flood.

**E2E do bloco 1** (mesmo ambiente): 17 cenários, todos com o resultado esperado.

| Grupo | Cenários |
|---|---|
| Comandos | `/start` não vinculado; `/start` vinculado; `/status` |
| Perguntas | "Quanto recebemos hoje?"; "Qual nosso MRR?"; "Explique MRR e TCV."; cliente ambíguo |
| Entrada | mensagem em grupo; update duplicado; segredo do webhook errado (403) |
| Falhas | Qdrant fora (pergunta de dados continua; conceito falha sem quebrar); API fora (resposta segura, sem IA) |
| Teste de conexão | Qdrant fora e tudo no ar |
