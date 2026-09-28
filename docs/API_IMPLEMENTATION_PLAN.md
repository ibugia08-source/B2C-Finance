# B2C Finance — Plano técnico da API oficial (`/api/v1`) e integração n8n/WhatsApp

**Data:** 27/09/2026 · **Base auditada:** `main` @ `3f2445f`.

**Status:** plano. Nenhum endpoint foi implementado, nenhuma migration foi criada e nenhum dado foi alterado.

> **Princípio inegociável.** A API é **mais uma porta de entrada** para as mesmas funções de domínio usadas pela interface. Ela não é uma segunda implementação.
>
> ```
> Interface → Server Action ─┐
>                             ├─→ função de domínio (engines / services / clients)
> n8n/API  → Route Handler ──┘
> ```
>
> Se uma regra só existe dentro de uma Server Action, ela é **extraída** para a camada de domínio **antes** de ganhar endpoint. A action passa a chamar a função extraída, e o endpoint chama a mesma função. Nunca existe `registerPaymentV2`.

> **Decisão de especificação revogada.** `docs/spec/03-engenharia-seguranca-roadmap.md` (linha 107) diz: "sem API routes de dados além de download/export/webhooks". Este plano revoga essa decisão **de forma controlada**. A spec deve ser atualizada na Fase 0 com as condições desta seção.

---

## Status da implementação

**27/09/2026 — preparação interna (F0 parcial + F3 parcial), sem endpoint.**

- **Principal no contexto de execução** (`auth/owner-scope.ts`): `Principal` (usuário | sistema), `runWithPrincipal` e `systemPrincipal`. `getCurrentUser`, `guardPermission` e `contextFromRequest` consultam o principal antes do cookie.
- **D1 corrigida:** dentro de uma requisição sem sessão e sem principal, `guardPermission` **nega**. Os webhooks (gateway, AvanceCRM) e o cron de status declaram principal de sistema.
- **D2 corrigida:** a auditoria usa a origem e o ator do principal (`sistema:<nome>` para jobs e webhooks).
- **Contexto de domínio** (`engines/domain.ts`): `DomainContext` (dono obrigatório + principal), `DomainResult`, `inDomain`, `domainCan`, `domainActor` e `statusCapabilities`. O construtor a partir da sessão é `auth/domain-session.ts` → `domainContextFor(viewer)`.
- **Funções extraídas**, todas chamadas pelas actions e prontas para a API:

  | Função | Arquivo |
  |---|---|
  | `salvarCliente`, `registrarPerdaDeCliente` | `services/client-service.ts` |
  | `registerPayment`, `settleOpenBalance`, `RegisterPaymentInputSchema` | `engines/payment-engine.ts` |
  | `registrarContatoDeCobranca`, `registrarNotaDeCobranca` | `services/billing-collection.ts` |
  | `salvarDespesa` | `services/expense-service.ts` |
  | `alterarStatusDoUpsell`, `excluirUpsell`, `desfazerCobrancaDoUpsell` | `services/upsell-service.ts` |
  | `montarRotinaDoDia`, `gatesDaRotina` | `services/daily-routine.ts` |
  | `acessoAoRelatorio`, `executarRelatorio` | `reports/run.ts` |

- **O que já era domínio e foi mantido:** status temporal (`clients/status-history.ts`), Dashboard (`computePeriodMetrics` e afins), Caixa (`getCashSummary`, `projecaoDeCaixa`), Projeções, Renovações e motores de pagamento, despesa e cobrança.
- **Continua pendente:**
  - **D3** (`escopoAtual` já lê o principal via `getCurrentUser`; falta teste dedicado).
  - **D5** (`findOwnedOrThrow`).
  - **D8**: actions que contornam motores.
  - **D12**: canal de `despesa.paga`.
  - **D17**: cópias "2".
  - Extração de renovação, grade de Recebimentos e contratos.

---

## Sumário

1. [Mapa da arquitetura atual](#1-mapa-da-arquitetura-atual)
2. [Fluxo atual das principais regras](#2-fluxo-atual-das-principais-regras)
3. [Dívidas técnicas que impactam a API](#3-dívidas-técnicas-que-impactam-a-api)
4. [Funções reutilizáveis](#4-funções-reutilizáveis-como-estão)
5. [Funções que precisam ser extraídas](#5-funções-que-precisam-ser-extraídas)
6. [Proposta de arquitetura da API](#6-proposta-de-arquitetura-da-api)
7. [Autenticação](#7-autenticação)
8. [Service Account](#8-service-account)
9. [Scopes](#9-scopes)
10. [Idempotência](#10-idempotência)
11. [Auditoria](#11-auditoria)
12. [Eventos e webhooks](#12-eventos-e-webhooks)
13. [Endpoints V1](#13-endpoints-v1-recomendados)
14. [Plano de implementação em fases](#14-plano-de-implementação-em-fases)
15. [Riscos](#15-riscos)

- [Apêndice A — Classificação das operações para o agente](#apêndice-a--classificação-das-operações-para-o-agente)
- [Apêndice B — Versionamento dos workflows n8n](#apêndice-b--versionamento-dos-workflows-n8n)
- [Apêndice C — OpenAPI](#apêndice-c--openapi)

---

## 1. Mapa da arquitetura atual

### 1.1 Camadas

```
src/app/**/page.tsx          Server Components (leitura; algumas páginas montam regra inline — ex.: /rotina)
src/lib/actions/*.ts         41 arquivos "use server" (mutação + algumas leituras); chamam requirePermission/tryPermission
src/lib/engines/             MOTORES DE DOMÍNIO com guardas (permissão → período → idempotência → fato → auditoria → outbox)
   payment-engine.ts         settleBilling, revertPayment, useCredit, quickSettlePaidAt
   billing-engine.ts         recognizeBilling, cancelBilling, generateTcvInstallments
   expense-engine.ts         setExpenseStatus, recognizeExpense
   guards.ts                 guardPermission, guardPeriod, guardIdempotency
   context.ts                EngineContext {actorId, actorEmail, origin, reason, correlationId}; contextFromRequest
src/lib/services/*.ts        ~60 serviços (métricas, ciclo de recebíveis, fechamento, renovação, cobrança, lifecycle…)
src/lib/clients/             status-history.ts (status temporal — modelo de camada correta), period-status.ts
src/lib/financial/           calculations.ts (barrel de métricas), projections.ts (matemática pura)
src/lib/metrics/             registry.ts (dicionário oficial de métricas) + engine.ts (computePeriodMetrics)
src/lib/reports/             registry + 18 definições (build(q) → linhas cruas) + present/export
src/lib/accounting/          razão (LedgerTransaction, idempotencyKeyOf)
src/lib/outbox/index.ts      Transactional Outbox (publish dentro da tx; runOutboxWorker com backoff/dead-letter)
src/lib/integrations/        avancecrm.ts, gateway.ts, inbox.ts (webhooks de entrada com HMAC + WebhookInbox)
src/lib/ai/                  assistente: prompt + snapshot financeiro (sem tool-calling)
src/lib/auth/                session.ts (token HMAC), current-user.ts, viewer.ts (guards), owner-scope.ts (ALS)
src/lib/prisma.ts            extensão de isolamento por dono (OWNED_MODELS)
src/lib/owner-cache.ts       ownerCached (unstable_cache segmentado)
src/lib/revalidate.ts        invalidação por domínio (revalidateAgency/Finance/ClientStatus…)
src/middleware.ts            sessão obrigatória, bypass para /login, /f, /api/webhooks, /api/cron; rate limit em memória
src/app/api/                 só downloads, DRE CSV, webhooks (avancecrm, gateway), cron (status-programado), encerrar sessão
```

**Pastas pedidas × equivalentes existentes.** A regra é não criar pastas duplicadas.

| Pedida | Decisão |
|---|---|
| `src/app/api/v1/` | **Criar.** Não existe. |
| `src/lib/api/` | **Criar.** Guarda o que é específico da porta HTTP: autenticação por chave, principal, erros, serialização, idempotência HTTP e registro OpenAPI. |
| `src/lib/domain/` | **Não criar.** Os equivalentes já existem: `src/lib/engines` (comandos com guardas), `src/lib/services` (consultas e regras) e `src/lib/clients`. As funções extraídas vão para `engines/` quando mutam fatos financeiros e para `services/` nos demais casos. Criar `domain/` produziria uma terceira casa para a mesma coisa. |
| `src/lib/integrations/` | **Existe.** Acrescentar `n8n.ts` (assinatura e entrega de webhooks de saída). |
| `src/lib/events/` | **Não criar.** O equivalente é `src/lib/outbox/`. O catálogo de eventos entra como `src/lib/outbox/events.ts`. |
| `integrations/n8n/` | **Criar** na raiz (Apêndice B). |
| `docs/` | Existe. Entram `docs/API_IMPLEMENTATION_PLAN.md` (este documento) e depois `docs/api/openapi.json` (gerado). |

### 1.2 Onde o `ownerId` é resolvido

- **Isolamento em Prisma** (`src/lib/prisma.ts`):
  - `OWNED_MODELS` cobre cerca de 80 modelos.
  - Nas leituras `findFirst/findMany/count/aggregate/groupBy` e em `updateMany/deleteMany`, a extensão acrescenta `where.ownerId` automaticamente. Em `create`, `createMany` e `upsert.create`, injeta o `ownerId` quando ele está nulo.
  - `findUnique` é **pós-filtrado**: o registro de outro dono vira `null`.
  - ⚠️ `update`, `delete` e `upsert.where` por id único **não conferem o dono**.
- **Resolução do dono** (`src/lib/auth/owner-scope.ts`, `resolveOwnerId`):
  1. Se houver contexto de dono (ALS: `runWithOwner` ou `runWithoutScope`), vale esse contexto.
  2. Senão, lê o cookie `b2c_session` e usa `payload.own ?? payload.uid`, só pelo token, sem consultar o banco.
  3. Sem nenhum dos dois, cai em `"__no_owner__"`. Isso é fail-closed: nada é encontrado, e criar grava o sentinela.
- **Dono efetivo de um usuário:** `workspaceOwnerId ?? id`. Hoje existe um único `Workspace`, com `Workspace.ownerId` apontando para o usuário dono.
- **Precedente pronto para a API:** os webhooks (`integrations/inbox.ts:140-155`) e o formulário público (`actions/public-contract-form.ts`) já fazem "carrega o dono → `runWithOwner(ownerId, async () => …)`". A API segue o mesmo padrão.

### 1.3 Como as permissões funcionam

- **Catálogo:** `src/lib/permissions.ts` (`PERMISSION_MODULES`), com ids no formato `modulo.acao`.
  - Papéis: ADMIN, GESTOR, FINANCEIRO, ADMINISTRATIVO, COMERCIAL, COBRANCA e USER.
  - Padrões por papel em `ROLE_PERMISSIONS`.
- **`hasPermission(user, perm)`**, nesta ordem:
  1. ADMIN sempre pode.
  2. Um override por usuário em `UserPermission` (`enabled` true/false) prevalece.
  3. Senão, valem os padrões do papel.
- **Recorte de dados:** `User.dataScope` (WORKSPACE | AGENCY) + `scopeAgencyId`, aplicado por `escopoAtual()` (`services/data-scope.ts`).
- **Mascaramento de campos:** `canSeeField` e `maskField` para campos sensíveis.
- **Guards de sessão** (`auth/viewer.ts`: `getViewer`, `requirePermission`, `tryPermission`): leem o cookie e fazem `redirect()` quando não há usuário. **Não servem para chamadas de máquina.**

### 1.4 Cache e auditoria (estado atual)

- **Cache.** `ownerCached` monta a chave com `[keyBase, versão do deploy]` + (dono, usuário, papel, versão de métricas) + argumentos, e executa sob `runWithOwner`.
  - Sem cookie, lê o dono do ALS, e usuário e papel viram `__anon__`/`__no_role__`. Todas as chaves de API do mesmo dono compartilham a mesma entrada de cache.
  - Funciona em Route Handler.
  - A invalidação (`revalidate*`) é feita **só nas actions**; serviços e motores nunca revalidam.
- **Auditoria.** `AuditLog` é append-only (garantido por trigger), segmentado por dono e sem FK para `User`.
  - Helpers: `auditUpdate` (diff por campo), `auditEvent` (CREATE/DELETE/REVERSE) e `assertReason`.
  - O enum `AuditOrigin` **já tem `API`**, mas ninguém o usa.
  - O `correlationId` é carimbado pelo middleware (`x-correlation-id`, que também é devolvido na resposta).

---

## 2. Fluxo atual das principais regras

| Regra | Fluxo hoje | Centralizada? |
|---|---|---|
| **Registrar pagamento** | `registerBillingPayment` (FormData) → `settleBilling` (motor: permissão → período do caixa → idempotência por `externalSource+externalId`) → `settleBillingPayment` (Payment + PaymentApplication + razão + auditoria + outbox `pagamento.registrado`) | ✅ Sim, é o modelo a seguir |
| **Estornar pagamento** | `undoQuickSettle` / `deleteReceiptPayment` → `revertPayment` → `revertBillingPayment` | ✅ Sim. A janela de 15 min do desfazer fica na action. |
| **Status do cliente (vigência)** | `changeClientStatusAction` → `changeClientStatus(input, caps)` (período fechado, transação, auditoria) → `sincronizarStatusAtual` | ✅ **Modelo ideal para a API:** as permissões chegam como `caps` explícitas |
| **Cadastro/edição de cliente** | `saveClient(FormData)`, cerca de 350 linhas inline (dedupe, modalidade, contrato, cobranças, `abrirVidaDoCliente`); chama `getViewer` no meio da regra | ❌ Na action |
| **Renovação** | `renewClientFlow(FormData)`, cerca de 200 linhas inline (janela anti-duplo, transação contrato+cliente+ClientRenewal, lança a cobrança, liquida) | ❌ Na action |
| **Cobrança manual / incluir no mês / inadimplência passada** | `saveBilling`, `includeClientInMonth`, `addPastDelinquency`: `prisma.billing.create` direto, **sem** `billing-engine.recognizeBilling` | ❌ Contorna o motor |
| **Cancelar/restaurar cobrança** | `cancelBilling` (action): update direto, **sem** `billing-engine.cancelBilling` (e portanto sem a guarda de período) | ❌ Contorna o motor |
| **Grade de Recebimentos** | `receivables-inline.ts`: 10 actions com matriz de status, valor e vencimento inline; liquidar vai ao motor | ⚠️ Parcial |
| **Despesas** | `saveExpense` (recorrência, 12 meses), `deleteExpense` (sem guarda de período) inline; pagar vai para `expense-engine.setExpenseStatus` | ⚠️ Parcial |
| **Upsell** | `saveUpsell`, `setUpsellStatus` (ao ganhar, **cria Billing direto**) e `deleteUpsell` inline | ❌ Na action |
| **Contratos** | `saveContract`, `endContract`, `cancelContract`, `deleteContract` inline; gerar cobranças vai para `generateBillingsForContract` | ⚠️ Parcial |
| **Rotina diária** | Montada **dentro de `src/app/rotina/page.tsx`** (`markOverdueBillings` + fila + caixa + renovações + consultas); dispensar e concluir em `actions/routine.ts` | ❌ Sem serviço |
| **Métricas / Dashboard** | `computePeriodMetrics`, `getDashboardMainMetrics`, `getExecutiveDashboard`, `getYearlySeries`, `getDashboardEvolution` (ownerCached) | ✅ Sim |
| **Relatórios** | `REPORTS[key].build(ReportQuery)` → linhas cruas; permissão por relatório (`canViewReport`); export CSV/XLSX | ✅ Sim, exponível direto |
| **Projeções** | `financial/projections.ts` (puro) + `getPortfolioProjection` + `getAnnualPanel` | ✅ Sim |
| **Caixa** | `getCashSummary`, `getFinanceSummary`, `projecaoDeCaixa`, `fluxoProjetado` (usa `escopoAtual`) | ✅ Leitura. O CRUD de contas está na action. |
| **Renovações (leitura)** | `renewalLedgerMonth`, `getRenewalPanel`, `getRenewalOutlook` | ✅ Sim |
| **Fechamento** | `closing-period.ts` (`fecharPeriodo`, `reabrirPeriodo`…); o registro de auditoria do fechamento fica só em `fecharPeriodoAction` | ⚠️ Auditoria na action |
| **Folha** | `setPayrollStatus` cria a despesa PAYROLL direto, **sem** `expense-engine` | ❌ Na action |

---

## 3. Dívidas técnicas que impactam a API

Severidade: 🔴 bloqueia a API (corrigir antes de qualquer endpoint) · 🟠 corrigir antes do endpoint correspondente · 🟡 melhoria.

| # | Dívida | Evidência | Sev. |
|---|---|---|---|
| D1 | **A guarda de permissão dos motores falha ABERTA fora de sessão.** `guardPermission` envolve `tryPermission` num `catch` que devolve OK. Num Route Handler sem cookie, `getViewer` lança `NEXT_REDIRECT`, o `catch` engole e **a permissão passa**. O webhook do gateway já depende desse comportamento. | `engines/guards.ts:24-43` | 🔴 |
| D2 | **Auditoria rotula errado as chamadas sem sessão.** `contextFromRequest` devolve `actorId=null, origin="UI"` quando `getCurrentUser()` é nulo sem lançar. | `engines/context.ts:29-62` | 🔴 |
| D3 | **O recorte por agência é perdido.** `escopoAtual()` sem usuário devolve WORKSPACE (visão total). Uma chave de um usuário restrito a uma agência veria tudo. | `services/data-scope.ts:24-41` | 🔴 |
| D4 | **Os guards de sessão redirecionam** (`requirePermission`/`requireAdmin`/`getViewer`). Numa API o certo é 401/403. | `auth/viewer.ts` | 🔴 |
| D5 | **`update`/`delete` por id único não conferem o dono** na extensão Prisma. Com ids vindos de fora, um id de outro dono poderia ser alterado se o código não carregar antes com `findFirst` escopado. | `lib/prisma.ts:200-215` | 🔴 |
| D6 | O middleware redireciona para `/login` toda rota sem cookie; `/api/v1` precisa de bypass próprio. | `middleware.ts:199-204` | 🔴 |
| D7 | Regras de negócio presas em actions "grossas" que recebem FormData e usam parsers BR (`parseBRL`, `parseDateBR`) — seção 5. | `actions/clients.ts`, `renewals.ts`, `billings.ts`, `receivables-inline.ts`, `upsells.ts`, `expenses.ts`, `payroll.ts`, `contracts.ts` | 🟠 |
| D8 | **Actions que contornam os motores** e, com isso, a guarda de período e a auditoria: `saveBilling`, `includeClientInMonth`, `addPastDelinquency`, `cancelBilling` (action), `setUpsellStatus` (Billing direto), `deleteExpense`, `setPayrollStatus`. | idem | 🟠 |
| D9 | `capacidadesDeStatus()` chama `getViewer()` **dentro** de `saveClient`, `setClientStatus`, `markClientLost` e `bulkUpdateClients`. Onboarding e avaliações também leem `getCurrentUser()` no meio da regra. | `actions/clients.ts`, `services/onboarding.ts`, `services/avaliacao-mensal.ts` | 🟠 |
| D10 | A invalidação de cache vive só nas actions. Uma escrita pela API precisa chamar os mesmos `revalidate*`, senão a interface fica até 5 min defasada. | `lib/revalidate.ts` | 🟠 |
| D11 | A Rotina diária não tem serviço: é montada dentro da página. | `app/rotina/page.tsx` | 🟠 |
| D12 | **`despesa.paga` é publicado no canal `webhook`, que o worker entrega ao GATEWAY DE PAGAMENTO.** Hoje os eventos só se acumulam, porque o worker não roda agendado; mas o bug precisa ser corrigido antes de criar o canal n8n. | `engines/expense-engine.ts:66`, `scripts/outbox-worker.ts:38-43` | 🟠 |
| D13 | O worker do outbox é um script de linha de comando sem agendamento; nenhum evento é entregue automaticamente. | `scripts/outbox-worker.ts` | 🟠 |
| D14 | `Payment.idempotencyKey` (única) existe mas **nunca é gravada**; só `externalSource+externalId` é usado. | `schema.prisma:1996` | 🟡 (usar na API) |
| D15 | O rate limit é um `Map` em memória por instância Edge, não compartilhado. | `middleware.ts:31-48` | 🟡 |
| D16 | Sessões sem revogação (token sem estado; a declaração `own` fica congelada até expirar). | `auth/session.ts` | 🟡 (afeta a UI, não as chaves) |
| D17 | Cópias duplicadas do Finder registram actions em dobro: `actions/extra-revenues 2.ts`, `actions/limpar-sistema 2.ts`, `services/extra-revenue 2.ts`, `services/limpar-sistema 2.ts`, `app/api/dre/csv 2`. | — | 🟡 |
| D18 | Um acerto de cache devolve `Date` como string (serialização do `unstable_cache`). O serializador da API precisa normalizar. | `owner-cache.ts` | 🟡 |
| D19 | Premissa de workspace único, com `currentWorkspaceId()` em cache de processo. | `services/workspace.ts` | 🟡 |
| D20 | "Hoje" calculado com `setHours` local na Rotina (dispensar item). O servidor roda em UTC e o negócio na Bahia. | `actions/routine.ts:27` | 🟡 |
| D21 | Auditoria inconsistente: parte das actions grossas não audita (ex.: contatos, notas, CRUD de contas). | várias | 🟡 |
| D22 | O valor histórico do MRR ainda usa a mensalidade atual (não `CommercialTerm`). A API herda a limitação e deve documentá-la no contrato. | `docs/STATUS_TEMPORAL_CLIENTES.md` | 🟡 |

---

## 4. Funções reutilizáveis (como estão)

Estas funções recebem parâmetros comuns e só precisam de `runWithOwner`. Algumas pedem um contexto explícito, marcado com † (ver D1–D3).

| Área | Funções |
|---|---|
| Clientes (status) | `changeClientStatus(input, caps)`, `scheduleClientStatusChange`, `cancelScheduledStatusChange`, `getClientStatusTimeline`, `getStatusesAtDate`, `getClientStatusesForCompetence`, `getActiveClientsForCompetence`, `getScheduledStatusChanges`, `materializarStatusProgramados` (`clients/status-history.ts`) |
| Clientes (leitura) | `getClientSummaries(ids)`, `getClientRiskLevels`, `linhaDoTempo(clientId)` (`client-metrics.ts`, `client-timeline.ts`) |
| Ciclo de vida | `pausarCliente`, `retomarCliente`, `reativarCliente`† (`services/lifecycle.ts`) |
| Recebimentos | `settleBilling`†, `revertPayment`†, `useCredit`† (`engines/payment-engine.ts`); `settleBillingPayment(input, ctx)` e `revertBillingPayment` (contexto explícito); `ensureMonthlyBillings`, `ensureClientBillingForMonth`; `billing-engine.cancelBilling`†, `recognizeBilling`† |
| Cobrança | `registrarEnvioDaRegua`, `registrarPromessa`, `ajustarPreferenciaDeCobranca` (`collection-tasks.ts`); `getCollectionQueue`, `getDelinquentClients` |
| Despesas | `expense-engine.setExpenseStatus`†, `recognizeExpense`†; `getExpenseSummary` |
| Caixa | `getCashSummary`, `getFinanceSummary`, `getLiquidez`, `projecaoDeCaixa`, `fluxoProjetado`† (escopo) |
| Contratos | `generateBillingsForContract`, `mrrAtivo`, `tcvVendido` |
| Upsell | `getUpsellKpis` |
| Dashboard | `computePeriodMetrics(period)` (dicionário oficial com política de nulo), `getDashboardMainMetrics`, `getExecutiveDashboard`, `getYearlySeries`, `getDashboardEvolution`, `getRenewalHistory` |
| Relatórios | `getReport(key).build(q)`, `canViewReport`, `parseReportQuery` |
| Projeções | `getPortfolioProjection(ahead)`, `getAnnualPanel(year)`, `projectScenario` / `analyzeGaps` (puras) |
| Renovações | `renewalLedgerMonth`, `getRenewalPanel`, `getRenewalOutlook`, `upcomingRenewals` |
| Fechamento | `periodoDe`, `montarChecklist`, `resumoDoFechamento`, `lerFotografia` (só leitura na API) |
| Infraestrutura | `publish(tx, …)`, `runOutboxWorker` (`outbox`); `assinaturaConfere`/`assinar` (HMAC, `integrations/avancecrm.ts`); `receberNaCaixa` (`integrations/inbox.ts`); `auditUpdate`/`auditEvent`; `hasPermission`; `revalidate*` |

---

## 5. Funções que precisam ser extraídas

A regra é a mesma para todas: a action vira **"FormData/sessão → DTO tipado → função de domínio"**. A função extraída recebe `(dto, ctx: EngineContext, caps/permissões)` e **não** lê cookie, header nem `redirect`. Testes garantem que a action e a função produzem o mesmo resultado.

| Prio | De (action) | Para (função de domínio) | Observação |
|---|---|---|---|
| P1 | `renewClientFlow` | `engines/renewal-engine.ts` → `renovarCliente(dto, ctx, caps)` | Transação, janela anti-duplo, lançamento e liquidação. É o fluxo mais crítico de receita. |
| P1 | `saveBilling`, `includeClientInMonth`, `addPastDelinquency` | `billing-engine.createBilling(dto, ctx)` | Uma única regra de "uma MRR por cliente/mês" e de recálculo de status, **com** guarda de período. |
| P1 | `cancelBilling` (action), `cancelBillingsBulk`, `restoreBilling`, `bulkRemoveClientsFromList` | `billing-engine.cancelBilling` (já existe) + `restoreBilling` | Hoje contornam o motor. |
| P1 | `setMonthChargeStatus`, `setClientMonthPayment`, `setClientChargeAmount`, `setClientPaymentDay`, `setClientContractMonths`, `rescheduleBilling` | `services/receivables.ts` (uma função por gesto) | Matriz de status da grade. |
| P1 | `saveClient` (criar/editar), `markClientLost`, `setClientModality`, `setClientMonthlyValue`, `setClientRenewalExpectation`, `scheduleClientRenewal` | `services/client-service.ts` → `criarCliente`, `atualizarCliente`, `registrarPerda`… | Tirar `capacidadesDeStatus()`/`getViewer` de dentro (D9); `caps` explícitas, como em `status-history`. |
| P2 | `saveExpense`, `deleteExpense`, `endRecurrence`, `setExpenseDueDate` | `engines/expense-engine.ts` | Recorrência + guarda de período na exclusão (D8). |
| P2 | `setUpsellStatus`, `saveUpsell`, `deleteUpsell` | `services/upsell-service.ts` | "Venda ganha lança cobrança" via `billing-engine.createBilling`. |
| P2 | `saveContract`, `endContract`, `cancelContract` | `services/contract-service.ts` | Derivação de valor MRR/TCV. |
| P2 | Rotina (página) + `dismissRoutineItem`/`setRoutineActionDone` | `services/daily-routine.ts` → `rotinaDoDia(hoje)`, `concluirItem`, `dispensarItem` | Corrigir o "hoje" (D20). |
| P2 | `registerBillingContact`, `addCollectionNote` | `collection-tasks` | Registro de contato e nota. |
| P3 | `setPayrollStatus`, `ensurePayroll` | `services/payroll-service.ts` | Despesa via `expense-engine.recognizeExpense`. **Não exposto na API V1.** |
| P3 | `saveIncome`/`deleteIncome`, contas, nichos, ofertas, serviços, regras | CRUD simples em `services/` | Baixa prioridade; fora da V1. |
| P3 | `fecharPeriodoAction` (auditoria inline) | `closing-period.fecharPeriodo` com auditoria dentro | Fora da V1 (só humano). |
| P3 | `buildSystemPrompt(viewer)` / prompts de relatório | `lib/ai` | Útil se o agente quiser o "snapshot financeiro" pronto. |

**Correções transversais (Fase 0, pré-requisito de tudo):**

1. **Principal de requisição no ALS.** O store de `owner-scope` ganha `principal`: `{ kind: "user" | "api", userId?, clientId?, keyId?, scopes[], permissionsUser? }`. `getCurrentUser`, `contextFromRequest`, `escopoAtual` e `guardPermission` passam a consultá-lo **antes** do cookie.
2. **`guardPermission` fail-closed dentro de requisição.** Com principal de API, a guarda confere de verdade. Sem principal e sem sessão, só degrada para OK quando o contexto for explicitamente de JOB, que passa a ser marcado no ALS. O webhook do gateway passa a rodar com principal de sistema declarado.
3. **`EngineContext` explícito** em todos os motores (parâmetro opcional; o padrão continua `contextFromRequest`).
4. **Helper `findOwnedOrThrow(model, id)`** e regra de revisão: toda escrita por id vinda da API carrega o registro com `findFirst` escopado antes de `update`/`delete` (D5). Opcionalmente, endurecer a extensão para converter `update`/`delete` por id em `updateMany`/`deleteMany` com `ownerId`.

---

## 6. Proposta de arquitetura da API

```
n8n ──HTTPS──▶ middleware (bypass /api/v1 + rate limit por IP)
                 └▶ src/app/api/v1/<recurso>/route.ts           (fino: declara o endpoint)
                      └▶ defineEndpoint({ method, scope, permission?, input: zod, output: zod,
                                          idempotent?, confirmation?, handler })   ← src/lib/api/endpoint.ts
                           1. autentica a chave (hash) → ApiClient/ApiKey → principal
                           2. confere scope (+ permissão RBAC do usuário delegado, se houver)
                           3. valida entrada (zod) → DTO
                           4. idempotência HTTP (escritas)
                           5. runWithOwner(ownerId, runWithPrincipal(principal, handler))
                                └▶ função de DOMÍNIO (engines / services / clients) ← a mesma da interface
                           6. revalidate* do domínio (escritas)
                           7. serializa (dinheiro string decimal, datas civis YYYY-MM-DD, mascaramento)
                           8. registra ApiRequestLog; devolve envelope + x-correlation-id
```

**`src/lib/api/`:**

| Arquivo | Conteúdo |
|---|---|
| `auth.ts` | Formato da chave, hash, lookup e principal |
| `endpoint.ts` | `defineEndpoint` (pipeline acima) |
| `errors.ts` | `ApiError` → `application/problem+json` (RFC 9457) com `code` estável: `unauthorized`, `forbidden_scope`, `validation_failed`, `not_found`, `conflict`, `idempotency_mismatch`, `period_closed`, `confirmation_required`, `rate_limited`, `internal` |
| `serialize.ts` | Dinheiro em string decimal (`"1500.00"`) com `currency: "BRL"`; datas civis em `"2026-10-01"`; instantes em ISO UTC; mascaramento via `canSeeField` |
| `pagination.ts` | Cursor opaco (`?cursor=&limit=`, limite máximo 100) |
| `idempotency.ts` | Seção 10 |
| `confirmations.ts` | Seção 13.3 |
| `openapi.ts` | Registro dos schemas zod → OpenAPI 3.1 (Apêndice C) |

**Convenções:**

| Tema | Convenção |
|---|---|
| Versão | Na URL (`/api/v1`). Mudanças compatíveis ficam na v1; mudanças incompatíveis viram v2 com período de convivência. |
| Recursos | Em inglês (`clients`, `billings`, `payments`), para bater com o OpenAPI e com n8n. As descrições ficam em português. |
| Competência | Sempre no formato `YYYY-MM`. Os períodos seguem `resolvePeriod` (os mesmos parâmetros da interface). |
| Envelope | `{ "data": …, "meta": { "correlationId", "nextCursor"? } }` |
| Runtime | `nodejs` (Prisma e crypto), região `gru1`, `dynamic = "force-dynamic"` |
| Cache | Leituras usam as mesmas funções `ownerCached`, com o **scope da chave na chave de cache** (D-cache: acrescentar `principal.keyId` e scopes em `cacheScopeKeyParts`) para evitar vazamento entre chaves com recortes diferentes |

---

## 7. Autenticação

**Sem sessão de navegador.** Cada requisição traz:

```
Authorization: Bearer b2c_live_<prefixo8>_<segredo43>
x-correlation-id: <id do n8n/execução>      (opcional; ecoado)
Idempotency-Key: <uuid>                      (obrigatório em POST/PATCH/DELETE)
X-B2C-On-Behalf-Of: <userId>                 (opcional; delegação — seção 8.3)
```

- **Formato da chave:**
  - `b2c_live_` ou `b2c_test_`, depois um prefixo público de 8 caracteres, e por fim o segredo aleatório de 32 bytes em base64url.
  - O prefixo identifica a linha no banco sem revelar o segredo, e o formato é fácil de detectar por varredores de segredo.
- **Armazenamento:** o banco guarda apenas `HMAC-SHA256(API_KEY_PEPPER, segredo)`. O pepper é uma variável de ambiente nova, e o segredo tem alta entropia, então dispensa bcrypt. A conferência usa `timingSafeEqual`.
  - **O segredo é exibido uma única vez**, na criação.
- **Validação por requisição:**
  1. Lookup por prefixo (índice único).
  2. Conferência do hash.
  3. A chave não pode estar revogada nem expirada, e o client precisa estar ativo.
  4. Se houver allowlist de IP opcional no client, o IP precisa estar nela.
  5. Atualiza `lastUsedAt` de forma assíncrona e amostrada, no máximo uma vez por minuto.
- **Middleware:**
  - `/api/v1/*` entra no bypass de sessão, com rate limit por IP como já existe para webhooks.
  - A autenticação real acontece no `defineEndpoint`, em Node e com acesso ao banco, porque o middleware roda em Edge e não acessa o Prisma.
- **Rate limit por chave:**
  - Fase 1: contador em memória por instância, igual ao atual.
  - Fase 7: contador compartilhado (Vercel KV/Upstash, ou tabela com janela). Limite inicial de 60 requisições por minuto por chave, e 10 por minuto em escritas.
- **Rotação:** um client pode ter duas chaves ativas ao mesmo tempo. Cria-se a nova, atualiza-se a credencial no n8n e revoga-se a antiga. Expiração opcional, com padrão de 180 dias.
- **Revogação imediata:** `revokedAt` é conferido a cada requisição (sem cache da chave), o que resolve para a API a falta de revogação que existe nas sessões (D16).
- **Proibido:** usar o `mint-token` de sessão, ou o cookie `b2c_session`, como credencial de integração.

---

## 8. Service Account

### 8.1 Modelos (migration **aditiva**, sem tocar em tabelas existentes)

```prisma
/// Identidade de máquina (n8n, agente WhatsApp, futuros serviços).
model ApiClient {
  id            String    @id @default(cuid())
  ownerId       String                     // dono dos dados (Workspace.ownerId) — runWithOwner
  workspaceId   String
  name          String                     // "n8n — Agente WhatsApp"
  description   String?
  scopes        String[]                   // teto do que QUALQUER chave deste client pode (seção 9)
  /// Delegação: pode agir "em nome de" um usuário humano (X-B2C-On-Behalf-Of)?
  allowDelegation Boolean @default(false)
  /// Usuário técnico cujo RBAC limita o client quando NÃO há delegação (opcional).
  runAsUserId   String?
  ipAllowlist   String[]  @default([])
  active        Boolean   @default(true)
  createdById   String
  createdAt     DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime  @updatedAt @db.Timestamptz(3)
  keys          ApiKey[]
  @@index([ownerId])
}

model ApiKey {
  id          String    @id @default(cuid())
  clientId    String
  client      ApiClient @relation(fields: [clientId], references: [id], onDelete: Cascade)
  prefix      String    @unique              // público, 8 chars
  secretHash  String                          // HMAC-SHA256(pepper, segredo)
  scopes      String[]                        // ⊆ client.scopes (restringe mais, nunca amplia)
  environment String    @default("live")      // live | test
  expiresAt   DateTime? @db.Timestamptz(3)
  revokedAt   DateTime? @db.Timestamptz(3)
  revokedById String?
  lastUsedAt  DateTime? @db.Timestamptz(3)
  lastUsedIp  String?
  createdById String
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)
  @@index([clientId])
}

/// Vínculo telefone → usuário (o agente de WhatsApp age em nome de quem mandou a mensagem).
model UserChannelIdentity {
  id        String   @id @default(cuid())
  userId    String
  channel   String                              // "whatsapp"
  address   String                              // E.164, ex.: +5571999990000
  verifiedAt DateTime? @db.Timestamptz(3)       // verificado por código enviado na plataforma
  ownerId   String?
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@unique([channel, address])
}
```

Todas as tabelas novas nascem com RLS ligado (regra F1.12, teste `rls.test.ts`). `ApiClient`, `ApiKey` e `UserChannelIdentity` entram em `OWNED_MODELS`, com exceção do lookup da chave, que é feito com `runWithoutScope` e só por prefixo.

### 8.2 Gestão

- A tela é **Configurações → Integrações**.
- Permissões novas no catálogo:
  - `integracoes.gerenciar`: sensível; por padrão só ADMIN.
  - `integracoes.visualizar`
- A tela permite:
  - criar client, criar, rotacionar e revogar chave;
  - ver `lastUsedAt` e as últimas requisições (`ApiRequestLog`);
  - baixar a coleção OpenAPI.
- Cada gesto é auditado (`AuditLog`, entidade `ApiClient`/`ApiKey`).

### 8.3 Quem é o "ator" de uma chamada

| Caso | Permissões efetivas | Ator na auditoria |
|---|---|---|
| Chave sem delegação e sem `runAsUserId` | Só os scopes (sem RBAC humano) | `api:<client>` (actorId = `ApiClient.id`) |
| Chave com `runAsUserId` | scopes ∩ RBAC do usuário técnico | usuário técnico |
| Chave com delegação + `X-B2C-On-Behalf-Of` (usuário ativo, vínculo verificado) | **scopes ∩ RBAC do usuário humano** (inclui recorte de agência e mascaramento de campos) | o usuário humano, com `origin=API` e `reason` "via <client>" |

- **Recomendação para o agente de WhatsApp:** usar delegação obrigatória para escrita.
  - O n8n resolve o telefone de quem falou para um `userId`: consulta `GET /api/v1/identities/resolve?channel=whatsapp&address=…`, que exige scope próprio.
  - Com isso, o agente nunca pode mais do que a pessoa poderia na interface.
  - Mensagem de número não vinculado: só respostas genéricas, nenhuma leitura de dados.

---

## 9. Scopes

**Formato:** `recurso:ação`. Cada endpoint declara exatamente um scope. Com delegação, também declara a permissão RBAC correspondente, e as duas precisam passar.

| Scope | Permite | Permissão RBAC equivalente (delegação) |
|---|---|---|
| `me:read` | `/me` | — |
| `clients:read` | clientes, resumo, timeline de status | `clientes.visualizar` (+ `clientes.ver_dados_financeiros` para valores) |
| `clients:status:write` | alterar, programar e cancelar status (com confirmação) | `clientes.alterar_status` (+ `programar_status` / `alterar_status_retroativo`) |
| `billing:read` | cobranças, recebimentos do mês, inadimplência | `recebimentos.visualizar` |
| `payments:write` | registrar pagamento (com confirmação) | `recebimentos.registrar_pagamento` |
| `collection:write` | registrar contato, nota e promessa de pagamento | `recebimentos.gerar_cobranca` |
| `expenses:read` | despesas e resumo | `despesas.visualizar` |
| `expenses:pay` | marcar despesa como paga (com confirmação) | `despesas.marcar_como_paga` |
| `cash:read` | caixa, liquidez, projeção de caixa | `caixa.visualizar` |
| `dashboard:read` | métricas oficiais, séries, evolução | `dashboard.visualizar` (+ `dashboard.ver_financeiro`) |
| `reports:read` | lista e execução de relatórios (JSON) | `relatorios.visualizar` + `canViewReport(key)` |
| `renewals:read` | livro de renovações, próximas renovações | `clientes.visualizar` |
| `upsell:read` | pipeline e KPIs de upsell | `upsell.visualizar` |
| `projections:read` | carteira projetada, painel anual | `projecoes.visualizar` |
| `routine:read` / `routine:write` | rotina do dia / concluir e dispensar item | `rotina.visualizar` / `rotina.concluir_acao` |
| `events:read` | feed de eventos (`/events`) | — |
| `webhooks:manage` | assinaturas de webhook (só admin; normalmente pela interface) | `integracoes.gerenciar` |
| `identities:resolve` | resolver telefone → usuário | — |
| `confirmations:execute` | executar uma confirmação pendente | a permissão da operação confirmada |

**Regras:**

- Os scopes das chaves são um subconjunto dos scopes do client.
- Scopes desconhecidos são rejeitados na criação.
- **Não existe** scope curinga para chaves de API, nem mesmo para ADMIN.
- Scopes de operações fora da V1 (Apêndice A, grupo C) **não existem** no catálogo, então nem podem ser concedidos por engano.

---

## 10. Idempotência

Há duas camadas complementares.

**1. HTTP (genérica, em todas as escritas).**

- O cabeçalho `Idempotency-Key` é obrigatório em POST, PATCH e DELETE. Sem ele, a resposta é `400 idempotency_key_required`.
- Tabela nova e aditiva:

  ```prisma
  model ApiIdempotency {
    id           String   @id @default(cuid())
    keyId        String                       // ApiKey
    idemKey      String
    requestHash  String                       // sha256(método + rota + corpo canônico)
    state        String                       // IN_PROGRESS | COMPLETED
    statusCode   Int?
    responseBody Json?
    ownerId      String?
    createdAt    DateTime @default(now()) @db.Timestamptz(3)
    expiresAt    DateTime @db.Timestamptz(3)  // +24h
    @@unique([keyId, idemKey])
  }
  ```

- Semântica (padrão de mercado):

  | Situação | Resposta |
  |---|---|
  | Mesma chave e mesmo hash, já concluída | Devolve a **mesma resposta** gravada, com `Idempotent-Replayed: true` |
  | Mesma chave, requisição ainda em andamento | `409 conflict` |
  | Mesma chave com hash diferente | `422 idempotency_mismatch` |

- Respostas 5xx não são gravadas; o cliente pode repetir.
- A limpeza é feita pelo cron diário, apagando o que passou de `expiresAt`.

**2. De domínio (já existente — reutilizar, não reinventar).**

- **Pagamento:** a API passa `externalSource: "api:<clientId>"` + `externalId: <Idempotency-Key>` ao `settleBilling`. A unicidade `(externalSource, externalId)` + `guardIdempotency` garantem que o mesmo pagamento **nunca** é lançado duas vezes, mesmo que a tabela HTTP tenha expirado.
  - Opcionalmente, gravar também a coluna `Payment.idempotencyKey`, que hoje nunca é gravada (D14).
- **Demais unicidades existentes:**
  - uma MRR por cliente e mês (índice parcial);
  - uma linha do tempo sem sobreposição (EXCLUDE);
  - razão com `(workspaceId, idempotencyKey)`;
  - outbox com `dedupeKey`.
- **Renovação:** hoje tem a janela anti-duplo de 10 minutos na action. Ao extrair para `renovarCliente`, a janela vai junto e aceita `externalId` para idempotência forte.

---

## 11. Auditoria

- **Toda escrita via API** grava `AuditLog`:
  - `origin = "API"`;
  - `actorId` e `actorEmail` conforme a seção 8.3, com o e-mail no formato `"api:<client>"` ou o e-mail do usuário delegado;
  - `reason` vindo do corpo da requisição quando houver, obrigatório em estornos e cancelamentos (`assertReason`);
  - `correlationId` do cabeçalho.
- É exatamente o `EngineContext` que os motores já aceitam; a Fase 0 torna o contexto explícito em todos eles (D2).
- **Registro de requisições** (sem corpo, para não gravar dado pessoal):

  ```prisma
  model ApiRequestLog {
    id            String   @id @default(cuid())
    keyId         String?
    clientId      String?
    actingUserId  String?
    method        String
    route         String                     // padrão, ex.: /api/v1/billings/:id/payments
    statusCode    Int
    errorCode     String?
    durationMs    Int
    idemKey       String?
    correlationId String?
    ip            String?
    ownerId       String?
    createdAt     DateTime @default(now()) @db.Timestamptz(3)
    @@index([clientId, createdAt])
  }
  ```

  Retenção de 90 dias, com limpeza pelo cron diário.
- **Negações relevantes** (401, 403 e scope insuficiente) também entram no log, que alimenta alertas (Fase 7).
- **Confirmações** (13.3): a criação, a confirmação ou recusa e a execução são três eventos auditados, com o mesmo `correlationId`.

---

## 12. Eventos e webhooks

**O que já existe:** `OutboxEvent` + `publish(tx, …)` dentro da transação do fato, worker com recuo exponencial e dead-letter, assinatura HMAC de saída (`x-b2c-signature`, `x-b2c-event-id`) e 8 tipos de evento já publicados (`pagamento.registrado`, `pagamento.estornado`, `cobranca.removida`, `despesa.paga`…).

**Proposta:**

1. **Catálogo versionado de eventos:** `src/lib/outbox/events.ts`, com o nome, o schema zod do payload e a versão `v1`.
   - Payload mínimo: ids + competência + valores, **sem dado pessoal desnecessário**.
   - Eventos V1:

     | Evento | Origem |
     |---|---|
     | `cliente.status_alterado` | `changeClientStatus` / `sincronizarStatusAtual` |
     | `cliente.status_programado` | agendamento de status |
     | `cliente.status_programado_cancelado` | cancelamento de status programado |
     | `pagamento.registrado` | já existe |
     | `pagamento.estornado` | já existe |
     | `cobranca.removida` | já existe |
     | `cobranca.vencida` | job diário que marca vencidas |
     | `despesa.paga` | já existe; canal corrigido |
     | `renovacao.registrada` | registro de renovação |
     | `confirmacao.pendente` | 13.3 |
     | `confirmacao.expirada` | 13.3 |

2. **Canal próprio `n8n`.** Corrige D12, porque `despesa.paga` deixa de usar o canal `webhook` do gateway.
   - Assinaturas em tabela aditiva:

     ```prisma
     model WebhookSubscription {
       id        String   @id @default(cuid())
       clientId  String                         // ApiClient dono
       url       String                         // https obrigatório
       secretHash String                        // segredo HMAC (mostrado 1x)
       events    String[]
       active    Boolean  @default(true)
       ownerId   String?
       createdAt DateTime @default(now()) @db.Timestamptz(3)
     }
     ```

   - Entrega pelo worker existente, com um entregador `entregarNoN8n`: HMAC-SHA256 sobre o corpo cru + `x-b2c-timestamp` (janela de 5 minutos contra replay) + `x-b2c-event-id` (o n8n deduplica).

3. **Modo pull primeiro, porque é o mais robusto.**
   - `GET /api/v1/events?after=<cursor>&types=…` lê o próprio `OutboxEvent` como feed ordenado.
   - O n8n consulta a cada 1 minuto (nó Schedule), sem depender de cron da Vercel nem de URL pública do n8n.
   - O modo push via assinatura vem depois, para baixa latência.

4. **Agendar o worker.**
   - Hoje ele é um script de linha de comando (D13). A proposta é a rota `/api/cron/outbox`, com autenticação `CRON_SECRET`, igual à de status programado.
   - ⚠️ Na Vercel Hobby o cron é diário. Para entrega por minuto é preciso o plano Pro, ou um agendador externo (o próprio n8n chamando `/api/cron/outbox` com `CRON_SECRET`), ou só o modo pull.

5. **Inbound do n8n para o B2C:** não é necessário. O n8n chama a API. `WebhookInbox` e `receberNaCaixa` continuam servindo aos provedores (gateway).

---

## 13. Endpoints V1 recomendados

Prefixo `/api/v1`. **(C)** = exige confirmação (13.3). Todos os endpoints de escrita exigem `Idempotency-Key`.

### 13.1 Fase de leitura (primeiro a entrar)

| Método e rota | Scope | Função de domínio |
|---|---|---|
| `GET /health` | — (sem dados) | ping de banco |
| `GET /me` | `me:read` | principal: client, chave, scopes, usuário delegado |
| `GET /openapi.json` | `me:read` | registro OpenAPI |
| `GET /clients?search=&status=&competence=&cursor=` | `clients:read` | Prisma escopado + `getClientStatusesForCompetence` (status **da competência**) |
| `GET /clients/{id}` | `clients:read` | cadastro + `getClientSummaries` + `getScheduledStatusChanges` |
| `GET /clients/{id}/status-timeline` | `clients:read` | `getClientStatusTimeline` |
| `GET /clients/{id}/billings?from=&to=` | `billing:read` | cobranças do cliente |
| `GET /billings?competence=&status=&clientId=` | `billing:read` | mesma base da grade de Recebimentos (sem gerar cobrança na leitura) |
| `GET /receivables/summary?competence=` | `billing:read` | `getReceiptsSummary` |
| `GET /delinquency` | `billing:read` | `getDelinquentClients` (aging) + `getCollectionQueue` |
| `GET /expenses?from=&to=&status=` · `GET /expenses/summary?competence=` | `expenses:read` | despesas + `getExpenseSummary` |
| `GET /cash/summary` · `GET /cash/projection?days=30` | `cash:read` | `getCashSummary`, `projecaoDeCaixa` |
| `GET /dashboard/metrics?periodo=&mes=` | `dashboard:read` | `computePeriodMetrics` (chaves do dicionário oficial, com política de nulo) |
| `GET /dashboard/evolution?anchor=&year=` | `dashboard:read` | `getDashboardEvolution` |
| `GET /renewals?competence=` · `GET /renewals/upcoming?days=30` | `renewals:read` | `renewalLedgerMonth`, `upcomingRenewals` |
| `GET /upsells?status=` · `GET /upsells/kpis` | `upsell:read` | Prisma escopado + `getUpsellKpis` |
| `GET /routine/today` | `routine:read` | `rotinaDoDia(hoje)` — **exige a extração (P2)** |
| `GET /reports` · `GET /reports/{key}?…filtros` | `reports:read` | `REPORTS[key].build(parseReportQuery)` + `canViewReport` |
| `GET /projections/portfolio?ahead=6` · `GET /projections/annual?year=` | `projections:read` | `getPortfolioProjection`, `getAnnualPanel` |
| `GET /events?after=&types=` | `events:read` | feed do `OutboxEvent` |
| `GET /identities/resolve?channel=whatsapp&address=` | `identities:resolve` | `UserChannelIdentity` |

> ⚠️ **Nenhuma leitura pode escrever.** Hoje a página de Recebimentos chama `ensureMonthlyBillings` e `markOverdueBillings` ao carregar. O endpoint `GET /billings` **não** faz isso. A materialização fica em job ou em escrita explícita, pela regra "não escrever durante leitura".

### 13.2 Fase de escrita (depois das extrações)

| Método e rota | Scope | Função de domínio | Confirmação |
|---|---|---|---|
| `POST /billings/{id}/payments` `{amount, paidAt, method, accountId?, notes?}` | `payments:write` | `settleBilling` (idempotência: `externalSource="api:<client>"`, `externalId=Idempotency-Key`) | **(C)** |
| `POST /billings/{id}/collection-contacts` `{channel, note, outcome}` | `collection:write` | `registerBillingContact` extraído | não |
| `POST /billings/{id}/promises` `{promisedDate, note}` | `collection:write` | `registrarPromessa` | não |
| `POST /clients/{id}/status-changes` `{status, effectiveFrom, reason}` | `clients:status:write` | `changeClientStatus(input, caps)` | **(C)** |
| `DELETE /clients/{id}/status-changes/{effectiveFrom}` | `clients:status:write` | `cancelScheduledStatusChange` | **(C)** |
| `POST /expenses/{id}/pay` `{paidAt?}` | `expenses:pay` | `expense-engine.setExpenseStatus` | **(C)** |
| `POST /routine/items/{key}/done` · `…/dismiss` | `routine:write` | `concluirItem` / `dispensarItem` extraídos | não |
| `POST /confirmations/{id}/execute` · `POST /confirmations/{id}/reject` · `GET /confirmations/{id}` | `confirmations:execute` | 13.3 | — |

### 13.3 Confirmação em duas etapas (humano no circuito)

Para toda operação **(C)**, o endpoint **não executa** a operação. Ele cria uma `PendingAction`:

```prisma
model PendingAction {
  id           String   @id @default(cuid())
  clientId     String
  actingUserId String?                         // delegado (quem vai confirmar)
  operation    String                          // "payments.register"
  payload      Json                            // DTO já validado (o que será executado)
  payloadHash  String
  summary      String                          // texto humano: "Registrar R$ 1.500,00 de Alpha (Set/2026), pago hoje via Pix"
  state        String                          // PENDING | CONFIRMED | REJECTED | EXPIRED | EXECUTED | FAILED
  expiresAt    DateTime @db.Timestamptz(3)     // +10 min
  result       Json?
  ownerId      String?
  createdAt    DateTime @default(now()) @db.Timestamptz(3)
  decidedAt    DateTime? @db.Timestamptz(3)
}
```

**Fluxo:**

1. O agente chama `POST /billings/{id}/payments`.
2. A API valida tudo (permissão, período fechado, valores) **sem executar** e responde `202` com `{confirmationId, summary, expiresAt}`.
3. O n8n mostra o `summary` no WhatsApp e espera "SIM".
4. O n8n chama `POST /confirmations/{id}/execute`, e a API executa **o payload gravado**, não um reenviado.
5. A confirmação é de uso único, e a execução passa pela mesma função de domínio e pela mesma idempotência.

**Regras da confirmação:**

- Só o mesmo usuário delegado confirma, e dentro do prazo.
- Se a validação mudar entre a criação e a execução (por exemplo, o período foi fechado), a execução falha com erro claro.
- Os três passos (criar, decidir, executar) são auditados.

---

## 14. Plano de implementação em fases

Cada fase termina com o fluxo do projeto: testes, lint, tipos, `build:ci`, commit e deploy na main. Toda migration é **aditiva**, e nenhuma fase altera dado existente.

| Fase | Entrega | Pronto quando |
|---|---|---|
| **F0 — Fundação e correções de segurança** (sem endpoint) | Principal no ALS; `guardPermission` fail-closed dentro de requisição (D1); `EngineContext` explícito nos motores (D2); `escopoAtual` lendo o principal (D3); `findOwnedOrThrow` + revisão de update/delete por id (D5); canal de `despesa.paga` corrigido (D12); remover as cópias "2" (D17); atualizar a spec (linha 107) e este plano | Testes provam: sem principal, a guarda **nega** dentro de requisição e libera só em JOB declarado; o webhook do gateway continua funcionando com principal de sistema; a auditoria sai com `origin=API` quando o principal é de API |
| **F1 — Identidade de máquina** | Modelos `ApiClient`, `ApiKey`, `ApiRequestLog`, `ApiIdempotency` (migration aditiva + RLS); `src/lib/api/{auth,endpoint,errors,serialize}`; bypass `/api/v1` no middleware; `GET /health`, `GET /me`; tela Configurações → Integrações (criar, rotacionar, revogar); permissões `integracoes.*` | Chave criada, mostrada uma vez, revogação imediata; 401/403 corretos; `ApiRequestLog` gravando; testes de isolamento por dono (a chave do dono A nunca lê B) |
| **F2 — Leitura** | Endpoints de 13.1, com exceção de `/routine/today`; serializador (dinheiro, datas, mascaramento); paginação; chave de cache com o principal; OpenAPI gerado + `GET /openapi.json` + `docs/api/openapi.json` versionado | Contrato: para cada endpoint, **o mesmo número da interface** (teste compara a saída da API com a função usada pela página); OpenAPI sem divergência (CI) |
| **F3 — Extração de domínio** | Seção 5, P1 e P2: `renovarCliente`, `billing-engine.createBilling` e `restoreBilling`, serviço de recebíveis, `client-service`, expense-engine completo, upsell, contratos, `daily-routine`; as actions passam a chamar as funções extraídas | Suíte atual verde **sem mudar comportamento da interface**; guarda de período e auditoria agora também nos caminhos que contornavam o motor (D8) |
| **F4 — Escrita com confirmação** | `PendingAction` + `/confirmations/*`; endpoints de 13.2; `Idempotency-Key` HTTP + idempotência de domínio; `revalidate*` do domínio após escrita; `GET /routine/today` | Replays devolvem a mesma resposta; pagamento duplo impossível (teste de corrida); a confirmação expira e é de uso único; a interface atualiza após a escrita via API |
| **F5 — Eventos** | Catálogo `outbox/events.ts`; eventos novos (status, renovação, vencidas); `GET /events` (pull); `WebhookSubscription` + canal `n8n` + `entregarNoN8n` (HMAC + timestamp); `/api/cron/outbox` | O n8n recebe eventos por pull com cursor; em push, a assinatura confere e replays são rejeitados; dead-letter visível na tela de Integrações |
| **F6 — n8n + agente WhatsApp** | `integrations/n8n/` (Apêndice B); `UserChannelIdentity` + verificação do telefone; workflows: (1) consulta, só leitura; (2) cobrança assistida com confirmação; (3) alertas por evento | Número não vinculado não lê dados; toda escrita passa por confirmação; testes de ponta a ponta com o ambiente de staging |
| **F7 — Endurecimento** | Rate limit compartilhado por chave; alertas (picos de 401/403, dead-letter, latência); rotação programada de chaves; checklist S20 da spec (webhooks e gateway) aplicado à API; revisão LGPD do que trafega no WhatsApp | Checklist assinado; runbook de incidente (vazamento de chave: revogar → rotacionar → auditar via `ApiRequestLog`) |

**Ordem mínima para o agente útil:** F0 → F1 → F2 permitem um agente só de consulta. F3 → F4 permitem ações com confirmação. F5 e F6 podem começar em paralelo a F3, no modo pull.

---

## 15. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| **Permissão que passa sem conferência** (D1) usada por engano | Escrita sem autorização | Corrigir na F0 **antes** de qualquer rota; teste de regressão dedicado |
| **Agente de IA executar ação errada** (alucinação, ambiguidade de cliente com nomes parecidos) | Pagamento ou status no cliente errado | Confirmação obrigatória com resumo humano (nome, competência, valor); ids explícitos no payload; escrita só com delegação; scopes mínimos |
| **Prompt injection** via dados de clientes (nome ou observação com instruções) ou via mensagem de terceiros | O agente é induzido a agir | O agente não executa sem confirmação humana; número não vinculado não acessa dados; o texto de dados é tratado como dado nos prompts do n8n |
| **Vazamento da chave** (n8n comprometido, log, print) | Acesso aos dados financeiros | Hash no banco; exibição única; escopo mínimo; allowlist de IP; expiração; revogação imediata; `ApiRequestLog` para investigar; formato detectável por varredores de segredo |
| **Dados pessoais e financeiros no WhatsApp** (LGPD) | Exposição de dado sensível | Mascaramento via `canSeeField`; respostas resumidas; não enviar documento/CPF; revisão na F7 |
| **Divergência entre interface e API** por extração incompleta | Números diferentes em cada tela | Nenhum endpoint de escrita antes da extração (F3); testes de contrato comparando API × função da página |
| **Escrita dupla** (retry do n8n, timeout) | Pagamento em dobro | Idempotência HTTP + unicidade de domínio (`externalSource+externalId`) |
| **Cache compartilhado entre chaves** com recortes diferentes | Um recorte vê dados de outro | Principal e scopes na chave de cache (F2); filtro aplicado **dentro** da função, não depois |
| **Update/delete por id de outro dono** (D5) | Alteração cruzada entre donos | `findOwnedOrThrow` obrigatório + teste de isolamento para cada rota de escrita |
| **Limites da Vercel** (cron diário no Hobby; cold start; timeout de função) | Eventos atrasados; lentidão | Modo pull; agendador externo; endpoints leves com paginação; relatórios grandes com limite de linhas |
| **Premissa de workspace único** (D19) | Quebra se surgir um segundo workspace | O `ApiClient` guarda `workspaceId` e `ownerId` explícitos desde o início |
| **Aumento de volume de auditoria e logs** | Custo de banco | Retenção de 90 dias no `ApiRequestLog`; AuditLog só para escritas |
| **Mudança de contrato quebrar workflows n8n** | Automação parada | Versão na URL; OpenAPI versionado; mudança incompatível só em `/v2`; workflows versionados no repositório e testados em staging |

---

## Apêndice A — Classificação das operações para o agente

| Grupo | Operações |
|---|---|
| **A. Leitura liberada** (com scope) | Clientes e timeline de status, cobranças, recebimentos do mês, inadimplência, despesas, caixa e projeção, métricas do dashboard, evolução, renovações, upsell, relatórios (com `canViewReport`), projeções, rotina do dia, eventos |
| **B. Escrita com confirmação humana** (V1) | Registrar pagamento; alterar, programar e cancelar status de cliente; marcar despesa como paga |
| **B'. Escrita sem confirmação** (baixo risco, reversível) | Registrar contato de cobrança; nota; promessa de pagamento; concluir ou dispensar item da rotina |
| **C. NÃO expor inicialmente** (sem scope no catálogo) | `limparSistema`; excluir cliente ou exclusão em massa (`deleteClientsDeep`); usuários e permissões (criar, editar, excluir, senhas); configurações de IA (chave do provedor); login/logout; categorias (modelo global); fechar, reabrir ou fotografar competência; importações e reversão de lote; folha (gerar, aprovar, pagar); **estorno de pagamento** e desfazer liquidação; cancelamento, remoção e ações **em massa** de cobranças; **envio real de mensagem ao cliente** pela régua (`despacharPelaRegua`, em massa); link de pagamento no gateway; formulário público e templates de contrato; documentos; renovação de contrato (até a extração estar madura; candidata à V2 com confirmação); nichos e contas (exclusão e mesclagem) |

## Apêndice B — Versionamento dos workflows n8n

Tudo fica no mesmo repositório:

```
integrations/n8n/
  README.md                 como importar/exportar, variáveis, convenções, ambientes
  .env.example              B2C_API_BASE_URL, B2C_API_KEY (placeholder), B2C_WEBHOOK_SECRET (placeholder)
  workflows/
    agente-whatsapp.consulta.v1.json
    agente-whatsapp.cobranca-assistida.v1.json
    alertas.eventos.v1.json
  credentials/README.md     QUAIS credenciais criar no n8n (NUNCA os valores)
  scripts/
    export.sh               n8n export:workflow --backup --output=workflows/ (ou API do n8n)
    import.sh               n8n import:workflow --separate --input=workflows/
    check-secrets.mjs       falha se um JSON contiver token/segredo/URL com credencial
  CHANGELOG.md
```

**Convenções:**

- **Nome:** `<área>.<propósito>.v<N>.json`.
- **Exportação:** `export.sh`. Os JSONs são normalizados (ids e datas de atualização removidos) para que o diff seja legível.
- **Credenciais:** o n8n exporta só a referência (id e nome) da credencial, nunca o segredo. `check-secrets.mjs` roda no CI (`.github/workflows/ci.yml`) e bloqueia o merge se encontrar `b2c_live_`, `Bearer ` literal ou segredos conhecidos.
- **Ambientes:** a URL base vem de variável do n8n, então o mesmo JSON serve para staging e produção.
- **Mudança de workflow:** passa por PR, como código. Uma mudança incompatível da API cria `v2` do workflow, que convive com o anterior.

## Apêndice C — OpenAPI

- **Fonte única:** os schemas zod de entrada e saída de cada `defineEndpoint`, que já servem para validar. Não existe YAML escrito à mão.
- **Biblioteca:** `@asteasolutions/zod-to-openapi` (compatível com o zod 3 do projeto). É dependência nova, a aprovar na F2.
- **Geração:**
  - `src/lib/api/openapi.ts` registra os endpoints no `defineEndpoint`.
  - `GET /api/v1/openapi.json` serve o documento, com autenticação.
  - `npm run api:openapi` grava `docs/api/openapi.json`.
  - O CI falha se o arquivo commitado divergir do gerado.
- **Conteúdo:**
  - `securitySchemes: bearer`.
  - Scopes descritos por operação (`x-b2c-scope`).
  - Cabeçalho `Idempotency-Key` nas escritas e `x-b2c-confirmation` nas operações (C).
  - Erros como `problem+json` com `code`.
  - Exemplos em português.
- **Uso no n8n:** o nó HTTP Request usa o documento como referência; a coleção pode ser importada em ferramentas como Postman/Insomnia para teste manual.
