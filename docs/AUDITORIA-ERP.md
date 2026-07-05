# B2C Finance — Auditoria Técnica & Plano de Transformação em ERP

> **Data:** 04/07/2026 · **Base:** commit `eb1a502` + Etapa 1 (Clientes)
> **Objetivo:** transformar o B2C Finance em um ERP financeiro gerencial da agência B2C Gestão.
> **Status:** a **Etapa 1 (Clientes)** já foi implementada e está refletida neste documento.

---

## 1. Mapa da arquitetura atual

```
┌─ Next.js 14.2 App Router (Vercel) ─────────────────────────────┐
│                                                                 │
│  middleware.ts (Edge) ── verifica HMAC do cookie b2c_session    │
│  │   público: /login, /api/whatsapp/* · resto: exige sessão     │
│  ▼                                                              │
│  app/ (17 rotas RSC) ──► Server Actions (18 arquivos)           │
│  │   páginas = Server Components; dialogs/filtros = client      │
│  │   filtros via URL searchParams · sem paginação (take N)      │
│  ▼                                                              │
│  lib/services/ (cálculos, motor de importação, regras, faturas) │
│  lib/ai/ (snapshot financeiro → prompt) · lib/whatsapp/ (agente)│
│  lib/pdf/ (parsers Nubank/Itaú/Inter/genérico)                  │
│  ▼                                                              │
│  lib/prisma.ts ── EXTENSÃO DE ISOLAMENTO                        │
│  │   OWNED_MODELS (18 modelos) → injeta ownerId em toda query   │
│  │   fail-closed (__no_owner__) · bypass p/ scripts             │
│  │   fonte do dono: AsyncLocalStorage > cookie (owner-scope.ts) │
│  ▼                                                              │
│  PostgreSQL (Supabase) ── Prisma 5.22 · 26 modelos · 6 migrations│
└─────────────────────────────────────────────────────────────────┘
Auth: JWT próprio (HMAC-SHA256, sem lib), cookie 30d, bcryptjs
Papéis: ADMIN (tudo) / USER (escopo próprio) · requireAdmin/getViewer
IA: provider plugável (OpenAI/Anthropic/compatível) · singleton AISetting
WhatsApp: webhook Z-API/Evolution · runWithOwner(primaryAdmin)
```

### Contratos internos que TODA nova entidade deve respeitar

1. **`OWNED_MODELS`** em `src/lib/prisma.ts` — modelo privado precisa ser registrado no Set,
   senão vaza entre contas. Reads recebem `ownerId` no where; creates recebem `ownerId`
   automático; `findUnique` é pós-filtrado.
2. **Padrão de Server Action** — `"use server"` → Zod → parse de FormData
   (`parseBRL`/`parseDateBR`) → prisma (ownerId implícito) → `revalidatePath`.
   Nunca passar ownerId manualmente.
3. **Permissões** — `getViewer()` (logado) / `requireAdmin()` (admin) de `src/lib/auth/viewer.ts`.
4. **Padrão de tela** — page.tsx (RSC, searchParams) + filters.tsx (client) + dialog.tsx
   (client, form action) + row-actions.tsx + tabela desktop (`hidden md:block`) +
   `MobileCards` no mobile + loading.tsx com `PageSkeleton`.

## 2. Módulos existentes (17 rotas)

| Módulo | Rota | Maturidade |
|---|---|---|
| Dashboard mensal | `/dashboard` | ✅ Completo (KPIs pessoais + gráficos CSS) |
| **Clientes** | `/clientes`, `/clientes/[id]` | ✅ **Novo (Etapa 1)** — CRUD, KPIs, filtros |
| Receitas | `/receitas` | ✅ Completo |
| Despesas | `/despesas` | ✅ Completo |
| Caixa (cashboxes) | `/caixa` | ✅ Completo |
| Movimentações | `/transacoes` | ✅ Read-only + filtros |
| Cartões/Contas | `/cartoes`, `/cartoes/[id]` | ✅ Completo (maior página do app) |
| Importar fatura | `/importar` | ✅ PDF auto-detect + CSV/XLSX, preview→commit |
| Pessoas | `/pessoas`, `/pessoas/[id]` | ✅ Completo (+ texto de cobrança WhatsApp) |
| Metas | `/metas` | ✅ Completo |
| Regras | `/regras` | ✅ Completo |
| Assistente IA | `/assistente` | ✅ Chat + insights + memória |
| Agente WhatsApp | `/whatsapp` | ✅ Admin-only |
| Usuários / Config | `/usuarios`, `/configuracoes` | ✅ Admin-only |
| Faturas / Receber / Fluxo | `/faturas`, `/receber`, `/fluxo-de-caixa` | ⚠️ **Stubs** (só redirect) — rotas livres para reuso |

## 3. Entidades existentes (26 modelos)

- **Núcleo financeiro pessoal:** `Transaction` (status/tipo em *string*, valor *Float*),
  `Income`, `CreditCard`, `AccountCard`, `CreditCardInvoice`, `Installment` (metadado de
  parcela), `Receivable`, `PersonPayment`, `Account`, `CashBox`, `CashBoxMovement`, `Goal`,
  `Category`, `CategorizationRule`, `ImportBatch`, `Person`
- **Plataforma:** `User`, `AISetting`, `AIConversation`, `AIMessage`, `AIMemory`,
  `WhatsAppSetting`, `WhatsAppMessage`
- **Agência (novo):** `Client` + enum `ClientStatus` ✅

## 4. O que pode ser reaproveitado (alto valor)

| Ativo | Reuso no ERP |
|---|---|
| **Extensão de isolamento** (`OWNED_MODELS`) | Base de tenancy de TODOS os novos modelos — só registrar no Set |
| **Motor de importação** (dedup em camadas, batch, zero N+1) | Generalizar para importar Clientes/Contratos/Cobranças da planilha |
| **Parsers PDF + parseImport (xlsx)** | Conciliação bancária; leitura de modelo de planilha |
| **Padrão de tela** (page + filters + dialog + row-actions + MobileCards) | Template de todos os novos módulos (provado na Etapa 1) |
| **Snapshot de IA** (`buildFinancialSnapshot`) | Estender com KPIs de agência → copiloto gerencial |
| **Agente WhatsApp** | Canal de cobrança interativa (já gera texto de cobrança em `people.ts`) |
| **Regras de categorização** | Aplicar a despesas da agência (Tráfego Pago etc. já no seed) |
| `StatCard`, `MonthlyBarChart`, `record-card`, `PageHeader`, skeletons | Dashboard e todos os módulos |
| `calculations.ts` (padrão de agregação paralela) | Modelo para o futuro `agency-metrics.ts` |
| Rotas stub `/faturas`, `/receber`, `/fluxo-de-caixa` | Reaproveitar para Cobranças e Fluxo de Caixa projetado |

## 5. O que precisa ser criado

- **Entidades (ver §9):** Contract, Plan, Service, ContractService, Charge, ChargePayment,
  ChargeHistory, CostCenter, Collaborator, PayrollRun, PayrollItem, Commission, Asset,
  Liability, Loan, Notification.
- **Módulos (ver §10):** Contratos, Cobranças, Folha, Patrimônio, Dashboard gerencial,
  Importação genérica com geração de modelo, **Exportação (não existe NADA de export hoje)**,
  Relatórios, Notificações.
- **Infra de UI faltante:** toast (feedback de mutation), dropdown-menu, date-range picker,
  combobox com busca, paginação, gráfico de linha/pizza (hoje só barra CSS).

## 6. O que precisa ser refatorado (dívidas, em ordem de urgência)

| # | Dívida | Risco | Ação |
|---|---|---|---|
| R1 | **10 arquivos de actions sem `getViewer`/`requireAdmin`** (transactions, expenses, incomes, cards, cashboxes, categories, goals, receivables, rules, account-cards e `payInvoice`/`setInvoiceStatus`) — dependem só do middleware + escopo | Segurança (defesa em profundidade) | Adicionar check padrão em 1 passada |
| R2 | **Dinheiro em `Float`** nos modelos legados | Erro de arredondamento contábil | Novos = Decimal (já adotado); migrar legado em etapa dedicada |
| R3 | **Sem try/catch nas mutations legadas** (erro vaza como exceção crua) | UX | Adotar `ActionResult` (padrão da Etapa 1) gradualmente |
| R4 | Status/tipos em string solta (`"pago"`, `"aberta"`) | Inconsistência (o problema da planilha!) | `lib/enums.ts` central + enums Prisma nos novos |
| R5 | Lógica HMAC duplicada em `session.ts` e `middleware.ts`; fallback de secret hardcoded | Segurança em prod | Unificar + exigir `SESSION_SECRET` em produção |
| R6 | Webhook WhatsApp sem verificação de assinatura; reminders com secret em query string | Segurança | Endurecer quando cobrança via WhatsApp virar core |
| R7 | Listas sem paginação (`take: N` fixo) | Escala com dados de agência | Componente de paginação por cursor |
| R8 | Categorias são **globais** (sem ownerId) | Colisão multiusuário | Avaliar na Etapa 5 (centro de custo separa isso) |

## 7. Riscos técnicos

1. **Banco de produção compartilhado** — dev local aponta para o Supabase real com 6 usuários
   ativos. *Mitigação: criar branch/banco de dev antes das próximas migrations.*
2. **Migrations em produção** — mitigado pelo processo da Etapa 1
   (`migrate diff` → revisão do SQL → `migrate deploy`, sempre aditivo).
3. **Competência × caixa** — o sistema atual só conhece caixa. A introdução de `Charge`
   (competência) exige disciplina nos KPIs para nunca somar os dois.
   *Mitigação: nomenclatura explícita (`expected*` vs `received*`) no serviço de métricas.*
4. **MRR provisório** — `Client.monthlyValue` (Etapa 1) será suplantado pelo contrato;
   manter como fallback documentado até a Etapa 3.
5. **Tenancy por admin (decisão D4)** — dois ADMINs não compartilham carteira.
   Aceito por decisão; revisitar se o time crescer.
6. **Next 14.2 desatualizado** — sem urgência, mas upgrade futuro (15) muda
   `searchParams`/caching; não fazer no meio do projeto.

## 8. Ordem ideal de desenvolvimento

`Clientes ✅ → Serviços/Planos → Contratos (MRR/TCV) → Cobranças/Pagamentos (inadimplência)
→ Despesas+CentroCusto (rentabilidade) → Folha/Comissões → Ativos/Passivos/Projeção
→ Dashboard gerencial → Importação em massa → Exportação/Relatórios → Notificações → IA evoluída`

Racional: cada etapa só depende das anteriores; KPIs destravam progressivamente; o dashboard
consolidado vem **depois** que os dados existem; importação vem depois que as entidades-alvo
existem (para gerar os modelos de planilha); IA por último porque lê tudo.

## 9. Proposta de modelagem do banco (novas entidades)

Todas: `ownerId` + `@@index([ownerId])` + registro em `OWNED_MODELS` + dinheiro em
`Decimal(14,2)` + enums nativos do Prisma.

```prisma
// ── Comercial ──────────────────────────────────────────────
Service   { id name description defaultPrice? active }
Plan      { id name description monthlyPrice setupFee? active }
Contract  { id clientId planId? title status(DRAFT|ACTIVE|PAUSED|
            RENEWAL_PENDING|ENDED|CANCELED) billingCycle(MONTHLY|
            QUARTERLY|SEMIANNUAL|ANNUAL|ONE_TIME) monthlyValue
            totalValue(TCV) setupFee? startDate endDate? renewalDate?
            billingDay(1-28) autoRenew notes }
ContractService { contractId serviceId unitPrice quantity }   // N:N

// ── Cobrança (competência) ─────────────────────────────────
Charge    { id clientId contractId? description competenceMonth
            competenceYear amount dueDate status(OPEN|PARTIAL|PAID|
            OVERDUE|CANCELED) type(RECURRING|NEW|ONE_OFF) paidTotal
            incomeId? }              // liga ao caixa quando recebida
ChargePayment { chargeId amount paidAt method(PIX|TRANSFER|BOLETO|
            CARD|CASH|OTHER) accountId? notes }
ChargeHistory { chargeId kind(CREATED|REMINDER_SENT|CONTACTED|
            PROMISE|PARTIAL|PAID|RENEGOTIATED|NOTE) message at }

// ── Custos e resultado ─────────────────────────────────────
CostCenter { id name kind(CLIENT|SERVICE|INTERNAL) clientId? serviceId? }
// Transaction/Income ganham: costCenterId?, clientId?; Transaction
// ganha expenseKind(FIXED|VARIABLE)?  ← migration aditiva

// ── Pessoas e folha ────────────────────────────────────────
Collaborator { id name role type(CLT|PJ|FREELA) baseSalary active
            personId? startedAt endedAt? }
PayrollRun  { id month year status(DRAFT|APPROVED|PAID) paidAt? }
PayrollItem { runId collaboratorId kind(SALARY|BONUS|COMMISSION|
            BENEFIT|DEDUCTION) amount notes }
Commission  { id collaboratorId clientId? contractId? basis amount
            month year status(PENDING|APPROVED|PAID) }

// ── Patrimônio ─────────────────────────────────────────────
Asset     { id name type(CASH|RECEIVABLE|EQUIPMENT|INVESTMENT|OTHER)
            value acquiredAt? notes }
Liability { id name type(LOAN|TAX|SUPPLIER|CARD_DEBT|OTHER) totalValue
            remainingValue dueDate? installments? monthlyPayment? }
Loan      { id liabilityId? lender principal interestRate installments
            firstDueDate installmentValue }

// ── Plataforma ─────────────────────────────────────────────
Notification { id kind(CHARGE_DUE|CHARGE_OVERDUE|CONTRACT_RENEWAL|
            LOW_CASH|GOAL|CUSTOM) title body refId? readAt? dueAt? }
```

### Fórmulas-chave dos KPIs

- `MRR ativo = Σ Contract.monthlyValue (status ACTIVE)`
- `TCV = Σ Contract.totalValue no período de venda`
- `Inadimplência = Σ Charge OVERDUE / Σ esperado no período`
- `Churn = clientes CHURNED no mês / ativos no início do mês`
- `Ticket médio = MRR ativo / clientes ativos`
- `Margem operacional = (receita recebida − despesas − folha) / receita recebida`
- `% folha = folha total / receita recebida`
- `Rentabilidade cliente = Σ recebido(cliente) − Σ custos(costCenter do cliente)`
- `Projeção de caixa = caixa atual + charges a receber − despesas/folha/passivos a pagar`

## 10. Proposta de módulos + 11. Sugestão de rotas

| Módulo | Rotas | Conteúdo |
|---|---|---|
| Clientes ✅ | `/clientes`, `/clientes/[id]` | Detalhe ganha abas: contratos, cobranças, rentabilidade |
| Catálogo | `/servicos` | Serviços e planos (tabs) |
| Contratos | `/contratos`, `/contratos/[id]` | Ciclo de vida, MRR/TCV, renovações |
| Cobranças | `/cobrancas`, `/cobrancas/[id]` | Geração recorrente, kanban por status, cobrança interativa (texto WhatsApp + histórico) |
| Financeiro atual | `/receitas`, `/despesas`, `/caixa`, `/transacoes` | Mantidos; despesas ganham centro de custo/fixa-variável |
| Folha | `/folha`, `/folha/[runId]`, `/colaboradores` | Runs mensais, itens, comissões |
| Patrimônio | `/patrimonio` | Ativos, passivos, empréstimos (tabs) |
| Fluxo projetado | `/fluxo-de-caixa` (reusa stub!) | Projeção: caixa + cobranças a receber − despesas/folha a pagar |
| Dashboard | `/dashboard` | Visão ADMIN = gerencial da agência (período dia/semana/mês/tri/ano); USER mantém visão pessoal |
| Importação | `/importar` (+ tab "Dados") | Download de modelo XLSX por entidade → upload → preview → commit (motor existente) |
| Relatórios | `/relatorios` | Por módulo, filtros, export CSV/XLSX/PDF |
| Notificações | sino no shell + `/notificacoes` | Vencimentos, renovações, inadimplência |

## 12. Componentes reutilizáveis a criar

- `MoneyInput` (máscara BRL)
- `DateRangeFilter` (dia/semana/mês/tri/ano — coração dos dashboards)
- `EntityCombobox` (select com busca p/ cliente/contrato)
- `StatusBadge` genérico (enum→label/variant, generaliza `_meta.ts` da Etapa 1)
- `KpiGrid` · `TrendChart` (linha) · `DonutChart` (composição de despesas)
- `Paginator` (cursor)
- `ExportButton` (CSV/XLSX server-side)
- `Timeline` (histórico de cobrança)
- `useActionFeedback` + toast (padroniza `ActionResult`)
- `EmptyState` unificado

## 13. Plano incremental de implementação

| Etapa | Entrega | Migration | KPIs destravados |
|---|---|---|---|
| ~~1~~ ✅ | Clientes | `add_client_module` (aplicada) | ativos, novos, inadimplentes, MRR base |
| 2 | Serviços & Planos + toast/`ActionResult` global | aditiva | catálogo |
| 3 | Contratos + renovações | aditiva | **MRR, TCV**, ticket médio, renovações |
| 4 | Cobranças + Pagamentos + histórico + geração recorrente | aditiva | esperado/recebido/vencido, **inadimplência**, aging |
| 5 | Centro de custo + despesa fixa/variável + vínculo cliente | aditiva (2 colunas) | rentabilidade/cliente e serviço, custo médio |
| 6 | Colaboradores + Folha + Comissões | aditiva | folha total, % folha/receita |
| 7 | Ativos/Passivos/Empréstimos + fluxo projetado | aditiva | projeção de caixa, balanço |
| 8 | Dashboard gerencial (`agency-metrics.ts`) + `DateRangeFilter` | — | **todos os 28 KPIs consolidados** |
| 9 | Importação em massa (modelo XLSX por entidade) | — | migração da planilha |
| 10 | Exportação + Relatórios | — | relatórios personalizados |
| 11 | Notificações/alertas | aditiva | alertas proativos |
| 12 | IA gerencial (snapshot estendido + ações de cobrança) | — | copiloto de decisão |
| 13 | **Hardening** (R1, R3, R5–R7) | — | segurança/robustez |

> **Recomendação forte antes da Etapa 2:** criar **banco de desenvolvimento** separado
> (risco #1), para as próximas migrations não rodarem direto em produção.

---

### Decisões de arquitetura registradas

- **D1 — Decimal:** novos campos monetários em `Decimal(14,2)`; legado Float migra depois.
- **D2 — Enums:** novas entidades com enums nativos; strings legadas padronizadas via `lib/enums.ts`.
- **D3 — Charge ≠ CreditCardInvoice:** cobrança ao cliente é entidade própria.
- **D4 — Tenancy:** dados da agência pertencem à conta ADMIN (ownerId normal). Time compartilhado fica para o futuro.
- **D5 — Reuso:** `Income` = caixa recebido; `Charge` = competência esperada; `Transaction` estendida, não substituída.
