# Implantação do Telegram — passo a passo

Guia para colocar o agente do B2C Finance no Telegram, numa instância real do n8n. Vale para quem for fazer a implantação (pessoa ou agente de código).

- **O que já está pronto no repositório:** a API, a tela de vínculos e os workflows exportados com `active: false`. A publicação real de cada workflow deve ser conferida no n8n; o estado do JSON não indica o estado da instância.
- **Referência técnica** (como cada parte funciona): [`docs/TELEGRAM.md`](TELEGRAM.md).
- **Checklist de release:** [`docs/AI_AGENT_RELEASE_CHECKLIST.md`](AI_AGENT_RELEASE_CHECKLIST.md), seção Telegram.

```
Telegram ─┐
          ├→ n8n (orquestra) → Agente IA → API B2C Finance (dados, identidade, permissão)
WhatsApp ─┘                         └→ Qdrant (conhecimento, nunca dado atual)
```

**Regras que valem em todos os passos:**

- **Nenhum token em arquivo, workflow, variável ou chat.** Token do bot, token da API B2C e chave do Qdrant vão só nas **credenciais** do n8n.
- **O n8n nunca acessa banco, Supabase ou Prisma.** Tudo passa pela API `/api/v1`.
- **Um bot = um webhook.** Só um agente de Telegram (somente leitura **ou** com escrita) pode estar ativo por bot. Os relatórios não usam webhook e podem ficar ativos junto.

## Ordem de implantação

| # | Passo | Seção |
|---|---|---|
| 1 | Criar o bot no Telegram | [1](#1-criar-o-bot) |
| 2 | Criar a credencial "Telegram Bot" no n8n | [2.1](#21-credenciais) |
| 3 | Criar/validar a integração (Service Account) no B2C Finance | [3.1](#31-integração-service-account) |
| 4 | Criar a credencial "B2C Finance API" | [2.1](#21-credenciais) |
| 5 | Configurar o Qdrant e indexar a base | [4](#4-qdrant-base-de-conhecimento) |
| 6 | Descobrir e vincular o Telegram User ID | [3.2](#32-descobrir-e-vincular-o-telegram-user-id) |
| 7 | Importar `telegram-connection-test.json` | [5](#5-teste-de-conexão) |
| 8 | Executar o teste | [5](#5-teste-de-conexão) |
| 9 | Importar o agente somente leitura | [6](#6-agente-somente-leitura-primeiro) |
| 10 | Testar manualmente | [6](#6-agente-somente-leitura-primeiro) |
| 11 | Ativar o somente leitura | [6](#6-agente-somente-leitura-primeiro) |
| 12 | Testar os relatórios | [7](#7-relatórios-diários) |
| 13 | Ativar os relatórios | [7](#7-relatórios-diários) |
| 14 | Importar o agente com escrita | [8](#8-agente-com-escrita-substitui-o-somente-leitura) |
| 15 | Validar estrutura, credenciais e fluxos simulados com o agente ainda desativado | [8](#8-agente-com-escrita-substitui-o-somente-leitura) |
| 16 | Desativar o somente leitura e ativar o agente com escrita | [8](#8-agente-com-escrita-substitui-o-somente-leitura) |
| 17 | Testar a escrita controlada ponta a ponta e verificar a trilha | [8](#8-agente-com-escrita-substitui-o-somente-leitura) |
| 18 | Manter o somente leitura importado e desativado, para rollback | [9](#9-rollback) |

---

## 1. Criar o bot

1. Abra o Telegram e fale com **@BotFather**.
2. Mande `/newbot`.
3. Defina o **nome** (aparece nas conversas, ex.: "B2C Finance").
4. Defina o **username** do bot: único, terminando em `bot` (ex.: `b2c_finance_bot`).
5. O BotFather responde com o **Bot Token**.
6. **Copie o token direto para a credencial do n8n** (passo 2.1). Não cole em chat, e-mail, documento, variável de ambiente nem repositório.
7. Se o token vazar: no BotFather, `/revoke` gera outro; atualize a credencial.

Opcional, no BotFather: `/setdescription` e `/setcommands` com `start`, `help` e `status`.

**Grupos:** o agente só atende em conversa privada. Se quiser impedir que o bot seja adicionado a grupos, use `/setjoingroups` → Disable.

## 2. n8n

### 2.1 Credenciais

Crie as quatro credenciais do agente somente leitura e a quinta credencial exclusiva do agente com escrita **com estes nomes exatos**. Os workflows referenciam as credenciais pelo nome, com ids placeholder (`CONFIGURAR_…`), então nenhum id de outra instância impede a importação.

| Nome da credencial | Tipo no n8n | O que preencher |
|---|---|---|
| `Telegram Bot` | Telegram API | **Access Token** = o Bot Token. Base URL: deixe o padrão (`https://api.telegram.org`). |
| `B2C Finance API` | Header Auth | **Name** = `Authorization`; **Value** = `Bearer ` + o token da integração (passo 3.1). |
| `B2C Finance API — escrita Telegram` | Header Auth | Mesmo cabeçalho, mas com token de uma integração **separada** com os scopes de leitura, integração e escrita. Vincule apenas ao agente com escrita. Preserve `B2C Finance API` para o fallback somente leitura. |
| `OpenAI` | OpenAI | A chave do provedor do modelo. |
| `Qdrant (conhecimento)` | Qdrant API | **URL** e **API Key** do Qdrant do passo 4. |

Depois de salvar a credencial "Telegram Bot", use **Test** no próprio formulário: o n8n chama `getMe` e confirma o token.

### 2.2 Variáveis de ambiente

As variáveis estão em [`integrations/n8n/ENV.example`](../integrations/n8n/ENV.example). Nenhuma delas é segredo.

| Variável | Para quê |
|---|---|
| `B2C_FINANCE_API_URL` | `https://b2-c-finance.vercel.app/api/v1` (sem barra no fim) |
| `QDRANT_URL` | URL do Qdrant (usada na indexação e no teste de conexão) |
| `TELEGRAM_TEST_USER_ID` | Seu Telegram User ID, só para o teste de conexão |
| `TELEGRAM_MORNING_REPORT_CRON` / `TELEGRAM_EVENING_REPORT_CRON` | Horário dos relatórios (padrão 07:00 seg–sáb; 19:00 seg–sex) |
| `TELEGRAM_MAX_UPDATES_POR_MINUTO` | Anti-flood por pessoa (padrão 20) |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | Obrigatória: os workflows leem `$env` |

`TELEGRAM_BOT_TOKEN`, `B2C_FINANCE_API_TOKEN` e `QDRANT_API_KEY` aparecem no `ENV.example` **só como referência de nome**. Não defina como variável: os valores vão nas credenciais.

### 2.3 Importar um workflow (vale para todos)

1. n8n → **Workflows → Import from File** → escolha o JSON em `integrations/n8n/workflows/`.
2. O workflow chega **desativado**. Não ative ainda.
3. Abra cada nó com ícone de credencial:
   - se o n8n já ligou a credencial pelo nome, confira;
   - se aparecer "credencial não encontrada", selecione na lista a credencial do nome indicado (tabela 2.1).
4. **Save.**
5. Confira em **Settings → Timezone**: `America/Bahia`.

## 3. B2C Finance

### 3.1 Integração (Service Account)

Configurações → Integrações → **API** → Nova integração.

- **Scopes de leitura:** `clients.read`, `client_status.read`, `receivables.read`, `expenses.read`, `cash.read`, `upsells.read`, `dashboard.read`, `routine.read`, `reports.read`.
- **Integração:** `identities.resolve`, `knowledge.read`.
- **Escrita (só para o agente com escrita):** `agent_actions.manage`, `clients.create`, `clients.update`, `client_status.write`, `receivables.register_payment`, `receivables.remove_from_month`, `expenses.create`, `expenses.update`, `expenses.pay`, `upsells.create`, `upsells.update`, `routine.write`.
- O token aparece **uma vez**: copie direto para a credencial "B2C Finance API".
- **Como validar:** o teste de conexão (passo 5) chama `/health` e `/me` e diz se falta algum scope.

**Permissão efetiva de cada pessoa = RBAC dela ∩ scopes da integração.** A integração nunca dá a alguém mais do que o perfil dele permite no B2C Finance, e o perfil nunca passa do que a integração tem. Referência por perfil:

| Perfil | Caixa | Recebimentos | Registrar pagamento | Despesas (ver / editar) | Cadastrar cliente | Upsell | Relatórios | Ações com confirmação |
|---|---|---|---|---|---|---|---|---|
| Administrador, Gestor | ✓ | ✓ | ✓ | ✓ / ✓ | ✓ | ✓ | ✓ | ✓ |
| Financeiro | ✓ | ✓ | ✓ | ✓ / ✓ | — | — | ✓ | ✓ |
| Administrativo | — | ✓ | — | — / — | ✓ | — | — | ✓ |
| Comercial | — | — | — | — / — | ✓ | ✓ | — | ✓ |
| Cobrança | — | ✓ | ✓ | — / — | — | — | — | ✓ |
| Contador | — | — | — | — / — | — | — | ✓ | — |
| Leitura | — | — | — | — / — | — | — | — | — |

Os ajustes individuais da matriz de permissões (Configurações → Usuários) valem também no Telegram.

### 3.2 Descobrir e vincular o Telegram User ID

A identidade é o **Telegram User ID** (um número, ex.: `123456789`). O @username não serve: ele muda e pode passar para outra pessoa.

**Descobrir o ID de cada pessoa:**

- **Com o agente já ativo:** a pessoa manda `/start` ao bot. Sem vínculo, o bot mostra o ID dela e **nenhum dado**.
- **Antes de ativar qualquer agente:** ative o agente somente leitura só para isso (sem vínculo ele não entrega dado nenhum) ou use um bot de ID confiável (ex.: @userinfobot).

**Vincular:** Configurações → Integrações → **Canais** → Vincular canal → Telegram, o ID, o usuário (username opcional, só para reconhecer na lista). Só o administrador vincula.

**Relatórios:** no mesmo vínculo, **Envios** → marque "Relatório da manhã" e/ou "Relatório da noite". Padrão: nada. Quem não pode ver relatórios no B2C Finance não recebe, mesmo marcado.

## 4. Qdrant (base de conhecimento)

1. Use um Qdrant **dedicado** (Cloud ou junto ao n8n). Nunca o banco do B2C Finance nem o Supabase.
2. Credencial "Qdrant (conhecimento)" (URL + API Key) e a variável `QDRANT_URL`.
3. Importe `knowledge-ingest.json`, ligue as credenciais e execute. Confira se `gravados` = `trechosNoPacote`.
4. Rode de novo sempre que a versão do pacote mudar (ver `integrations/n8n/CHANGELOG.md`).

**Se o Qdrant cair:** perguntas de dados continuam funcionando pela API; perguntas de conceito recebem o aviso de base indisponível. O agente não inventa resposta.

## 5. Teste de conexão

1. Importe `telegram-connection-test.json` (credenciais: Telegram Bot, B2C Finance API, Qdrant).
2. Defina `TELEGRAM_TEST_USER_ID` com o seu ID, já vinculado (passo 3.2).
3. **Execute workflow.** Chega no seu Telegram:

   ```
   Teste de conexão — B2C Finance
   Telegram: OK
   B2C API: OK
   Service Account: OK
   Identity: OK
   Qdrant: OK — N trechos
   Agent dependencies: OK
   Ações com confirmação: OK
   ```

4. **Se algo falhar:**
   - "Ações com confirmação: indisponíveis" → faltam os scopes de escrita (necessários só no passo 8);
   - "Identity: FALHOU" → o ID não está vinculado ou está errado;
   - "Qdrant: coleção vazia" → rode a indexação;
   - nada chega no Telegram → o token da credencial "Telegram Bot" está errado.

## 6. Agente somente leitura (primeiro)

1. Importe `b2c-finance-telegram-agent-readonly.json`. Credenciais: Telegram Bot, B2C Finance API, OpenAI, Qdrant.
2. **Ative.** O gatilho do Telegram só recebe mensagens com o workflow ativo, então o teste manual é feito logo depois de ativar, com as pessoas já vinculadas.
3. **Webhook:** A ativação registra o webhook no Telegram com um `secret_token`: update sem o segredo é recusado com 403.
4. **No privado com o bot:**
   - `/start`, `/help`, `/status`;
   - "Quanto recebemos hoje?", "Qual nosso MRR?", "Explique MRR e TCV.";
   - "Liste os clientes inadimplentes": a primeira página traz até 10 clientes, a data da posição, o total de clientes, cobranças e valor, **iguais aos da tela Inadimplência**. Se houver mais, toque em **Ver mais** até a última página; cada clique consulta a API novamente com o vínculo e as permissões atuais, e nenhuma página é apresentada como lista completa antes do fim;
   - um nome de cliente ambíguo (o agente deve perguntar qual);
   - uma mensagem num grupo com o bot (só a orientação de usar o privado);
   - `/start` de alguém sem vínculo (só o ID, nenhum dado).
5. Confira em Configurações → Integrações → **Atividades**: as consultas com origem **Telegram** e o nome da pessoa.

## 7. Relatórios diários

1. Marque os destinatários em **Canais → Envios** (passo 3.2).
2. Importe `telegram-daily-morning-report.json` e `telegram-daily-evening-report.json`. Credenciais: B2C Finance API, OpenAI, Telegram Bot.
3. Rode **"Executar agora (teste)"** em cada um e confira no Telegram.
   - Cada pessoa recebe o relatório com as permissões **dela**.
   - Se a API não confirmar que respondeu em nome da pessoa, vai só um aviso, sem dado.
4. Ative os dois. O horário vem de `TELEGRAM_*_REPORT_CRON`, no fuso do workflow.

## 8. Agente com escrita (substitui o somente leitura)

1. Crie uma **nova** integração para o agente com escrita, com os 11 scopes de leitura/integração e os 12 scopes de escrita (incluindo `receivables.remove_from_month`). Mantenha a integração somente leitura inalterada. Copie o token diretamente para a credencial `B2C Finance API — escrita Telegram` no n8n; não o salve no repositório nem no chat. Execute uma **cópia** do teste de conexão apontada para essa credencial: "Ações com confirmação: OK". Preserve o teste e a credencial do agente somente leitura.
2. Importe `b2c-finance-telegram-agent.json` como **novo workflow desativado**. Ligue a credencial nova em todos os nós HTTP da API; Telegram Bot, OpenAI e Qdrant podem usar as credenciais existentes. Confira que nenhum nó HTTP do agente completo usa a credencial somente leitura. Salve sem publicar.
3. Valide o grafo e as permissões com entradas simuladas antes da troca: consultas, `Ver mais`, prévia, cancelamento, confirmação duplicada, acesso negado e falha da API. O bot real só entrega updates ao workflow cujo webhook está ativo; `Test workflow` no agente desativado não prova o caminho Telegram ponta a ponta enquanto o bot usa o webhook do somente leitura.
4. **Troca controlada:** registre o ID e a versão dos dois workflows. Desative o somente leitura e, em seguida, publique/ative o com escrita. A ativação registra o webhook dele (mensagens **e** botões) no lugar do anterior. Deixe pronto o rollback da seção 9.
5. **Teste logo após ativar**, com registros explicitamente marcados como teste:
   - "A <cliente de teste> pagou <valor> hoje." → prévia com **[Confirmar] [Cancelar]**; confira que nada foi gravado;
   - **Cancelar** → "Cancelado. Nada foi alterado.";
   - peça de novo → **Confirmar** → resultado real na própria mensagem, sem os botões;
   - toque em Confirmar outra vez → "Essa ação já foi processada." (idempotência);
   - "Deixe <cliente de teste> inativo a partir do mês que vem" → o mês atual continua Ativo;
   - "Crie uma oportunidade de Google Ads de R$ 800 para <cliente de teste>";
   - "Registre uma despesa de R$ 350 do Canva" (o agente pergunta o que faltar);
   - "Exclua <cliente>" → recusa, sem prévia;
   - um usuário de perfil restrito pedindo o caixa → "Você não possui permissão…".
6. Confira em **Atividades**: `agent_actions.propose`, `agent_actions.confirm` e a escrita (ex.: `payments.register`) com origem Telegram e o nome da pessoa.
7. Se algo sair errado, faça o rollback (seção 9).

**Cenário isolado quando não há dados de teste:** use uma instância de homologação separada, se disponível. Uma etiqueta `TESTE` em cliente/cobrança da produção **não** isola métricas, inadimplência, relatórios ou auditoria. Sem homologação, valide no ambiente real primeiro somente leitura, prévia e cancelamento (sem confirmar); crie um cliente/cobrança sintéticos em produção e confirme uma transação apenas depois de revisar explicitamente o impacto, o modo de desfazer e a trilha que permanecerá. Não use cliente ou cobrança reais como substitutos de teste.

**Roteiro mínimo sem homologação:** peça pelo bot a proposta de cadastrar `TESTE AGENTE TELEGRAM 2026-09-29` como **prospecção**, sem CPF/CNPJ, contato, contrato, valor ou cobrança, com nota `Registro sintético para validar o agente Telegram; não é cliente real`. Revise a prévia e toque primeiro em **Cancelar**: o nome não deve aparecer na carteira e a atividade deve registrar somente proposta e cancelamento. Uma segunda proposta pode testar o botão **Confirmar**, mas isso cria um registro na produção e exige revisão explícita antes do toque; depois confira o cliente e a idempotência. Testes de pagamento, despesa paga ou cobrança dependem de uma cobrança/conta sintética própria e de revisão separada, pois alteram os números financeiros e deixam trilha de auditoria.

## 9. Rollback

| Situação | O que fazer | Efeito |
|---|---|---|
| Agente com escrita com problema | Desative `b2c-finance-telegram-agent.json`; ative `b2c-finance-telegram-agent-readonly.json` | O webhook volta para o somente leitura na hora |
| Relatório com problema | Desative o workflow do relatório | Nada mais é enviado |
| Integração comprometida ou token vazado | Configurações → Integrações → **Revogar** a integração; crie outra e troque a credencial | Toda chamada com o token antigo passa a dar 401 na hora |
| Bot Token vazado | @BotFather → `/revoke`; atualize a credencial "Telegram Bot" | O token antigo para de funcionar |
| Pessoa não deve mais usar o bot | Configurações → Integrações → Canais → **Desvincular** | Corte imediato; o histórico fica |
| Parar tudo | Desative todos os workflows de Telegram | O bot para de responder |

Mantenha o somente leitura **importado e desativado** como fallback.

## 9b. Atualizar um workflow que JÁ está publicado (n8n 2.x)

**Não use "Import from File" nem `n8n import:workflow` num workflow publicado.**
- O JSON do repositório não tem o ID nem as credenciais da sua instância; importá-lo cria um **workflow duplicado**.
- No n8n 2.x, importar por cima de um ID existente **despublica** o workflow.

O caminho seguro é a API pública, validado num n8n 2.39.7:

1. **Backup:** `GET /api/v1/workflows/<id>` → salve o JSON **fora do repositório**. Ele tem o ID, as credenciais (id e nome, nunca o segredo), os settings e `activeVersionId`, que é a versão para voltar.
2. **Merge:**

   ```
   node integrations/n8n/scripts/preparar-atualizacao-workflow.mjs --id <id> --atual <backup> --novo <json do repo> --saida <pasta fora do repo>
   ```

   - Gera `corpo-put.json` e `relatorio.md`, preservando ID, nome, settings, ids de nó, `webhookId`, posições e credenciais.
   - Mantém customizações da instância em nós que o repositório não mudou.
   - **Para em conflito:** se um nó foi customizado na instância e também mudou no repositório, exige `--resolver "<nó>=novo|atual"`.
3. **Rascunho:** `PUT /api/v1/workflows/<id>?publishIfActive=false` com o corpo. **Sem `publishIfActive=false`, o n8n 2.x republica na hora.** A versão publicada continua no ar; a resposta traz o `versionId` novo.
4. **Revisão** no editor (histórico de versões).
5. **Publicar:** `POST /api/v1/workflows/<id>/publish` com `{"versionId": "<novo>"}`, ou "Publish" no editor. O webhook do Telegram é re-registrado com a mesma URL e o mesmo segredo.
6. **Voltar:** `POST /api/v1/workflows/<id>/publish` com `{"versionId": "<activeVersionId do backup>"}`.

**API key do n8n:** crie uma só para isso, com `workflow:read`, `workflow:update` e `workflow:activate`. Guarde-a numa variável do seu terminal, nunca em arquivo nem em chat, e revogue ao terminar.

## 10. Segurança: o que já está garantido

- **Identidade:** só pelo `from.id` (quem escreveu ou tocou no botão), resolvido pela API. Username, nome e título do chat nunca identificam ninguém.
- **Só chat privado:** grupo e supergrupo recebem só a orientação de usar o privado; canal, bot e remetente anônimo são ignorados. Nada chega à API nem à IA.
- **Botões sem IDOR:** o botão leva só `confirm:<id>`. A API mostra e executa a ação só para o usuário e o vínculo que a criaram, no mesmo workspace.
  - Outra pessoa: 404 (a ação "não existe" para ela).
  - Outro workspace: 404 ou 403.
  - Id adulterado: 400.
- **Uma escrita só:** a Idempotency-Key é `telegram:<update_id>:<id>`; a ação muda de estado dentro de transação e o pagamento tem trava no banco. Dois toques juntos, o mesmo update repetido e dois pagamentos simultâneos geram uma escrita.
- **Anti-abuso:**
  - por pessoa no n8n: 20 mensagens/min, antes da API e da IA;
  - por usuário na API: 20 propostas e 30 confirmações/cancelamentos por minuto (429 com `Retry-After`);
  - por IP na API: 120/min.
  - **Limitação:** o contador do n8n fica no static data do workflow, que não é atômico entre execuções simultâneas. Ele corta flood contínuo e laço de automação (testado: 20 respostas, 1 aviso, o resto descartado), mas uma rajada de mensagens chegando **ao mesmo tempo** pode passar. As escritas continuam protegidas pelo limite da API, que é contado no banco.
- **API fora do ar:** a pessoa recebe "Não consegui acessar os dados do B2C Finance neste momento. Tente novamente em alguns minutos."; a execução fica registrada como erro no n8n; nada é inventado a partir da base de conhecimento.
- **Logs:** a trilha guarda update, usuário, ação, resultado, requestId e correlationId, e o Telegram User ID só mascarado. Nunca token, chave, senha ou payload financeiro completo.
  - As execuções de sucesso não são salvas no n8n (`saveDataSuccessExecution: none`); as de erro são, para diagnóstico.
- **Segredos:** `npm run n8n:check` barra token de bot, token da API, chaves (OpenAI, Anthropic, Qdrant), Bearer, JWT, CRON_SECRET e senhas em `integrations/n8n`, `docs/` e `.env*.example`. Roda no CI.

## 11. Banco de dados (migrations da Fase 16)

Todas **aditivas**: nada é apagado nem reescrito.

| Migration | SQL |
|---|---|
| `20260929090000_messaging_identity_telegram` | valor `TELEGRAM` no enum `MessagingChannel`; coluna `metadata JSONB` (só exibição); CHECK que exige Telegram User ID numérico nas linhas `TELEGRAM` |
| `20260929091000_activity_source_telegram` | valor `TELEGRAM` no enum `ActivitySource` |
| `20260929100000_messaging_identity_preferences` | `receiveMorningReport` e `receiveEveningReport` (`BOOLEAN NOT NULL DEFAULT false`) e `notificationEvents` (`TEXT[] NOT NULL DEFAULT {}`) |

O build da Vercel roda `prisma migrate deploy`, então as três já foram aplicadas em produção nos deploys dos blocos 1 e 2. Não há migration nova no bloco 3.
