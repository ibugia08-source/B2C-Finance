# Agente com escrita controlada (WhatsApp e Telegram)

> **Telegram (canal principal):** o mesmo mecanismo, com confirmação por botão — ver a seção 10 e `docs/TELEGRAM.md`. O WhatsApp continua disponível como canal opcional.

Workflow do WhatsApp: `integrations/n8n/workflows/b2c-finance-ai-agent.json`. O agente somente leitura (`b2c-finance-ai-agent-readonly.json`) continua no repositório, sem mudança, como referência e alternativa de volta.

O agente **consulta** direto e **propõe** escritas. Nada é gravado no B2C Finance até o próprio usuário responder **`SIM <código>`**. Toda escrita passa pela API, pela mesma rota e pelo mesmo RBAC da API pública. O agente nunca acessa banco, Supabase ou Prisma.

## 1. Classificação de risco

A fonte é `src/lib/api/agent/catalog.ts`, espelhada em `integrations/n8n/schemas/agent-write-tools.json`. Um teste confere que as duas não divergem.

| Risco | O que acontece | Ferramentas / operações |
|---|---|---|
| **READ** | Executa direto (GET). | `buscar_clientes`, `consultar_*`, `gerar_relatorio_*` |
| **WRITE_CONFIRMATION** | A ferramenta só **propõe**: a API monta a prévia e guarda a ação; só o `SIM <código>` do usuário executa. | `cadastrar_cliente`, `editar_cliente`, `alterar_status_cliente`, `registrar_pagamento`, `criar_despesa`, `editar_despesa`, `marcar_despesa_paga`, `criar_upsell`, `atualizar_upsell`, `concluir_acao_rotina` |
| **BLOCKED** | Nunca pelo agente. A API responde 403 `operation_blocked` mesmo que o pedido chegue. Também são scopes proibidos para integrações. | excluir cliente, excluir recebimento, excluir pagamento, excluir despesa, reabrir competência, alterar permissões, gerenciar usuário, alterar plano de contas |

## 2. Fluxo de escrita

```
Usuário pede ("registra o pagamento da Face Love")
 → agente interpreta
 → resolve as entidades com as ferramentas de consulta (buscar_clientes → consultar_recebimentos)
 → chama registrar_pagamento → POST /agent/pending-actions { operation, targetId, input }
     API: valida o input com o schema da rota de escrita
          confere o scope da operação no RBAC do usuário
          lê o ESTADO ATUAL e monta a prévia
          guarda a PendingAction (código de 4 dígitos, validade de 10 min)
 → workflow envia a PRÉVIA DA API (não a paráfrase da IA)
 → usuário responde "SIM 4821"
 → workflow, SEM IA: acha a ação pendente do usuário e chama
     POST /agent/pending-actions/{id}/confirm, com Idempotency-Key = wa:<mensagem>:<ação>
     API: confere usuário, vínculo, código, validade, permissão e se o estado ainda é o da prévia
          executa o payload GUARDADO pela rota de escrita oficial (com a mesma chave)
          registra o resultado na PendingAction e na trilha
 → WhatsApp recebe o resultado real ("✅ Pagamento registrado — Face Love (R$ 1.500,00).")
```

Exemplo de prévia:

```
Encontrei:

*Face Love Distribuidora*
Recebimento em aberto: R$ 1.500,00
Competência: Setembro/2026
Vencimento: 10/09/2026
Valor do pagamento: R$ 1.500,00
Data de pagamento: hoje (28/09/2026)
Forma: Pix

Deseja registrar?

Responda *SIM 4821* para confirmar ou *NÃO* para cancelar. Vale até 14:39.
```

## 3. PendingAction

Tabela `PendingAction`, criada pela migration aditiva `20260928210000_pending_action`.

| Campo | Para quê |
|---|---|
| `id` (actionId) | A confirmação referencia a ação por ele. |
| `ownerId`, `userId`, `identityId`, `serviceAccountId` | Workspace, pessoa e vínculo de WhatsApp que propôs, e a integração. |
| `channel` | `WHATSAPP`. |
| `operation`, `targetId`, `payload` | O que será executado, exatamente. |
| `preview`, `summary` | Texto mostrado ao usuário; rótulo e valor para a resposta. |
| `stateFingerprint` | Hash do estado lido na prévia. Se na confirmação o estado for outro, nada executa. |
| `confirmationCode`, `failedAttempts` | "SIM 4821"; 5 erros cancelam a ação. |
| `status` | `PENDING` → `EXECUTING` → `EXECUTED` / `FAILED`; ou `CANCELLED`, `EXPIRED`, `SUPERSEDED`. |
| `sourceMessageId`, `confirmationMessageId`, `idempotencyKey` | Mensagem que pediu, mensagem que confirmou, chave usada na execução. |
| `result`, `errorCode`, `expiresAt`, `decidedAt`, `executedAt`, `createdAt` | Resultado e datas. |

Regras que o banco garante:

- Uma ação `PENDING` por usuário e canal (índice único parcial). Uma proposta nova substitui a anterior (`SUPERSEDED`), então "SIM 4821" nunca fica ambíguo.
- O código tem sempre 4 dígitos (check).
- RLS ligado.
- A retenção é de 400 dias, a mesma das escritas da trilha.

## 4. Por que um "sim" solto não basta

A confirmação precisa apontar para uma ação persistida, e o workflow garante isso assim:

- **Mensagem "sim", "pode" ou "ok" sem código:** não confirma nada. O workflow reenvia a prévia e pede *SIM seguido do código*. Se não houver ação pendente, a mensagem segue para o agente como conversa normal.
- **Mensagem "SIM 4821":** o workflow lê na API a ação `PENDING` desse usuário, e a API confere que o código é o **dessa** ação.
- **A confirmação não leva corpo da ação:** executa-se o que foi guardado na prévia, sem troca possível.
- **Estado mudou entre a prévia e o SIM** (alguém pagou pela tela, editou a despesa): a API responde 409 `state_changed` e nada é executado.
- **Mensagem "NÃO" ou "cancelar":** cancela a ação pendente. Nada é executado.

## 5. Permissões: o agente não se dá poder

- **Proposta e execução exigem o scope da operação** nos scopes **efetivos**: conta de serviço ∩ RBAC do usuário do vínculo.
  - Um usuário FINANCEIRO propõe pagamento, mas `cadastrar_cliente` dá 403 `user_forbidden`.
  - A execução confere de novo, então uma permissão revogada entre a prévia e o SIM também dá 403.
- **A rota de escrita executa com o mesmo token e o mesmo vínculo.** Scope, RBAC, validação, regra de domínio, AuditLog, trilha e cache funcionam como numa chamada da API.
- **O `input` segue o schema estrito da rota.** `userId`, `ownerId` ou qualquer campo fora do contrato dá 400. O usuário vem do **vínculo**, nunca da IA.
- **Liberação das ferramentas de escrita no workflow:** exige que a API devolva o scope da operação **e** `agent_actions.manage` em `allowedScopes`.
  - `agent_actions.manage` só é delegado a quem pode escrever algo; um usuário só de leitura continua com o agente somente leitura.
- **Não há ferramenta de confirmação.** A IA não consegue executar uma escrita.

## 6. Idempotência

- **Chave da execução:** `Idempotency-Key = wa:<id da mensagem do WhatsApp que confirmou>:<actionId>`. Caracteres fora de `A-Za-z0-9._-` no id da Meta viram `_`.
- **Quem calcula e quem confere:** o workflow calcula a chave e a API confere que ela é exatamente essa. A mesma chave vai para a rota de escrita.
- **Reenvio da mesma confirmação** (a Meta reenvia, o n8n repete): a resposta é o mesmo resultado, marcado como `replayed`, e nada executa de novo.
- **Outro "SIM 4821" depois de executada:** 409 `action_not_pending`.
- **Pagamento:** grava ainda a identidade externa `api:<conta>:<chave>`. A trava única do banco impede o mesmo pedido de virar dois pagamentos.

## 7. Endpoints (scope `agent_actions.manage` + header `X-B2C-Identity`)

| Método | Rota | O que faz |
|---|---|---|
| POST | `/api/v1/agent/pending-actions` | Propõe: `{ operation, targetId?, input }` → 201 com a prévia, o código e a mensagem pronta. Header opcional `X-B2C-Message-Id`. |
| GET | `/api/v1/agent/pending-actions?status=&sourceMessageId=&limit=` | As ações do usuário do vínculo. |
| GET | `/api/v1/agent/pending-actions/{id}` | A ação, se for do usuário do vínculo (senão 404). Vencida = `EXPIRED`. |
| POST | `/api/v1/agent/pending-actions/{id}/confirm` | `{ messageId, confirmationCode }` (WhatsApp) ou `{ messageId, via: "button" }` (Telegram) + `Idempotency-Key` → 200 (`EXECUTED`/`FAILED`, com `message`). |
| POST | `/api/v1/agent/pending-actions/{id}/cancel` | `{ messageId? }` → 200 (`CANCELLED`). |

**Erros da confirmação:**

| Código | Quando |
|---|---|
| 410 `action_expired` | A ação passou da validade. |
| 409 `action_not_pending` | Já executada, cancelada ou substituída. |
| 422 `confirmation_mismatch` | Código errado; a resposta traz `attemptsLeft`. |
| 409 `state_changed` | O estado mudou desde a prévia. |
| 403 `user_forbidden` | O usuário perdeu a permissão. |
| 400 | Chave errada ou ausente. |

A validade é de 10 minutos, ajustável com `B2C_PENDING_ACTION_TTL_MINUTES` (1 a 60) nas variáveis do B2C Finance, não do n8n.

## 8. Instalação no n8n

1. **Importe** `b2c-finance-ai-agent.json`. O webhook é `/webhook/b2c-finance-ai-agent-v2`; o somente leitura continua em `/webhook/b2c-finance-ai-agent`. Só um deles deve estar ligado ao número da Meta.
2. **Na integração** (Configurações → Integrações), além dos scopes de leitura e de `identities.resolve`, marque:
   - `agent_actions.manage`;
   - os scopes de escrita que o agente pode usar: `clients.create`, `clients.update`, `client_status.write`, `receivables.register_payment`, `receivables.remove_from_month`, `expenses.create`, `expenses.update`, `expenses.pay`, `upsells.create`, `upsells.update`, `routine.write`.

   O teste de conexão mostra `faltandoParaEscrita`.
3. **Credenciais e variáveis** são as mesmas do agente somente leitura (`integrations/n8n/README.md`), mais a credencial "Qdrant (conhecimento)" da base de conhecimento (`docs/AI_AGENT_KNOWLEDGE.md`). O prompt do agente vive em `docs/AI_AGENT_SYSTEM_PROMPT.md`.
4. **Teste antes de ativar** (o workflow chega **desativado**):
   - peça um pagamento de uma cobrança de teste e confira a prévia;
   - responda `sim` (deve pedir o código), `SIM 0000` (código errado) e `SIM <código>`;
   - confira em Configurações → Integrações → Atividades: `agent_actions.propose`, `agent_actions.confirm` e `payments.register` com o seu nome como ator.

## 9. Limitações conhecidas

- **A memória da conversa não guarda o resultado da confirmação**, porque a confirmação não passa pela IA. Se o usuário perguntar em seguida "registrou?", o agente consulta a API.
- **O rótulo "hoje"** da prévia usa o fuso America/Bahia. Uma data de pagamento ausente é fixada na prévia, então o que executa é a data mostrada, mesmo que a confirmação chegue depois da meia-noite.
- **Usuário restrito a uma agência** continua recusado, como no agente somente leitura.

## 10. Telegram: confirmação por botão

Workflow: `integrations/n8n/workflows/b2c-finance-telegram-agent.json` (mesmas ferramentas, mesma API, mesmo prompt).

- **Prévia:** depois da IA, se ela propôs uma ação nesta mensagem, o workflow envia a prévia da API com o teclado inline **[Confirmar] [Cancelar]**. A resposta da proposta no Telegram não traz o código.
- **O botão leva só a referência:** `callback_data = confirm:<actionId>` ou `cancel:<actionId>` (até 64 bytes). Nenhum valor, cliente ou payload vai no botão.
- **Toque (callback_query):** identidade = `from.id` de quem tocou, resolvida pela API → `GET /agent/pending-actions/{id}` com o vínculo dessa pessoa (de outra pessoa = 404) → só `PENDING` segue → `POST …/confirm` com `{ messageId: <update_id>, via: "button" }` ou `POST …/cancel`.
- **Idempotency-Key:** `telegram:<update_id>:<actionId>`. O mesmo update reenviado pelo Telegram é replay; outro toque é 409 `action_not_pending` → "Essa ação já foi processada."
- **Depois:** `answerCallbackQuery` com um aviso curto e `editMessageText` na prévia, que passa a mostrar o resultado real da API e perde os botões.
- **"sim" digitado** com ação aguardando: o bot reenvia a prévia com os botões. Texto nunca confirma.
