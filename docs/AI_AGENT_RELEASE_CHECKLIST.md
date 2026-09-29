# Checklist de release — API + n8n + Agente IA

Auditoria final de 28/09/2026. Serve para:

- **conferir o que foi testado** e onde está a prova (§1);
- **ativar em produção** passo a passo (§3);
- **repetir a verificação** a cada release.

Marque cada item ao executar.

---

## 1. Matriz de verificação (automatizada)

Todos os testes rodam em `npm run test`, contra o banco de testes, nunca contra produção.

### AUTH

| Item | Prova |
|---|---|
| Token inválido (ausente, malformado, segredo errado, prefixo inexistente) → 401 | `api-autenticacao`: "token inválido…" |
| Token expirado → 401 `expired_token` | `api-autenticacao`: "token expirado" |
| Token revogado → 401 `revoked_token`, na hora | `api-autenticacao`: "token revogado" |
| Token de outro dono → 404 em detalhe, escrita, pagamento e status; lista vazia; confirmação de ação com vínculo alheio → 403 `invalid_identity` | `auditoria-final-api-agente`: "token de outro dono…"; `api-autenticacao`: "isolamento por dono" |
| Scope ausente → 403 `insufficient_scope`, sem executar | `api-autenticacao`, `api-v1-leitura`, `api-v1-escrita` |
| Cookie de sessão não autentica a API | `api-autenticacao` |

### RBAC (usuário do WhatsApp)

| Perfil | Esperado | Prova |
|---|---|---|
| Sem permissão (LEITURA) | Lê clientes; recebimentos → 403 `user_forbidden`; não propõe escrita | `api-identidade-whatsapp`, `api-agente-acoes` |
| ADMIN | Todos os scopes delegáveis; nunca `identities.resolve`/`knowledge.read` (são da máquina) | `auditoria-final-api-agente` |
| Financeiro | Lê e registra pagamento; não cadastra cliente nem edita upsell | `api-identidade-whatsapp`, `auditoria-final-api-agente` |
| Comercial | Clientes e upsell; recebimentos e pagamento → 403 `user_forbidden` | `auditoria-final-api-agente` |
| Permissão revogada entre a prévia e o SIM | Execução recusada | `api-agente-acoes` |
| Restrito a agência | 403 `agency_scope_not_supported` | `api-identidade-whatsapp` |

### OWNER ID

- **Tudo roda no dono da integração.** `ownerId` no corpo → 400; id de outro dono → 404; a chave de idempotência é por conta. Provas: `api-v1-escrita`, `api-idempotencia-auditoria`, `auditoria-final-api-agente`.

### API

| Item | Prova |
|---|---|
| Validação Zod estrita (campo desconhecido = 400 com os campos) | `api-v1-leitura`: "parâmetro desconhecido…" |
| Paginação (`page`, `pageSize`, `meta.pagination`) | `api-v1-leitura`: "lista paginada…" |
| Filtros (status, modalidade, responsável, segmento, inadimplência, janela, categoria) | `api-v1-leitura` |
| Erro padronizado `{ success:false, error:{code,message}, meta:{requestId} }`, sem stack | `api-v1-leitura`: "erro interno não expõe…" |
| `requestId` em toda resposta (e header `x-request-id`) | `api-v1-leitura`: "sucesso: success/data/meta…" |
| OpenAPI válida e sem rota fora dela | `api-openapi`, `npm run openapi:lint` |

### Idempotência

| Item | Prova |
|---|---|
| Pagamento duplicado (replay, concorrência, mesmo valor/data) | `api-idempotencia-auditoria`, `api-v1-escrita` |
| Cliente duplicado por replay | `api-v1-escrita`, `api-idempotencia-auditoria` |
| Despesa duplicada por replay | `auditoria-final-api-agente` |
| Upsell duplicado (replay; mesma chave com outro corpo → 422) | `auditoria-final-api-agente` |
| Confirmação do agente repetida (mesma mensagem) → mesmo resultado; outro SIM → 409 | `api-agente-acoes` |

### Status temporal

- **Mudança futura** fica programada sem mudar hoje; retroativa exige confirmação: `api-v1-escrita`.
- **Histórico preservado,** com intervalos de vigência: `api-v1-leitura`.
- **Setembro não muda ao alterar Outubro:** `api-v1-leitura` ("a competência anterior mostra Ativo; a atual, Inativo"), mais as suítes de status temporal.

### Auditoria (trilha)

- **Leitura sensível** (detalhe com documento completo), pagamento, status, despesa e upsell ficam em `ApiActivity`, com ator, entidade e resultado, sem token. O AuditLog guarda o campo a campo. Prova: `auditoria-final-api-agente`, "trilha de auditoria…".
- **Segredos higienizados; retenção 30/400 dias:** `api-idempotencia-auditoria`.

### Agente

| Item | Prova |
|---|---|
| Busca de cliente / ambíguo ("Alpha" devolve os dois) | `auditoria-final-api-agente`; E2E n8n |
| Tentativa de escrita → prévia da API, nada gravado | `api-agente-acoes`; E2E |
| Confirmação (`SIM <código>`), código errado, "sim" sem código, validade, estado mudou | `api-agente-acoes`; `integracao-n8n`; E2E |
| Cancelamento (`NÃO`) | `api-agente-acoes`; E2E |
| Ação bloqueada → 403 `operation_blocked` (8 operações) | `api-agente-acoes` |
| Recusa da API chega à IA com código e mensagem | `integracao-n8n` ("…neverError"); E2E |
| Prompt com os 10 princípios; RAG só para conceitos | `integracao-n8n` |

### n8n

| Item | Prova |
|---|---|
| Workflows importam sem erro | `npm run n8n:validate` (definições reais do n8n); import pela CLI no E2E |
| Credenciais nunca hardcoded (só placeholders `CONFIGURAR_*`) | `npm run n8n:check`; `integracao-n8n` |
| Nós nomeados (nenhum nome padrão do n8n) e com nota | `integracao-n8n` ("auditoria dos workflows") |
| Toda variável `$env` documentada em `ENV.example` | `integracao-n8n` |
| Todos chegam desativados | `integracao-n8n` |

### WhatsApp

- **Número vinculado** é atendido; **não vinculado** recebe resposta genérica, sem dado e sem chamar a IA: `api-identidade-whatsapp`; E2E.
- **Assinatura inválida ou ausente** → descartado: `integracao-n8n`; E2E.
- **Webhook duplicado** (mesmo `messageId`) → uma resposta só: E2E.

### Webhook B2C

| Item | Prova |
|---|---|
| Entrada: assinatura válida / inválida / ausente | `avancecrm-webhook`, `gateway-pix` |
| Entrada: reenvio (mesmo evento) = um registro, inclusive simultâneo | `avancecrm-webhook`, `gateway-pix` |
| Saída: assinatura HMAC conferida pelo destino | `auditoria-webhook-saida` |
| Saída: retry com recuo exponencial e dead-letter | `outbox`, `auditoria-webhook-saida` |
| Saída: destino indisponível (porta fechada) e destino que não responde (timeout) | `auditoria-webhook-saida` |

## 2. Comandos da release

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run test` (antes, `npm run db:test:setup` se o banco de testes for novo)
- [ ] `npm run build:ci` (não roda migration)
- [ ] `npm run openapi:lint`
- [ ] `npm run n8n:check`
- [ ] `N8N_MODULES=<node_modules do n8n> npm run n8n:validate`

**Atenção:** o deploy na Vercel roda `npm run build`, que inclui **`prisma migrate deploy`**. Toda migration versionada é aplicada em produção no deploy. As deste ciclo são aditivas; confira sempre o SQL antes de dar push.

## 3. Ativação em produção (passo a passo)

### 3.1 B2C Finance

- [ ] Deploy da `main` concluído na Vercel (`b2-c-finance.vercel.app`).
- [ ] Em Configurações → Integrações → **API**, crie a integração do n8n com os scopes:
  - **leitura:** `clients.read`, `client_status.read`, `receivables.read`, `expenses.read`, `cash.read`, `upsells.read`, `dashboard.read`, `routine.read`, `reports.read`;
  - **integração:** `identities.resolve`, `knowledge.read`;
  - **escrita, só se o agente com escrita for usado:** `agent_actions.manage`, `clients.create`, `clients.update`, `client_status.write`, `receivables.register_payment`, `expenses.create`, `expenses.update`, `expenses.pay`, `upsells.create`, `upsells.update`, `routine.write`.
- [ ] Copie o token (aparece uma vez) direto para a credencial do n8n. Nunca em arquivo, chat ou workflow.
- [ ] Em Configurações → Integrações → **Canais**, vincule o Telegram User ID (ou o número do WhatsApp) de cada pessoa ao usuário dela.
- [ ] Em **Canais → Envios**, marque quem recebe o relatório da manhã e o da noite (padrão: ninguém).
- [ ] Opcional: `B2C_PENDING_ACTION_TTL_MINUTES` na Vercel (padrão 10).

### 3.2 Base de conhecimento (Qdrant)

- [ ] Qdrant dedicado (Cloud ou junto ao n8n). **Nunca** o banco do B2C Finance nem o Supabase.
- [ ] Credencial n8n "Qdrant (conhecimento)" e variável `QDRANT_URL`.
- [ ] Importar `knowledge-ingest.json`, ligar as credenciais e rodar "Reindexar agora". Confira se `gravados` é igual a `trechosNoPacote`.

### 3.3 n8n

- [ ] Variáveis do `integrations/n8n/ENV.example`, com `NODE_FUNCTION_ALLOW_BUILTIN=crypto` e `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
- [ ] Credenciais: "B2C Finance API" (Header Auth, `Authorization: Bearer <token>`), "WhatsApp API", "OpenAI" e "Qdrant (conhecimento)".
- [ ] Importar `sistema.teste-conexao.v1.json` e executar. Devem vir `ok`, `okParaEscrita` (se for usar escrita) e `okParaConhecimento`.
- [ ] Importar **um** agente:
  - `b2c-finance-ai-agent.json` (webhook `/webhook/b2c-finance-ai-agent-v2`); ou
  - `b2c-finance-ai-agent-readonly.json` (`/webhook/b2c-finance-ai-agent`).
- [ ] Teste manual **antes de ativar**, com um número vinculado:
  1. pergunta de consulta ("quanto a <cliente> deve?");
  2. conceito ("o TCV é rateado?");
  3. pedido de pagamento de uma cobrança de teste → prévia → `sim` (deve pedir o código) → `SIM 0000` (código errado) → `SIM <código>`;
  4. `NÃO` numa segunda proposta.
- [ ] Conferir em Configurações → Integrações → Atividades: as leituras, `agent_actions.*` e `payments.register` com o nome da pessoa como ator.
- [ ] Ativar o agente escolhido no n8n.

### 3.3b Telegram (canal principal)

Passo a passo e ordem de implantação: [`docs/TELEGRAM_INTEGRATION.md`](TELEGRAM_INTEGRATION.md). Um bot aceita um só webhook: nunca deixe o somente leitura e o com escrita ativos ao mesmo tempo no mesmo bot.

- [ ] Bot criado no BotFather
- [ ] Token armazenado somente no n8n (credencial "Telegram Bot")
- [ ] Credential Telegram configurada e testada (Test → getMe)
- [ ] Service Account B2C criada
- [ ] Scopes revisados (leitura + `identities.resolve` + `knowledge.read`; escrita só para o agente com escrita)
- [ ] API B2C acessível
- [ ] `/health` funcionando
- [ ] `/me` funcionando
- [ ] Telegram User ID descoberto
- [ ] Telegram User ID vinculado ao usuário B2C (Integrações → Canais)
- [ ] Qdrant configurado
- [ ] Knowledge indexado (`gravados` = `trechosNoPacote`)
- [ ] Connection test passou
- [ ] readonly importado
- [ ] readonly testado
- [ ] "Liste os clientes inadimplentes" bate com a tela Inadimplência (clientes e valor, mesma data)
- [ ] readonly ativado
- [ ] Destinatários marcados em Canais → Envios
- [ ] morning report testado
- [ ] evening report testado
- [ ] write agent importado
- [ ] write agent testado
- [ ] confirmação testada
- [ ] cancelamento testado
- [ ] idempotência testada (Confirmar de novo → "Essa ação já foi processada.")
- [ ] ação bloqueada testada
- [ ] write agent ativado (readonly desativado antes)
- [ ] readonly mantido como fallback (importado e desativado)

### 3.4 Meta (WhatsApp Cloud API — opcional)

- [ ] URL de callback = o webhook do agente escolhido; verify token = `WHATSAPP_VERIFY_TOKEN`.
- [ ] App Secret em `WHATSAPP_WEBHOOK_SECRET` (valida `X-Hub-Signature-256`).
- [ ] Assinar o campo `messages`.

### 3.5 Relatórios diários (opcional)

- [ ] `B2C_REPORT_RECIPIENTS` e os crons. Importe `daily-morning-report.json` / `daily-evening-report.json`, rode "Executar agora (teste)" e só então ative.

## 4. Voltar atrás

- **Rollback completo do Telegram:** [`docs/TELEGRAM_INTEGRATION.md`](TELEGRAM_INTEGRATION.md) §9.
- **Agente com problema:** desative-o no n8n e ative o somente leitura do mesmo canal (`b2c-finance-telegram-agent-readonly.json` ou `b2c-finance-ai-agent-readonly.json`).
- **Integração comprometida:** revogue o token em Configurações → Integrações. O efeito é imediato e toda chamada passa a dar 401.
- **Número ou Telegram indevido:** desvincule em Configurações → Integrações → Canais. O corte é imediato.
