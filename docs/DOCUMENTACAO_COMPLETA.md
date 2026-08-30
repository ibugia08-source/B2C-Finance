# B2C Finance — Documentação Completa do Sistema

> ERP financeiro da agência **B2C Gestão**, construído no modelo da planilha mensal do dono.
> Documento de referência: o que o sistema faz, todos os campos, todas as funcionalidades,
> tudo que pode alimentá-lo, todas as métricas e capacidades.
>
> Gerado a partir do código-fonte em 29/08/2026. Complementa (não substitui):
> [SPEC.md](../SPEC.md) · [README.md](../README.md) ·
> [ARQUITETURA_FINANCEIRA.md](ARQUITETURA_FINANCEIRA.md) ·
> [METRICAS_FINANCEIRAS.md](METRICAS_FINANCEIRAS.md) ·
> [PLANO_DE_CONTAS_GERENCIAL.md](PLANO_DE_CONTAS_GERENCIAL.md) ·
> [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)

---

## Índice

1. [O que é o sistema](#1-o-que-é-o-sistema)
2. [Stack e arquitetura](#2-stack-e-arquitetura)
3. [Segurança, autenticação e multiusuário](#3-segurança-autenticação-e-multiusuário)
4. [Papéis e permissões (RBAC completo)](#4-papéis-e-permissões-rbac-completo)
5. [Mapa de rotas e navegação](#5-mapa-de-rotas-e-navegação)
6. [Módulos — funcionalidades detalhadas](#6-módulos--funcionalidades-detalhadas)
7. [Regras de negócio financeiras (o núcleo contábil)](#7-regras-de-negócio-financeiras-o-núcleo-contábil)
8. [Dicionário de métricas](#8-dicionário-de-métricas)
9. [Modelo de dados completo (55 tabelas)](#9-modelo-de-dados-completo-55-tabelas)
10. [Enums / valores possíveis](#10-enums--valores-possíveis)
11. [Como alimentar o sistema (todas as entradas de dados)](#11-como-alimentar-o-sistema-todas-as-entradas-de-dados)
12. [Saídas: relatórios, exportação e documentos](#12-saídas-relatórios-exportação-e-documentos)
13. [Assistente de IA](#13-assistente-de-ia)
14. [Operação: ambiente, deploy, scripts e performance](#14-operação-ambiente-deploy-scripts-e-performance)
15. [Capacidades, limites e pendências conhecidas](#15-capacidades-limites-e-pendências-conhecidas)

---

## 1. O que é o sistema

O B2C Finance é um **ERP financeiro e comercial para agência de marketing**, desenhado para
substituir a planilha mensal do dono sem perder a lógica dela. Ele cobre a espinha completa:

```
Cliente → Contrato (acordo) → Cobrança (competência) → Pagamento → Receita (caixa)
                                    ↓
                   Despesa · Folha · Comissão · Caixa/Reservas → Resultado
```

**As duas telas-âncora** (as duas abas da planilha original):

| Tela | Rota | O que é |
|---|---|---|
| **Gestão do Mês** | `/cobrancas` | A "aba do mês": clientes do mês com pagamento em 1 clique (🟢 Pago / 🟡 A vencer / 🔴 Devendo, com Desfazer), recebimentos, contas a pagar, folha e renovações — tudo numa página |
| **Painel Anual** | `/projecoes` | A "aba do ano": indicadores × JAN..DEZ + acumulado + meta anual + simulador de cenários |

Ao redor delas: carteira de clientes, renovações auditáveis, upsell em Kanban, contratos
(modelos DOCX + geração + link público de formulário), inadimplência com fila priorizada,
folha e comissões, contas a pagar com cartões e importação de faturas, 18 relatórios
exportáveis, importação em massa por planilha, rotina diária operacional e um assistente
de IA com contexto real da agência.

**Filosofia de dados (invariantes que atravessam todo o sistema):**

- **TCV nunca é rateado.** Entra cheio no mês da adesão/fechamento/renovação.
- **MRR** = Σ `Client.monthlyValue` dos clientes `modality=MRR` ativos no mês — não depende de a cobrança existir.
- **Receita Extra é apenas manual.** Nada gera receita extra automaticamente.
- **Pagamento de mês anterior recebido depois = recuperação de inadimplência**: conta no mês do pagamento; o mês original permanece em aberto no fechamento gerencial.
- **Nenhuma tela de leitura escreve no banco** (exceto manutenções throttled explícitas).
- **Cliente nunca é apagado por gesto de mês**: remover do ciclo do mês ≠ excluir cliente.

---

## 2. Stack e arquitetura

| Camada | Tecnologia |
|---|---|
| Framework | **Next.js 14** (App Router, Server Components + Server Actions) |
| Linguagem | TypeScript 5 |
| UI | React 18 · Tailwind CSS 3 · Radix UI · lucide-react · Recharts (lazy) |
| ORM / Banco | **Prisma 5** + **PostgreSQL** (Supabase) |
| Validação | Zod (`safeParse` em toda server action) |
| Arquivos | Supabase Storage (produção) · disco `.uploads/` (dev) |
| Planilhas / PDF / DOCX | `xlsx` · `pdf-parse` · `docxtemplater` + `pizzip` (somente server) |
| Auth | Própria: cookie HMAC-SHA256 `b2c_session` + middleware Edge |
| Hospedagem | Vercel, região `gru1` (São Paulo) |

**Padrão fundamental:** *Server Components para leitura, Server Actions para mutação.*
Não existem API routes de dados — apenas 3 rotas de download de arquivo
(`/api/arquivos/contrato|documento|modelo/[id]`) e 2 rotas utilitárias
(`/relatorios/[tipo]/export`, `/importacoes/template`).

### Organização de pastas

```
src/app/            páginas por domínio (uma pasta por rota)
src/lib/actions/    server actions (mutações; Zod; revalidação de cache)   — 30 arquivos
src/lib/services/   queries e métricas (leitura)                            — 22 arquivos
src/lib/reports/    registry + 18 definições de relatório
src/lib/imports/    motor + definições de importação em massa
src/lib/pdf/        parser de faturas de cartão (5 layouts + genérico)
src/lib/docx/       motor de modelos de contrato ({{variáveis}})
src/lib/auth/       sessão, usuário atual, escopo multiusuário
src/lib/financial/  cálculos puros (projeções, vencimentos, barrel de métricas)
src/components/     compartilhados (ui/ = design system)
prisma/             schema (55 models), 24 migrations, seed
docs/               documentação de domínio
scripts/            tooling de dev
```

### Camadas de cálculo

| Arquivo | Responsabilidade |
|---|---|
| `services/dashboard-main.ts` | 5 métricas principais, séries anuais, detalhes dos cards, resumo textual |
| `services/revenue-metrics.ts` | **Regras oficiais** MRR/TCV, recebimentos, renovações, churn, perdas |
| `services/finance-metrics.ts` | Resultado caixa, folha, caixa/reservas, patrimônio |
| `services/expense-metrics.ts` | Resumo de despesas do mês + limites de cartão |
| `services/billing-metrics.ts` | Vencidos, aging, inadimplentes (visão global) |
| `services/client-metrics.ts` | Inadimplência do mês por cliente, risco individual |
| `services/contract-metrics.ts` | MRR/TCV **contratual** (base `Contract`) e geração de cobranças |
| `services/receivables-cycle.ts` | Ciclo mensal: quem entra no mês, status derivado da linha |
| `services/payment-accounting.ts` | **Núcleo contábil** do pagamento (settle/revert) |
| `services/renewal-metrics.ts` | Painel de renovações + previsibilidade |
| `services/collection-priority.ts` | Fila de cobrança com score e tom sugerido |
| `services/annual-panel.ts` | Painel Anual (indicador × 12 meses) |
| `services/dashboard-metrics.ts` | Orquestrador executivo: saúde, alertas, séries 12m, breakdowns |
| `services/upsell-metrics.ts` | KPIs do funil de upsell |
| `financial/projections.ts` | Simulação de cenários (funções puras) |
| `financial/due-date.ts` | `getValidDueDateForMonth` — **único** ponto de clamp de fim de mês |

> ⚠️ **Duas famílias de MRR/TCV coexistem de propósito**: *contratual* (`contract-metrics.ts`,
> base `Contract`) ≠ *de faturamento* (`revenue-metrics.ts`, base `Client`/`Billing`).
> Não são a mesma coisa e não devem ser unificadas sem decisão explícita.

### Cache e invalidação

- Toda leitura pesada usa o helper **`ownerCached`** (`lib/owner-cache.ts`), que resolve o
  `ownerId` na request, coloca-o na chave (sem vazamento entre contas) e fixa o escopo dentro
  do callback. `unstable_cache` cru já causou dashboard zerado em produção.
- Invalidação **só** pelos helpers de domínio (`lib/revalidate.ts`):
  `revalidateFinance()` · `revalidateAgency()` · `revalidateCatalog()` · `revalidatePayroll()` ·
  `revalidateAdmin()` · `revalidateAssistant()`.
- Tags de cache centralizadas em `lib/cache-tags.ts`.
- Resultados cacheados são serializados em JSON → campos `Date` voltam como *string*
  (`formatDateBR()` aceita os dois).

---

## 3. Segurança, autenticação e multiusuário

### Sessão

- Cookie **httpOnly `b2c_session`** no formato `payload.assinatura`.
  `payload` = Base64URL de `{ uid, role, own?, exp }`; assinatura HMAC-SHA256 com `SESSION_SECRET`.
- TTL padrão **30 dias**.
- **Fail-closed**: sem `SESSION_SECRET` em produção, o boot falha (nada de fallback no repositório).
- Middleware Edge valida presença/formato/expiração do token; a validação completa (HMAC + banco)
  acontece em `getCurrentUser()` nas páginas de servidor.
- Toda server action (exceto login/logout e o formulário público) começa com um guard:
  `getViewer()` / `requirePermission()` / `requirePagePermission()` / `tryPermission()`.

### Proteções anti-abuso

| Proteção | Onde | Regra |
|---|---|---|
| Rate limit de login por IP | `middleware.ts` (memória Edge) | 10 tentativas / 60s |
| Bloqueio por conta | `User.failedLogins` + `User.lockedUntil` | falhas seguidas → bloqueio temporário persistente |
| Hash de senha | `bcryptjs` | `passwordHash` |
| Cabeçalhos HTTP | `vercel.json` | CSP restritiva, HSTS 2 anos, X-Frame-Options SAMEORIGIN, nosniff, Referrer-Policy, Permissions-Policy |
| RLS no Postgres | migrations | toda tabela nova recebe `ENABLE ROW LEVEL SECURITY`; `anon`/`authenticated` sem GRANT |
| Download de arquivo | `/api/arquivos/*` | exige sessão; metadados resolvidos no servidor |

### Isolamento multiusuário (`ownerId`)

Uma **extensão do Prisma** (`lib/prisma.ts`) injeta `ownerId` automaticamente em toda query de
entidade privada, resolvendo o dono pelo cookie da sessão. Consequências:

- Em páginas e actions: **nunca** passar `ownerId` manualmente.
- Em scripts (sem cookie): usar `runWithOwner(id, fn)` ou `runWithoutScope(fn)`.
- Sem sessão o escopo é **fail-closed** (retorna vazio) — por isso o cache usa `ownerCached`.
- Modelos **globais** de propósito: `Category`, `AISetting`, `UserPermission`, `ContractFormLink`
  (lookup por token opaco acontece sem sessão; `runWithOwner` fixa o dono no restante do fluxo).

### Equipe / workspace

`User.workspaceOwnerId` permite que um membro enxergue os dados do dono da conta.
`null` = o próprio usuário é o dono do workspace.

---

## 4. Papéis e permissões (RBAC completo)

Fonte única: `src/lib/permissions.ts`. Ids no formato `modulo.acao`, em português.

**Regras de resolução** (nesta ordem): sem usuário → nega · `ADMIN` → permite sempre
(não configurável) · ajuste fino do usuário (`UserPermission`) vence o papel · senão, o padrão do papel.
Só as **diferenças** vs. o papel são gravadas — restaurar padrão = apagar as linhas.

### Papéis

| Papel | Rótulo | Descrição |
|---|---|---|
| `ADMIN` | Administrador | Acesso total a todos os módulos e configurações |
| `GESTOR` | Gestor | Operação ampla, sem exclusões nem gestão de usuários |
| `FINANCEIRO` | Financeiro | Recebimentos, despesas, caixa (ver) e relatórios |
| `ADMINISTRATIVO` | Administrativo | Cadastro de clientes, acompanhamento e rotina |
| `COMERCIAL` | Comercial | Clientes, contratos, upsell e catálogo |
| `COBRANCA` | Cobrança / Atendimento | Recebimentos, mensagens e rotina |
| `USER` | Usuário (legado) | Acesso mínimo (Assistente + Dashboard) |

### Catálogo completo de permissões (17 módulos · 63 permissões)

| Módulo | Permissões (🔒 = sensível) |
|---|---|
| **Assistente IA** | `assistente.visualizar` |
| **Dashboard** | `dashboard.visualizar` · 🔒 `dashboard.ver_financeiro` (resultado, margem, caixa) |
| **Clientes** | `clientes.visualizar` · `clientes.criar` · `clientes.editar` · `clientes.alterar_status` · `clientes.anexar_documentos` · 🔒 `clientes.ver_dados_financeiros` · 🔒 `clientes.excluir` |
| **Recebimentos** | `recebimentos.visualizar` · `recebimentos.registrar_pagamento` · `recebimentos.gerar_cobranca` · `recebimentos.editar` · `recebimentos.alterar_vencimento` · `recebimentos.ver_inadimplencia` · 🔒 `recebimentos.excluir` |
| **Despesas** | `despesas.visualizar` · `despesas.criar` · `despesas.editar` · `despesas.marcar_como_paga` · 🔒 `despesas.excluir` |
| **Receita Extra** | `receitas.visualizar` · `receitas.criar` · `receitas.editar` · 🔒 `receitas.excluir` |
| **Reservas (caixa)** | 🔒 `caixa.visualizar` · 🔒 `caixa.lancar` · 🔒 `caixa.editar` · 🔒 `caixa.excluir` |
| **Contratos** | `contratos.visualizar` · `contratos.criar` · `contratos.editar` · `contratos.gerar_contrato` · `contratos.baixar_contrato` · 🔒 `contratos.excluir` |
| **Upsell** | `upsell.visualizar` · `upsell.criar` · `upsell.editar` · `upsell.marcar_vendido` · 🔒 `upsell.excluir` |
| **Folha** | 🔒 `folha.visualizar` · 🔒 `folha.editar` |
| **Serviços** | `servicos.visualizar` · `servicos.gerenciar` |
| **Planos (Ofertas)** | `ofertas.visualizar` · `ofertas.gerenciar` |
| **Rotina diária** | `rotina.visualizar` · `rotina.registrar_pagamento` · `rotina.gerar_cobranca` · `rotina.concluir_acao` |
| **Relatórios** | `relatorios.visualizar` · 🔒 `relatorios.exportar` |
| **Projeções** | `projecoes.visualizar` |
| **Importar dados** | `importacoes.visualizar` · 🔒 `importacoes.importar` |
| **Regras de categoria** | `regras.visualizar` · `regras.gerenciar` |
| **Usuários** | 🔒 `usuarios.visualizar` · 🔒 `usuarios.criar` · 🔒 `usuarios.editar` · 🔒 `usuarios.excluir` · 🔒 `usuarios.alterar_permissoes` |
| **Configurações** | `configuracoes.visualizar` · 🔒 `configuracoes.editar` |

### Efeito prático das permissões na interface

- **Sidebar / menu mobile**: cada item exige a permissão de visualizar do módulo (`visibleNavItems`).
- **Gestão do Mês e Rotina Diária**: cada *seção* só aparece — **e só consulta o banco** — se o
  usuário tem acesso ao módulo de origem (padrão de "gates").
- **Dashboard**: sem `dashboard.ver_financeiro`, o usuário vê um dashboard pessoal reduzido.
- **Gestos inline** (selects em tabela): usam `tryPermission` e devolvem
  `{ ok:false, error }` em vez de redirecionar — o usuário não perde mês, filtros nem seleção.
- **Páginas e diálogos**: `requirePagePermission` redireciona para `/acesso-restrito`.

---

## 5. Mapa de rotas e navegação

### Menu (sidebar desktop · barra inferior + gaveta "Mais" no mobile)

| Seção | Rota | Item | Permissão | Atalho mobile |
|---|---|---|---|---|
| — | `/dashboard` | Dashboard | `dashboard.visualizar` | ✅ |
| — | `/cobrancas` | **Gestão do Mês** | `recebimentos.visualizar` | ✅ |
| Operação | `/clientes` | Clientes | `clientes.visualizar` | ✅ |
| Operação | `/despesas` | Contas a Pagar | `despesas.visualizar` | ✅ |
| Operação | `/folha` | Folha | `folha.visualizar` | |
| Operação | `/rotina` | Rotina Diária | `rotina.visualizar` | |
| Comercial | `/contratos` | Contratos | `contratos.visualizar` | |
| Comercial | `/renovacoes` | Renovações | `clientes.visualizar` | |
| Comercial | `/upsell` | Upsell | `upsell.visualizar` | |
| Comercial | `/servicos` | Serviços | `servicos.visualizar` | |
| Comercial | `/ofertas` | Planos (Ofertas) | `ofertas.visualizar` | |
| Análise | `/projecoes` | **Painel Anual** | `projecoes.visualizar` | |
| Análise | `/relatorios` | Relatórios | `relatorios.visualizar` | |
| Análise | `/caixa` | Reservas (Caixa) | `caixa.visualizar` | |
| Análise | `/assistente` | Assistente IA | `assistente.visualizar` | |
| Sistema | `/importacoes` | Importar dados | `importacoes.visualizar` | |
| Sistema | `/regras` | Regras de Categoria | `regras.visualizar` | |
| Sistema | `/usuarios` | Usuários | `usuarios.visualizar` | |
| Sistema | `/configuracoes` | Configurações | `configuracoes.visualizar` | |

### Rotas fora do menu (acessíveis por link)

| Rota | O que é |
|---|---|
| `/inadimplencia` | Aba dentro do hub de recebimentos (aging, fila de cobrança) |
| `/acordos` | Acordos comerciais (contratos MRR/TCV que geram cobranças) |
| `/receitas` | Histórico completo de receitas/Receita Extra (a seção "Recebimentos do Mês" vive na Gestão do Mês) |
| `/cartoes` e `/cartoes/[id]` | Cartões/contas de cartão e detalhe da fatura |
| `/clientes/[id]` | Área do cliente (8 abas) |
| `/contratos/[id]` e `/contratos/[id]/gerar` | Modelo de contrato e assistente de geração |
| `/relatorios/[tipo]` | Relatório específico (18 tipos) |
| `/transacoes`, `/pessoas`, `/pessoas/[id]`, `/pagamentos` | Rotas legadas de finanças pessoais; lógica compartilhada mantida |
| `/f/[token]` | **Formulário público de contrato** (sem login) |
| `/login`, `/acesso-restrito` | Autenticação e tela de acesso negado |

### Padrões de interface transversais

| Padrão | Onde vive | Comportamento |
|---|---|---|
| Seletor de competência | `components/month-nav.tsx` | ◀ mês/ano ▶ + "Mês atual"; **único** seletor do app; URL `?mes=YYYY-MM` |
| Língua de status | `lib/status-meta.ts` | 🟢 Pago · 🟡 A vencer · 🔴 Devendo — rótulo + badge + tintura de linha (`ROW_PAID`/`ROW_SOON`/`ROW_OVERDUE`) para cobrança, despesa, folha e receita |
| Desfazer | `components/undo-toast.tsx` | gesto registra na hora + **Desfazer por 15 min**; host único no AppShell |
| Visões salvas | `SavedView` + `saved-views-bar` | conjunto de filtros nomeado por módulo (privado ou global) |
| Tabela responsiva | `ui/table` + `ui/record-card` | `hidden md:block` no desktop, MobileCards no celular |
| Formulários | inputs não-controlados + `FormData` + Zod no submit | react-hook-form foi removido de propósito |

---

## 6. Módulos — funcionalidades detalhadas

### 6.1 Dashboard (`/dashboard`)

Três linhas: visão financeira do mês → operação → alertas/decisões. Cada card é clicável e abre
o módulo já filtrado ou um painel de detalhe **dentro do contexto** (nunca redireciona).

**Filtro único: o período** (`?periodo=mes|...` via `resolvePeriod`) — recortes por cliente,
serviço ou responsável vivem nos módulos e relatórios.

**1ª linha — 5 MetricCards** (cada um abre painel de detalhe):

| Card | Fórmula | Detalhe ao clicar |
|---|---|---|
| Faturamento total | `getPeriodRevenue().total` (MRR+TCV) + Receita Extra manual | composição MRR/TCV/extra |
| Total de despesas | Σ despesas não canceladas do período | lista + por categoria |
| Faturamento recebido | recebimentos na competência + adiantamentos + extra manual | lista de recebidos |
| Em aberto | `max(0, total − recebido)`; **Vencido** ⊂ Em aberto | em aberto por cliente |
| Resultado do mês | `Recebido − Despesas`; margem = `Resultado / Recebido` | composição do resultado |

**2ª linha — gráficos** (Recharts via `next/dynamic`): Faturamento (linha), Despesas (linha),
Resultado mensal (barras divergentes) — sempre Jan..Dez do ano filtrado, com toggle
Mensal/Acumulado.

**3ª linha — indicadores secundários** (SecondaryStat):
Faturamento MRR · Faturamento TCV · Receita de novos clientes · Ticket médio geral ·
% Recorrência · Clientes ativos · Novos clientes · Renovações do mês · Churn (mês) ·
Clientes em aberto · Custo por cliente · % Folha no faturamento · Margem operacional ·
Inadimplência (vencido) · Upsell em aberto.

**Composições:** donut de composição do faturamento (MRR · TCV · Receita Extra) ·
despesas por categoria (HBarList) · novos clientes × renovações.

**Saúde financeira** (score 0-100, `computeHealth`) — penalidades:

| Fator | Penalidade |
|---|---|
| Caixa disponível ≤ 0 | −30 |
| Projeção de caixa 30d negativa | −25 |
| Prejuízo no período | −20 |
| Inadimplência alta / em atenção | −15 / −8 |
| Folha > limite crítico / alto (ideal ≤ 40% da receita) | −15 / −10 |
| Despesas fixas acima do limite sobre a receita | −8 |

Níveis: ≥85 Excelente · ≥70 Saudável · ≥50 Estável · ≥30 Atenção · <30 Crítica.

**Alertas e próximas ações**: lista priorizada (`high`/`medium`/`low`) com link direto para o módulo.

**Resumo inteligente**: parágrafos determinísticos (sem IA) sobre o mês filtrado, com comparação
vs. mês anterior (`getPreviousMonthComparison`; intervalo livre compara com janela de mesmo tamanho).

**Lançar ao caixa**: resultado positivo do mês pode ser lançado (total ou parcial) no
"Caixa operacional". Anti-duplicidade por marcador `[resultado:YYYY-MM]` na descrição do
movimento; disponível = resultado − já lançado.

---

### 6.2 Gestão do Mês (`/cobrancas`) — a tela central

Uma página, cinco seções, uma competência. Barra superior: **MonthNav** + busca por cliente.

#### Resumo do mês (6 StatCards)

| Card | Fórmula |
|---|---|
| Faturamento esperado | Σ cobranças da competência (`expectedTotal`) |
| Recebido no mês | `getReceiptsSummary().totalRevenue` |
| % Realização | recebido ÷ esperado (verde ≥90%, âmbar ≥60%, vermelho abaixo) |
| Falta receber | em aberto na competência |
| Despesas do mês | contas + cartões + folha paga |
| Resultado do mês | **faturamento esperado − despesas** (regra da planilha: projeta o mês cheio) |

#### Seção 1 — Clientes do Mês

Uma linha por cliente, como na planilha. **Quem entra automaticamente:**

- clientes **MRR ativos** (`ACTIVE`/`RENEWAL`/`DELINQUENT`) — a mensalidade que faltar é gerada
  (`ensureMonthlyBillings`, idempotente, com throttle de 1h por dono+competência e `skipDuplicates`);
- clientes com cobrança já criada para o mês (TCV de adesão/renovação, setup, avulsa, upsell);
- cobranças incluídas manualmente.

**Quem NÃO entra:** perdidos/pausados/inativos · removidos do mês (marcador cancelado — a geração
não recria) · **TCV fora do mês de adesão/renovação** (nunca rateado).

**5 KPIs do ciclo** (clicáveis, filtram a lista): A receber · Recebido · A vencer · Vencido · Clientes pagos.

**Status da linha** (`CycleStatus`, derivado — nunca gravado):

| Status | Rótulo | Quando |
|---|---|---|
| `UPCOMING` | A vencer | em aberto, dentro do prazo |
| `PAID` | Pago | quitado no prazo |
| `PAID_LATE` | Pago com atraso | quitado depois do vencimento, **dentro** do mês de competência |
| `PAID_OTHER_MONTH` | Recebido em outro mês | quitado em mês posterior (recuperação) |
| `OVERDUE` | Vencido | passou do vencimento (automático) |
| `DELINQUENT` | Inadimplente | marcação **manual** (`collectionStatus=ESCALATED`) — vale antes do vencimento |
| `PARTIAL` | Parcial | pagamento parcial registrado |
| `NO_CHARGE` | Sem cobrança no mês | cliente MRR ativo ainda sem mensalidade gerada |
| `REMOVED` | Removido do mês | cobrança cancelada; cliente segue na carteira |

**Filtros:** chips (Todos · A vencer · Pagos · Vencidos · Inadimplentes · Sem cobrança ·
Removidos do mês) + "Mais filtros" (responsável, modalidade MRR/TCV, valor mín/máx,
vencimento de/até, cliente) + busca por nome. Aceita parâmetros legados (`?situacao=`, `?avencer=`, `?status=`).

**Edição inline na linha — e o efeito no cadastro:**

| Célula | Ação | Efeito |
|---|---|---|
| Status (🟢🟡🔴) | 1 clique | Pago → quita o saldo em aberto **hoje** pelo núcleo contábil (com Desfazer 15 min); Devendo → marca inadimplente manual; A vencer → limpa a marcação |
| Modalidade | select MRR/TCV | atualiza o **cadastro** do cliente |
| Valor devido | edição inline | atualiza o valor de referência do cliente (mensal p/ MRR, contrato p/ TCV) **e** a cobrança em aberto do mês |
| Vencimento | select "Todo dia N" | atualiza `paymentDay` do cliente **e** a cobrança em aberto |
| Prazo (meses) | edição inline | atualiza `contractMonths` do cliente |

**Ações por linha:** registrar pagamento (valor/data/método/conta) · gerar mensagem de cobrança
(7 tons) · reagendar vencimento · nota de cobrança · excluir pagamento (reabre a cobrança) ·
recolocar no mês (se removido).

**Ações em massa** (checkbox): marcar status em lote · registrar pagamentos em lote ·
**remover clientes selecionados da lista do mês** (cancela a cobrança ou cria marcador cancelado;
nunca apaga o cliente).

**Ações do cabeçalho:** *Inadimplência de mês anterior* (cria cobrança vencida em competência
passada, entra no histórico e nos relatórios) · *Cobrança avulsa* (todos os campos livres) ·
*Incluir cliente no mês* · *Gerar cobranças em lote* de acordos/contratos.

#### Seção 2 — Recebimentos do Mês

Controle completo das entradas do mês: cobranças da competência (pagas, a vencer, devendo) +
receitas avulsas + recuperações (`Income revenueType=RECOVERY`) + Receita Extra manual.
Reusa as cobranças já carregadas — zero query nova.

Totais: **Recebido** (exclui `PAID_OTHER_MONTH`, que conta como recuperação no mês do pagamento) ·
A receber · Atrasado.
Anti-dupla-contagem: recuperação da própria competência exibida sai da lista (já está na linha da cobrança).

#### Seção 3 — Contas a Pagar do mês

Despesas do mês com categoria, tipo, vencimento e status. Marcar como paga em 1 clique, criar
despesa rápida e alterar vencimento sem sair da tela. Subtítulo mostra `Pago X de Y`.

#### Seção 4 — Folha do Mês

Se existe folha (`Payroll`) do mês: itens agrupados por colaborador (salário · comissão · outros,
com descontos negativos). Se não existe: **prévia** com colaboradores ativos + comissões do mês.
Mostra total e % da folha sobre a receita.

#### Seção 5 — Renovações do Mês

Mesma fonte do módulo `/renovacoes` (`getRenewalPanel`): quem renova no mês, quem já renovou,
quem foi perdido. Ações: **"Sim, renovou"** (fluxo completo), marcar perda, agendar renovação,
registrar pagamento.

---

### 6.3 Inadimplência (`/inadimplencia`)

Aba do hub de recebimentos. KPIs: Total vencido · Clientes inadimplentes · Recuperado no mês ·
Crítico (31+ dias).

Tabela por cliente: valor vencido, nº de cobranças, cobrança mais antiga, dias de atraso,
último contato e ação. **Aging global** em buckets 1-15 / 16-30 / 31-60 / 60+ dias
(`getDelinquentClients`).

**Fila de cobrança priorizada** (`getCollectionQueue`) — score:

| Critério | Pontos |
|---|---|
| Dias de atraso 1-15 / 16-30 / 31-60 / 60+ | +8 / +15 / +22 / +30 |
| Valor >5k / >2k / >1k / >500 / demais | +25 / +18 / +12 / +8 / +4 |
| Cliente recorrente (contrato MRR vigente) | +10 |
| Renovação em ≤30 dias | +10 |
| Key account (≥20% da receita recebida em 90 dias) | +10 |
| Reincidente (≥3 cobranças vencidas) | +8 |
| ≥3 contatos sem pagamento | +8 |
| Promessa de pagamento vencida | +12 |

Classificação: ≥60 **alta** · ≥35 **média** · <35 **baixa**. Cada item traz motivo legível,
tom de mensagem sugerido e a cobrança-âncora para registrar contato/pagamento.

**Gerador de mensagens** (`lib/billing-message.ts`) — 7 tons:
`padrao` (recomendado, escolhe sozinho pelo atraso; corta em 15 dias para "muito atrasado") ·
`amigavel` · `formal` · `direto` · `urgente` · `ultima_tentativa` · `reativacao`.
Usa nome, valor em aberto, vencimento, dias de atraso, serviços, mês de referência,
histórico de contatos e se houve promessa.

---

### 6.4 Clientes / Gestão de Carteira (`/clientes`)

Lista com **competência selecionada** (`?mes=`) governando tudo: inadimplência do mês,
vencimento na linha, meses ativos e KPIs.

**KPIs clicáveis:** Clientes ativos (ou "Ativos em <mês>") · Novos no mês · Perdidos no mês ·
Renovações do mês.

**Filtros:** busca (nome, razão social, CNPJ/CPF, e-mail, segmento, cidade, responsável comercial,
responsável operacional, tags) · status · modalidade · inadimplência (pago/devendo) ·
mês de renovação · serviço contratado · segmento · responsável · ordem A-Z/Z-A ·
entrada no mês · perda no mês · paginação (20/40/100 por página).

**Colunas configuráveis** (`ALL_COLUMNS`): Status · Modalidade · Valor mensal · Valor total do
contrato · Dia de vencimento · Pagamento (mês) · Serviços · Risco · Observações ·
Mês de renovação · Meses ativos · Responsável · Segmento.

**Edição inline:** status, modalidade, mês de renovação, valor mensal, observações rápidas
e a célula **Pagamento (mês)**, que opera a cobrança **real** da competência:

- **PAGO** → quita o saldo pelo núcleo contábil (mês passado entra com a data do vencimento —
  backfill "pagou em dia"); devolve o id do pagamento para o toast Desfazer;
- **DEVENDO** → marca inadimplente (`ESCALATED`);
- **limpar** → volta para A vencer/Parcial;
- se o mês ainda não tem cobrança, ela é **materializada do cadastro**
  (`ensureClientBillingForMonth`) — preencher a célula *é* o registro, como na planilha.

**Ações em massa:** atualizar campos em lote · excluir clientes (com purga profunda) ·
seleção de "todos os filtrados".

**Perda de cliente:** ao mudar o status para `CHURNED`, o sistema cria automaticamente um
`ClientLoss` com o snapshot da receita perdida (MRR mensal ou TCV de referência), modalidade,
responsável e motivo. Um cliente pode ter várias perdas (saiu, voltou, saiu de novo).

#### Área do cliente (`/clientes/[id]`) — 8 abas

| Aba | Conteúdo |
|---|---|
| Visão geral | dados cadastrais, fiscais, contatos, KPIs financeiros do cliente |
| Contratos | acordos comerciais (MRR/TCV) com vigência, valores e renovação |
| Documentos | contratos gerados + documentos anexados (dossiê) |
| Cobranças | todas as cobranças com status, competência e vencimento |
| Pagamentos | pagamentos recebidos (método, data, conta) |
| Serviços | serviços contratados |
| Histórico | histórico de cobrança/interações (nunca sobrescrito) + renovações + perdas |
| Contexto | notas internas tipadas (observação, comercial, negociação, atendimento, alerta) |

**Perfil de risco** (`getClientRiskProfile` / `getClientRiskLevels`): nível de risco por cliente
a partir do histórico de inadimplência.

---

### 6.5 Renovações (`/renovacoes`)

**Fonte única** (`getRenewalPanel`) compartilhada com a seção da Gestão do Mês. A lista do mês é a
união de quatro fontes: agenda da carteira (`Client.renewalMonth`) · contratos com `renewalDate`
no mês · renovações já registradas para o mês · perdas registradas no mês.

**KPIs:** Renovações no mês (com nº pendentes) · Valor esperado (TCV cheio · MRR mensalidade) ·
Renovadas (contagem + valor) · Não renovadas.

**Faixa de previsibilidade** (`getRenewalStrip`): próximos 6 meses.

**Fluxo "Sim, renovou"** (`renewClientFlow`) — caminho **único** para renovação:

1. escolhe a **modalidade** do novo ciclo (MRR = mensalidade + dia de pagamento; TCV = valor cheio);
2. estende o contrato (quando existe) e reativa o cliente; contrato e cadastro acompanham a
   modalidade (MRR zera valor total; TCV zera mensalidade e dia recorrente);
3. **opcionalmente lança** o valor nos recebimentos, na **competência escolhida** (mês atual ou
   outro), como cobrança real — com status aberto, pago total ou pago parcial;
4. grava histórico auditável em `ClientRenewal` (aparece na ficha do cliente e no módulo).

Proteções: **guarda anti-duplo envio** (renovação do mesmo cliente há <10 min é bloqueada);
contrato + cadastro + histórico numa transação; nunca chama `generateBillingsForContract`
(duplicaria cobranças, pois as mensalidades do dia a dia nascem sem `contractId`).

Também: **agendar renovação** (define o mês de renovação do cliente) e **histórico recente** (15 últimas).

---

### 6.6 Upsell (`/upsell`)

Kanban de oportunidades de venda interna à base, com HTML5 drag & drop no desktop e select no
mobile. Movimentação otimista com Desfazer.

**Colunas / status:** `OPPORTUNITY` (oportunidade) → `NEGOTIATION` (em negociação) →
`WON` (vendido) / `LOST` (perdido) / `PAUSED` (pausado).

**KPIs:** Em aberto (valor do pipeline) · Ganho no mês · Conversão (mês).

**Campos da oportunidade:** cliente, serviço sugerido, oferta sugerida, título, **valor**,
responsável, status, previsão de fechamento, data real de fechamento, observações,
e uma lista N:N de **serviços com preço unitário** (`UpsellService`).

**Venda (WON) com lançamento:** cria uma `Billing` `ONE_TIME` na **competência escolhida**, com
vencimento pelo dia de pagamento do cliente e descrição `Upsell — <título/serviços>`. A partir daí
a venda segue o fluxo normal (pagamento em 1 clique, inadimplência, métricas).

**Desfazer a venda:** sem pagamento → a cobrança é cancelada (soft) e libera novo lançamento;
com pagamento → mantida, com aviso (reverter dinheiro é manual).

---

### 6.7 Contas a Pagar (`/despesas`)

Três abas: **Despesas** · **Cartões e Contas** · **Resumo**. Navegação por mês (MonthNav).

**Campos da despesa:** nome/descrição\*, valor total\*, vencimento\*, tipo (`ExpenseType`),
categoria, status (pendente/paga/cancelada), recorrência, intervalo em meses (quando personalizada),
cartão/conta + mês da fatura (quando tipo cartão), descrição livre, e — na edição de recorrente —
**escopo**: "somente esta ocorrência" ou "esta e as próximas (não pagas)".

Campos gerenciais adicionais no modelo: cliente alocado (rentabilidade por cliente), serviço
vinculado, responsável, pagador, pertence a (pessoal/empresa/terceiro/familiar), reembolsável.

**"Vencida" é estado derivado** (pendente/devendo com vencimento no passado) — nada é reescrito.

**Recorrência**: despesa recorrente materializa ocorrências futuras ligadas por
`recurrenceGroupId`; é possível editar UMA ou TODAS e **encerrar a recorrência**
(remove futuras não pagas). Tipos: `NONE` · `MONTHLY` · `QUARTERLY` · `SEMIANNUAL` · `ANNUAL` ·
`CUSTOM` (intervalo em meses).

**Resumo do mês** (`getExpenseSummary`): total · pagas · pendentes · vencidas (valor e contagem) ·
recorrentes · despesas em cartão · débitos em faturas abertas · limite total/usado/disponível ·
próximos vencimentos (7 dias).

#### Cartões e Contas (`/cartoes`, `/cartoes/[id]`)

- **CreditCard** = conta de cartão: nome, banco, tipo (pessoal/empresarial/terceiro), titular,
  conta bancária, limite total, **dia de fechamento**, **dia de vencimento**, ativo.
- **AccountCard** = cartão físico/virtual dentro da conta: nome, tipo, últimos 4 dígitos,
  limite individual, observações. Todos os gastos dos cartões compõem a fatura da conta.
- **CreditCardInvoice** = fatura por referência (mês/ano, único por cartão): fechamento,
  vencimento, total, pago, **total declarado no PDF** (para conferência), status
  (aberta/fechada/paga/atrasada/parcial).
- Página do cartão: filtro por mês, transações da fatura, responsável por transação,
  gestão de cartões da conta, importação de fatura.

**Parcelamento é metadado da transação** (`installmentNumber`, `installmentTotal`,
`installmentGroupKey` = sha1 de cartão + descrição normalizada + valor da parcela + total).
"AMAZON 3/10" **não** cria parcelas futuras no banco; projeções são calculadas em memória.
`historyMatched` marca quando categoria/pessoa foram herdadas de uma parcela anterior reconhecida.

---

### 6.8 Folha de pagamento (`/folha`)

**KPIs:** Total da folha · Comissões do mês · Folha / receita do mês · Colaboradores ativos ·
Status da folha.

**Três blocos:**

1. **Itens da folha do mês** — colaborador, tipo, observação, valor (removível enquanto não paga).
   Tipos (`PayrollItemKind`): `SALARY` · `BONUS` · `COMMISSION` · `BENEFIT` · `REIMBURSEMENT` ·
   `DEDUCTION` (**entra negativo no total**).
2. **Comissões** — colaborador, cliente, base × %, observação, valor, competência, status
   (`PENDING`/`APPROVED`/`PAID`/`CANCELED`).
3. **Colaboradores** — nome, cargo, vínculo (`CLT`/`PJ`/`FREELANCER`), salário base, início/fim,
   vínculo opcional com uma Pessoa, ativo.

**Ciclo da folha** (`Payroll`, único por dono+ano+mês): `DRAFT` → `APPROVED` → `PAID`.
Existe uma ação de **gerar, aprovar e pagar** em um passo.
`folhaPeriodo` conta itens `APPROVED`/`PAID` do mês, **com o sinal correto de `DEDUCTION`**.

---

### 6.9 Rotina Diária (`/rotina`)

Central de **execução** do dia (a análise fica no Dashboard). Cada seção só aparece — e só
consulta o banco — se o usuário tem acesso ao módulo de origem.

**Estrutura:** métricas do dia → Cobranças (a receber) → Pagamentos (a pagar) → Ações de hoje
(checklist) → Sugestões da IA.

- **Cobranças** = vencidos (fila priorizada, ordenados por maior atraso) + vencendo hoje/próximos
  3 dias. Prioridade dos próximos: hoje/amanhã = média, 2-3 dias = baixa; valor ≥ R$ 5.000 sobe um nível.
- **Pagamentos** = despesas vencidas + hoje/próximos 3 dias. Crítica quando ≥ R$ 3.000 ou o texto
  casa `imposto|folha|das|fgts|inss`.
- **Ações de hoje** (checklist com chaves estáveis por dia, persistido em `RoutineItemState`):
  cobrar os 3 maiores vencidos · retomar contato em promessas quebradas · resolver pagamentos
  vencidos · pagar o que vence hoje · acompanhar cobranças do dia · antecipar recebíveis se a
  projeção de caixa 30d ficar negativa · encaminhar renovações do mês · avançar os 2 maiores upsells.
- **"Remover da rotina de hoje"** apenas **oculta** o item do dia — nunca apaga nem altera
  cliente, cobrança, despesa ou status financeiro. Histórico auditável (`reason`, `actorName`).
- **Tom da mensagem** sugerido pelo atraso: ≥15 dias → urgente · >0 → direto · senão amigável.

---

### 6.10 Contratos — documentos (`/contratos`)

Biblioteca de **modelos DOCX com variáveis `{{ }}`** e geração de contratos preenchidos.
Não confundir com `/acordos` (contrato comercial MRR/TCV).

**Motor de modelos** (`lib/docx/template.ts`):
- extração remonta o texto de cada parágrafo juntando os runs `<w:t>` antes do regex — o Word
  fatia `{{Nome da empresa}}` em vários runs; cobre corpo, tabelas, cabeçalhos, rodapés e notas;
- geração com `docxtemplater` + `pizzip`, delimitadores `{{ }}`, chave exata (aceita espaços,
  acentos, ç, parênteses); **o modelo original nunca é alterado**;
- alerta de variáveis pouco descritivas (numéricas ou curtas demais);
- caso especial: `{{15}}` em modelos antigos é reconhecido como "Dia de vencimento".

**Tipos inferidos de variável:** `text` · `date` · `number` · `money` · `email` · `phone` · `document`.

**Pré-preenchimento automático** (`CLIENT_FIELD_MAP` → `prefill.ts`):

| Origem | Variáveis reconhecidas (exemplos) |
|---|---|
| `client.name` | nome da empresa, nome do cliente, empresa, contratante, nome fantasia |
| `client.legalName` | razão social |
| `client.document` | CNPJ, CPF, documento |
| `client.email` / `client.phone` | e-mail, telefone, celular, whatsapp |
| `client.address` | endereço, endereço completo, endereço do contratante |
| `client.legalRepresentative` | representante legal, nome do responsável |
| `client.city` / `client.state` / `client.segment` | cidade, estado/UF, segmento |
| `contract.startDate` | data de início, data de assinatura |
| `contract.dueDay` | dia de vencimento |
| `contract.monthlyAmount` | valor mensal, mensalidade |
| `contract.totalAmount` | valor total, valor do contrato |
| `contract.durationMonths` | prazo, prazo em meses, duração em meses |

**Metadados comerciais do modelo:** tipo comercial (`MRR`/`TCV`/`ONE_TIME`/`CUSTOM`),
modelo de cobrança (`MONTHLY`/`UPFRONT`/`INSTALLMENTS`/`CUSTOM`), duração
(`MONTHLY`/`QUARTERLY`/`SEMIANNUAL`/`ANNUAL`/`CUSTOM`), meses, valor mensal, valor total,
dia de vencimento padrão, serviços incluídos, notas internas.
Status do modelo: `DRAFT` · `ACTIVE` · `ARCHIVED`.

**Contratos gerados:** nome, tipo comercial, valor, início, dia de vencimento, variáveis
preenchidas (JSON), arquivo gerado, status (`GENERATED` · `SENT` · `SIGNED` · `CANCELED` ·
`ARCHIVED`), origem (wizard interno ou link público). Download por `/api/arquivos/contrato/[id]`.

**Link público de formulário (`/f/[token]`)** — substitui o ZapSign:
- token opaco e inadivinhável é a credencial (sem login);
- pode ser **direcionado a um cliente** (pré-preenche os dados dele) ou geral (não expõe cliente algum);
- pode ser ativado/desativado; conta submissões;
- o dono dos dados vem do próprio link (`runWithOwner`), já que sem sessão o escopo é fail-closed;
- ao enviar, o contrato é gerado dentro da plataforma;
- página com `robots: noindex, nofollow`.

**Dossiê do cliente:** documentos anexados tipados (`CONTRACT` · `PROPOSAL` · `RECEIPT` ·
`BRIEFING` · `LEGAL_DOCUMENT` · `OTHER`) e notas de contexto.

---

### 6.11 Acordos comerciais (`/acordos`)

Contratos MRR/TCV que alimentam as cobranças.

**KPIs:** MRR ativo · TCV vendido (ano) · Reconhecida no mês · Renovações em 30 / 31-60 / 61-90 dias.

**Campos do contrato:** cliente, título, tipo (`MRR`/`TCV`/`ONE_TIME`/`SETUP`/`CUSTOM`),
status (`PENDING`/`ACTIVE`/`RENEWAL`/`OVERDUE`/`ENDED`/`CANCELED`), recorrência, valor mensal,
valor total (TCV), taxa de setup, início, fim, data de renovação, **dia de cobrança (1-28)**,
forma de pagamento, modo de pagamento (à vista/parcelado/mensal), renovação automática,
cancelado em, observações, serviços do contrato (N:N com quantidade e preço unitário).

**Ações:** encerrar · cancelar · excluir · **gerar cobranças do contrato** ·
**gerar cobranças de todos os ativos** (útil após importar contratos). TCV força
`recurrence=NONE` e `monthlyValue=0`.

---

### 6.12 Serviços (`/servicos`) e Planos/Ofertas (`/ofertas`)

**Serviço** (catálogo): nome, descrição, categoria (tráfego/social/web/consultoria/...),
preço base sugerido, custo estimado de entrega, responsável padrão, observações, ativo.
KPIs: ativos · total no catálogo · em contratos vigentes.

**Oferta (Plano)**: pacote comercial que junta serviços com um valor. **O preço vive na oferta,
não no serviço** — a mesma junção pode ser vendida por valores diferentes em ofertas diferentes.
Campos: nome, descrição, modalidade (`MRR`/`TCV`/`CUSTOM`), valor padrão, duração em meses,
forma de pagamento padrão, ativa, observações, serviços incluídos (N:N).

---

### 6.13 Painel Anual (`/projecoes`)

A segunda planilha do dono: **indicador × JAN..DEZ + acumulado + meta anual**, navegável por ano.

**Meta anual** (`AnnualTarget`, único por dono+ano): meta de faturamento, alcançado até o último
mês com dados, e meses restantes.

**Linhas do painel** (`getAnnualPanel`, consumindo `getYearlySeries` — mesma fonte do Dashboard):
Esperado · Recebido · Novos clientes (valor) · Novos clientes (qtde) · Outras entradas ·
Despesas · Folha · Tráfego (despesas `ADS`) · Comissão · Resultado · Clientes ativos ·
Churn (qtde) · Churn (valor).

**Simulador de cenários** (funções puras, `financial/projections.ts`).

*Baseline real do mês:* receita (MRR+TCV), clientes MRR, ticket médio MRR, ticket médio TCV,
despesas, despesas recorrentes, folha, inadimplência aberta, pipeline de upsell, caixa,
projeção 30d.

*Variáveis simuláveis:* aumento de MRR (R$/mês) · aumento de TCV (R$ no mês) · redução de
despesas · aumento de upsell vendido · perda de N clientes MRR · recuperação de inadimplência ·
aumento de folha.

*Metas:* meta de faturamento · margem desejada (%) · meta de lucro.
*Saída:* receita, despesas (com folha), lucro e margem projetados, análise de gap
(quantos clientes/vendas faltam pelo ticket médio) e narrativa.

---

### 6.14 Relatórios (`/relatorios`)

18 relatórios; cada um declara colunas, filtros aplicáveis, opções de agrupamento e um builder
que devolve **linhas cruas** — a formatação acontece na renderização e na exportação; os dados
originais nunca são alterados.

| # | Relatório | Descrição | Filtros | Agrupar por |
|---|---|---|---|---|
| 1 | Financeiro mensal | Receitas, despesas, folha, lucro e margem, mês a mês | período, cliente | — |
| 2 | Clientes | Carteira com contratos, receita, aberto e vencido por cliente | cliente, status, responsável, situação, valor | status, responsável, cidade |
| 3 | Inadimplência | Clientes com valores vencidos, aging e último contato | cliente, valor | faixa |
| 4 | Acordos comerciais | Contratos MRR/TCV com valores, vigência e renovação | cliente, status, tipo, valor, situação | cliente, tipo, status |
| 5 | Despesas | Despesas do período com categoria e tipo | período, cliente, serviço, categoria, tipo, valor, vencimento, pago | categoria, tipo, cliente, situação |
| 6 | Folha de pagamento | Itens da folha por competência e colaborador | competência, responsável | colaborador, item |
| 7 | Fluxo de caixa | Entradas e saídas realizadas no período (saldo nos totais) | período, cliente, categoria, valor | tipo, origem |
| 8 | Rentabilidade por cliente | Receita recebida × despesas diretas alocadas | período, cliente | — |
| 9 | Recebimentos do período | Pagamentos com a classificação do fechamento (no prazo / com atraso / em outro mês) | período, cliente | situação, modalidade, cliente, competência |
| 10 | Receita Extra | Lançamentos manuais e entradas avulsas do período | período, cliente | tipo, origem, cliente |
| 11 | MRR (recorrência) | Clientes MRR ativos com valor mensal e anualizado | cliente, responsável | responsável, segmento, status |
| 12 | TCV (contratos fechados) | Cobranças TCV do período — valor cheio no mês | período, cliente | cliente, competência, situação |
| 13 | Renovações | Do mês atual a 5 meses à frente, com valor esperado | responsável | mês, responsável, modalidade |
| 14 | Perdas de clientes | Data, motivo, responsável e receita perdida | período, cliente, responsável | responsável, modalidade |
| 15 | Clientes por responsável | Carteira agrupada: ativos, MRR base e perdas | — | — |
| 16 | Upsell | Pipeline de oportunidades e resultados | cliente, responsável | status, responsável, alvo |
| 17 | Cartões e limites | Limite total, usado e disponível por cartão/conta | — | banco, situação |
| 18 | Executivo da agência | Visão única dos principais indicadores do período | período | grupo |

**Filtros disponíveis na camada** (`ReportQuery`): período · cliente · serviço · contrato ·
categoria · responsável · status · tipo · valor mín/máx · vencimento de/até · competência ·
pago (sim/não) · situação (inadimplente / a vencer / vencido).

**Apresentação** (`ReportPresentation`): subconjunto e ordem de colunas · agrupamento ·
ordenação e direção · totais · gráfico. Tudo pela querystring — o que permite **visões salvas**.

**Exportação**: `/relatorios/[tipo]/export?formato=csv|xlsx` com os **mesmos** filtros, colunas e
ordenação da tela. Exige `relatorios.exportar` (403 sem permissão). Linha de TOTAL incluída
quando os totais estão ligados. Nome do arquivo: `<relatorio>-<AAAA-MM-DD>.<formato>`.

---

### 6.15 Reservas / Caixa (`/caixa`)

Dinheiro guardado e separado (impostos, 13º, fundo de emergência).
KPIs: Total em caixa · Reserva de emergência · Quantidade de caixas.

**CashBox:** nome, valor atual, valor alvo, tipo (`PERSONAL` · `EMERGENCY` · `INVESTMENT` ·
`COMPANY` · `GOAL` · `OTHER`), conta bancária vinculada, observações.
**CashBoxMovement:** tipo (`IN`/`OUT`), valor, data, descrição.

`getCashSummary` entrega: caixa disponível (contas + caixinhas), contas bancárias, reservas,
entradas/saídas do período, saldo realizado, saldo previsto e projeções de 30/60/90 dias.

`getBalanceSummary` (patrimônio): contas · reservas · a receber · ativos manuais · ativos totais ·
contas a pagar · faturas de cartão · passivos manuais · passivos totais · **saldo patrimonial**.

---

### 6.16 Receitas / Receita Extra (`/receitas`)

Histórico completo de receitas da operação. KPIs: Recebido no mês · Previsto no mês · Atrasado ·
Receita Extra (manual).

Colunas: data, descrição, tipo, origem, conta, pessoa, status, valor.

**Regra:** as receitas de contratos entram **automaticamente** pelas cobranças (conciliação
`Payment` → `Income`); esta tela é para as entradas avulsas e a Receita Extra manual.

---

### 6.17 Importar dados (`/importacoes`)

Ver detalhes das colunas em [§11](#11-como-alimentar-o-sistema-todas-as-entradas-de-dados).
Fluxo: **baixar planilha modelo → preencher → subir → prévia validada → confirmar**.
Nada é gravado antes da confirmação. Histórico de lotes (`ImportBatch`) com data, módulo, arquivo,
total, importados, duplicados e erros — e possibilidade de excluir o lote.

---

### 6.18 Regras de Categoria (`/regras`)

Categorização automática de transações importadas.

**Condições:** descrição contém · cartão · valor maior que · valor menor que.
**Ações:** definir categoria · responsável (por nome) · pertence a · reembolsável · status.
**Controle:** prioridade (número; menor = antes) e ativo/inativo.

---

### 6.19 Usuários (`/usuarios`) e Configurações (`/configuracoes`)

**Usuários:** KPIs (usuários, administradores, ativos, vinculados). Criar/editar/excluir,
definir papel, ativar/desativar, vincular a uma Pessoa e **matriz de permissões** que grava
apenas as diferenças vs. o papel.

**Configurações:** categorias usadas para classificar transações e receitas.
KPIs por tipo (despesa · receita · mista). Categoria tem nome, cor, tipo e hierarquia
(pai/filhos). ⚠️ `Category` é **global** (sem `ownerId`, nome único global) — ver
[PLANO_DE_CONTAS_GERENCIAL.md](PLANO_DE_CONTAS_GERENCIAL.md).

---

## 7. Regras de negócio financeiras (o núcleo contábil)

### 7.1 Fluxo canônico do dinheiro

```
Client (modality, monthlyValue | totalContractValue, paymentDay 1-31, contractMonths)
  └─ Contract (type MRR/TCV; TCV força recurrence=NONE e monthlyValue=0)
       └─ Billing (competenceMonth/Year, revenueType, dueDate, amount, paidTotal)
            └─ Payment (paidAt, amount, method, accountId)
                 └─ Income (espelho de CAIXA; billingId + paymentId)
ExtraRevenue (origin=MANUAL)  → receita extra manual
Transaction (type=despesa)    → despesas    ·   PayrollItem → folha
CashBox / CashBoxMovement     → caixa e reservas
```

**Conceitos que NÃO são sinônimos:**

| Conceito | Modelo | Significado |
|---|---|---|
| Cobrança | `Billing` | receita **esperada** por competência (mês/ano) |
| Receita | `Income` | dinheiro efetivamente **recebido** (caixa) |
| Fatura de cartão | `CreditCardInvoice` | fatura do cartão **da agência** (despesa) |
| Receita Extra | `ExtraRevenue` | camada **gerencial** de classificação (não é caixa) |

### 7.2 MRR × TCV

| | MRR | TCV |
|---|---|---|
| Definição | receita recorrente mensal | valor total do contrato |
| Base oficial do faturamento | Σ `Client.monthlyValue` dos clientes `modality=MRR` **ativos no mês** | Σ `Billing revenueType=TCV` da competência |
| Entra no ciclo mensal? | **sim**, automaticamente (mensalidade gerada) | **não** — só no mês de adesão/renovação |
| Rateio | mensal por natureza | **nunca rateado** — valor cheio no mês |
| Cliente conta como ativo | `ACTIVE`, `RENEWAL`, `DELINQUENT` | idem para a relação |
| Não conta | `PAUSED`, `CHURNED`, `INACTIVE`, `PROSPECT` (mês corrente/futuro) | — |

Regra de atividade no mês (`activeInMonth`): entrou antes do fim do mês (`startedAt` ou
`createdAt`) e não saiu antes do início (`churnedAt`); para o mês corrente e futuros, o **status
atual** manda.

### 7.3 Fechamento mensal — as três situações de um pagamento

Núcleo em `services/payment-accounting.ts` (`settleBillingPayment`), tudo em **transação única**:

| Situação | Condição | Efeito |
|---|---|---|
| **Pago no prazo** | `paidAt` na competência, ≤ vencimento | conta no mês; status `PAID` |
| **Pago com atraso** | `paidAt` na competência, > vencimento | conta no mês, marca `isLate` → "!" discreto |
| **Pago em outro mês** | `paidAt` em mês **posterior** à competência | marca `paidInDifferentMonth`; o mês original **permanece inadimplente** no fechamento gerencial; o valor conta como **recuperação** no mês do pagamento (`Income revenueType=RECOVERY`) |

Proteções:
- valor não pode exceder o saldo em aberto (tolerância `MONEY_EPSILON`);
- cobrança cancelada não recebe pagamento;
- **guarda otimista**: o `updateMany` exige que `paidTotal` ainda seja o valor lido — dois cliques
  "Pago" simultâneos não pagam em dobro (o segundo recebe erro amigável);
- `Income` de conciliação é criado por pagamento e vinculado por `paymentId`;
- `CollectionHistory` registra a interação com o texto correto da situação.

**Reversão** (`revertBillingPayment`) — também transacional: apaga o pagamento, apaga o `Income`
pelo vínculo `paymentId` (fallback legado limitado a UM registro sem `paymentId`), recalcula
`paidTotal`/status (`PENDING` ou `OVERDUE` conforme o vencimento), zera `isLate` e
`paidInDifferentMonth`, e reverte eventual Receita Extra automática legada.

### 7.4 Receita Extra

- **Apenas manual** (`ExtraRevenue origin=MANUAL` + `Income` avulsa sem cobrança).
  A geração automática foi removida; o campo `originBillingId` é **único**, garantindo
  idempotência dos registros legados.
- Entra **dos dois lados** do Dashboard (previsto e recebido) — o "Em aberto" continua sendo
  previsto MRR/TCV − recebido de cobranças.
- Não é caixa: o `Payment`/`Income` já registram o dinheiro; a Receita Extra é classificação gerencial.

### 7.5 Vencimentos

- Dia recorrente 1-31 com **clamp de fim de mês** por `getValidDueDateForMonth`
  (`lib/financial/due-date.ts`) — dia 31 em fevereiro vira 28/29. **Único ponto** de cálculo.
- Renovações usam `addMonthsClamped` (31/01 + 1 mês = 28/02, nunca 03/03).
- `Contract.billingDay` é 1-28 de propósito.

### 7.6 Geração de cobranças

| Origem | Função | Dedupe |
|---|---|---|
| Mensalidade MRR do mês | `ensureMonthlyBillings` | qualquer `Billing` MRR na competência — **inclusive cancelada** — bloqueia a recriação; `skipDuplicates` protege corrida serverless |
| Um cliente numa competência (célula da carteira) | `ensureClientBillingForMonth` | reusa cobrança viva; **restaura** marcador cancelado em vez de duplicar |
| Contrato / acordo | `generateBillingsForContract` / `generateBillingsForAllActive` | por `contractId` |
| Venda de upsell | `setUpsellStatus` | via `Upsell.billingId` |
| Renovação | `renewClientFlow` | materializa e **atualiza o valor** da cobrança em aberto |
| Inadimplência de mês anterior | `addPastDelinquency` | cria a cobrança vencida na competência informada |

> ⚠️ As mensalidades do dia a dia nascem **sem `contractId`** — por isso o fluxo de renovação
> nunca chama `generateBillingsForContract` (o dedupe daquela função é por `contractId` e
> duplicaria cobranças em massa).

### 7.7 Remover ≠ excluir

- **Remover do mês**: a cobrança é cancelada (auditado com `canceledAt`, `canceledBy`,
  `cancelReason`); sem cobrança, cria-se um **marcador cancelado** na competência. O cliente sai
  da lista do mês, aparece em "Removidos do mês", pode ser recolocado, e a geração automática
  não o recria. **O cliente nunca é apagado da carteira.**
- **Excluir cliente**: ação explícita, sensível (`clientes.excluir`), com purga profunda
  (`client-purge.ts`). Existe também *soft delete* (`archivedAt`) e timestamp de auditoria (`deletedAt`).

### 7.8 Inadimplência

- **Automática**: `markOverdueBillings()` marca vencidas (com throttle; chamada em rotas de
  leitura de forma controlada).
- **Manual**: `collectionStatus = ESCALATED` marca "Inadimplente" mesmo antes do vencimento.
- **Por competência**: `ClientMonthDelinquency` guarda o ajuste manual mês a mês
  (histórico completo; os campos `delinquencyOverride*` do `Client` são legado backfillado).
  A UI atual não grava mais override cosmético — a célula opera a cobrança real.

---

## 8. Dicionário de métricas

### 8.1 Fórmulas oficiais do Dashboard (`getDashboardMainMetrics`)

| Métrica | Fórmula | Fonte |
|---|---|---|
| **Faturamento total** | `getPeriodRevenue().total` (MRR+TCV) + Receita Extra manual do mês | `dashboard-main.ts` |
| **Total de despesas** | Σ `Transaction type=despesa ≠cancelado` no período | `finance-metrics.ts` |
| **Faturamento recebido** | `receiptsCorrectMonth` (pagos na competência + adiantamentos) + extra manual | `revenue-metrics.ts` |
| **Em aberto** | `max(0, total − recebido)` (clamp em 0: adiantamento pode inverter) | `dashboard-main.ts` |
| **Vencido** (⊂ Em aberto) | Σ (amount−paidTotal) das cobranças abertas da competência com `dueDate < hoje` | `revenue-metrics.ts` |
| **Resultado do mês** | `Recebido − Despesas` | `dashboard-main.ts` |
| **Margem operacional** | `Resultado / Recebido` (0 se nada recebido) | `dashboard-main.ts` |

> ⚠️ `expectedTotal` (Σ **todas** as cobranças da competência, incl. SETUP/ONE_TIME) é métrica
> **diferente** do "Faturamento total" do card. A Gestão do Mês usa `expectedTotal` de propósito
> (regra da planilha: o Resultado do mês projeta o mês cheio).

### 8.2 `ReceiptsSummary` — campos entregues

`receiptsCorrectMonth` · `mrrReceived` · `tcvReceived` · `lateSameMonthValue` /
`lateSameMonthCount` · `paidDifferentMonthValue` / `paidDifferentMonthCount` ·
`extraRevenueAutomatic` · `extraRevenueManual` · `extraRevenueTotal` · `totalRevenue` ·
`openAmount` · `expectedTotal` · `openMonth` · `overdueOpenAmount`.

### 8.3 `FinanceSummary` e `CashSummary`

**FinanceSummary:** receitas · despesas · despesasPagas · despesasFixas · despesasVariaveis ·
resultadoOperacional (competência) · lucro (caixa: receitas − despesas pagas) · margem ·
folhaPeriodo · folhaSobreReceita.

**CashSummary:** caixaDisponivel · contasBancarias · reservas · entradasPeriodo · saidasPeriodo ·
saldoRealizado · saldoPrevisto (+ projeções 30/60/90).

### 8.4 Indicadores gerenciais

| Métrica | Fórmula |
|---|---|
| Ticket médio geral | Faturamento total / clientes ativos |
| Custo por cliente | Despesas / clientes ativos |
| % Folha no faturamento | Folha do mês / Faturamento total (saudável ≤ 40%) |
| % Recorrência | MRR / Faturamento total |
| Churn / receita perdida | count e Σ de `ClientLoss` por `lostAt` no período |
| Novos clientes | `startedAt` no período (fallback `createdAt`) + receita (MRR mensal / TCV total) |
| Renovações | `Client.renewalMonth == mês` (base ativa) |
| Inadimplência (mês) | = Vencido (`overdueOpenAmount`) |
| Inadimplência (aging) | `getDelinquentClients` — OVERDUE global + buckets 1-15 / 16-30 / 31-60 / 60+ |
| Conversão de upsell (mês) | ganhos / total no mês |
| Taxa de inadimplência | vencido / total em aberto (0-1) |

### 8.5 `MonthlySeries` (12 meses)

labels · receitas · despesas · lucro · mrr · inadimplência (vencido em aberto por mês de
vencimento) · folha · folhaPct.

### 8.6 Funções legadas (não usar em telas novas)

`getMonthlyExpectedRevenue` · `getMonthlyReceivedRevenue` · `getMonthlyOpenRevenue` ·
`getMonthlyOverdueRevenue` · `computeMonthlyResult` · `computeOperationalMargin` ·
`getMonthlyAverageTicket`. Zero consumidores hoje.

---

## 9. Modelo de dados completo (55 tabelas)

Convenções: `id` = cuid · `createdAt`/`updatedAt` presentes na maioria · **dinheiro do ERP** em
`Decimal(14,2)`; o núcleo pessoal legado (`Transaction`, `Income`, `CashBox`, `Account`) ainda usa
`Float` · `ownerId` presente em todo modelo privado (injetado automaticamente).

### 9.1 Identidade e acesso

**User** — `id` · `name` · `email` (único) · `passwordHash` · `role` (string, não enum, de
propósito) · `active` · `failedLogins` · `lockedUntil` · `workspaceOwnerId` (+ relação
`workspaceMembers`) · `person` (1:1 opcional) · `permissions[]` + ~50 relações de posse.

**UserPermission** — `userId` · `permission` · `enabled` · único por `(userId, permission)`.
Modelo **global** (sem `ownerId`); só as diferenças vs. o papel são gravadas.

**Person** — `name` · `type` (pessoal/empresa/terceiro/familiar) · `notes` · `userId` (1:1 opcional) ·
`ownerId`. Nome único **por dono**. Relações: cartões (titular), transações (responsável/pagador),
recebíveis, receitas, pagamentos, colaboradores.

### 9.2 Contas, cartões e transações

**Account** — `name` · `bank` · `type` (corrente/poupanca/dinheiro/investimento) · `balance` · `active`.

**CreditCard** — `name` · `bank` · `type` (pessoal/empresarial/terceiro) · `holderId` ·
`accountId` · `limitTotal` · `closingDay` · `dueDay` · `active`.

**AccountCard** — `name` · `cardId` · `kind` (fisico/virtual) · `lastDigits` · `limit` · `notes`.

**Category** — `name` (**único global**) · `color` · `kind` (despesa/receita/mista) ·
`parentId`/`children` (árvore). ⚠️ sem `ownerId`.

**Transaction** — `date` · `description` · `amount` (sempre positivo; o tipo dá o sinal) ·
`type` (despesa/receita/transferencia/ajuste) · `origin` (cartao/pix/debito/boleto/dinheiro) ·
`cardId` · `accountId` · `categoryId` · `responsibleId` · `payerId` ·
`belongsTo` (pessoal/empresa/terceiro/familiar) ·
`status` (pendente/pago/devendo/reembolsado/cancelado) · `reimbursable` · `dueDate` · `notes` ·
`invoiceId` · `importBatchId` · `hash` (único) ·
**parcelamento**: `installmentNumber` · `installmentTotal` · `installmentGroupKey` ·
`historyMatched` · `accountCardId` · `externalId` (Open Finance) ·
**gerencial**: `expenseType` · `recurrence` · `clientId` · `serviceId` ·
**recorrência**: `recurrenceGroupId` · `recurrenceInterval` ·
**cartão**: `cardInvoiceMonth` · `cardInvoiceYear`.

**Installment** — `transactionId` · `number` · `total` · `amount` · `dueDate` · `paid` · `invoiceId`.

**CreditCardInvoice** — `cardId` · `referenceMonth`/`referenceYear` (único por cartão) ·
`closingDate` · `dueDate` · `total` · `paid` · `declaredTotal` (do PDF) ·
`status` (aberta/fechada/paga/atrasada/parcial) · `externalId`.

**Receivable** — `personId` · `transactionId` · `amount` · `dueDate` · `paidAt` ·
`status` (aberto/pago/atrasado/renegociado) · `notes`.

**Income** — `description` · `amount` · `receivedAt` ·
`sourceType` (BANK_ACCOUNT/PIX/TRANSFER/CASH) ·
`incomeType` (SALARY/COMPANY_WITHDRAWAL/CLIENT/REIMBURSEMENT/SALE/LOAN_RECEIVED/OTHER) ·
`status` (RECEIVED/EXPECTED/LATE/CANCELED) · `accountId` · `personId` · `categoryId` · `notes` ·
`date`/`source` (legado) · **ERP**: `revenueType` · `competenceMonth`/`competenceYear` ·
`clientId` · `contractId` · `billingId` · `paymentId` (escalar, sem FK — excluir o Payment não cascateia).

**CashBox** — `name` · `currentAmount` · `targetAmount` · `type` · `accountId` · `notes`.
**CashBoxMovement** — `cashBoxId` · `type` (IN/OUT) · `amount` · `date` · `description`.
**PersonPayment** — `personId` · `amount` · `paidAt` · `method` (PIX/TRANSFER/CASH/OTHER) ·
`accountId` · `notes`.

### 9.3 Importação e automação

**ImportBatch** — `source` (csv/xlsx/pdf) · `module` · `errors` · `fileName` · `cardId` ·
`accountId` · `invoiceId` (fatura âncora) · `referenceMonth`/`referenceYear` · `total` ·
`imported` · `duplicates`.

**CategorizationRule** — `name` · `priority` · `active` ·
*condições*: `descriptionContains`, `cardId`, `amountGreaterThan`, `amountLessThan` ·
*ações*: `categoryId`, `responsibleName`, `belongsTo`, `reimbursable`, `status`.

**RoutineItemState** — `routineDate` · `itemType` (cobranca/pagamento/acao) · `itemKey` ·
`status` (removed/done) · `reason` · `actorName`.

### 9.4 IA

**AISetting** (singleton `default`, global) — `provider` (openai/anthropic/custom) · `baseUrl` ·
`apiKey` · `model` · `temperature` · `enabled`.
**AIConversation** — `title` · mensagens · `ownerId`.
**AIMessage** — `conversationId` · `role` (user/assistant) · `content` · `promptTokens` · `completionTokens`.
**AIMemory** — `kind` (fact/pattern/preference/alert/note) · `content` · `source` (auto/manual) ·
`pinned` · `ownerId`.

### 9.5 Comercial — cliente

**Client** — `name` · `legalName` · `document` · `email` · `phone` · `segment` · `city` · `state` ·
`address` · `legalRepresentative` (usados nos contratos gerados) · `origin` ·
`salesOwner` (texto, sincronizado) + `salesOwnerId` → `Employee` (**fonte da verdade**) ·
`opsOwner` · `paymentDay` (1-31) · `tags[]` · `status` · `modality` (MRR/TCV) · `renewalMonth` (1-12) ·
`monthlyValue` (só MRR) · `totalContractValue` (só TCV) · `contractMonths` · `startedAt` ·
`churnedAt` · `notes` ·
*override legado de inadimplência*: `delinquencyOverride`, `delinquencyOverrideMonth/Year/At/By` ·
*soft delete*: `archivedAt`, `deletedAt`.

**ClientContact** — `clientId` · `name` · `role` · `email` · `phone` · `isPrimary` · `notes`.

**ClientMonthDelinquency** — `clientId` · `month`/`year` · `status` (PAGO/DEVENDO) · `setBy` · `setAt`.

**ClientRenewal** — `clientId` · `contractId` · `renewedAt` · `months` · `totalValue` ·
`monthlyValue` · `modality` · `paymentMethod` · `paymentMode` · `previousEndDate` · `newEndDate` ·
`billingId` · `billingMonth`/`billingYear` · `keptMonthly` · `paymentStatus`
(aberto/pago_total/pago_parcial) · `notes` · `createdBy`.

**ClientLoss** — `clientId` · `lostAt` · `modality` · `monthlyValue` · `referenceValue` ·
`reason` · `salesOwner`.

**ClientDocument** — `clientId` · `name` · `description` · `documentType` · `fileName` ·
`filePath` · `mimeType` · `size`.

**ClientNote** — `clientId` · `title` · `content` · `type`
(observacao/comercial/negociacao/atendimento/alerta).

### 9.6 Catálogo e funil

**Service** — `name` · `description` · `category` · `defaultPrice` · `estimatedCost` ·
`defaultOwner` · `notes` · `active`.

**Offer** — `name` · `description` · `modality` (MRR/TCV/CUSTOM) · `defaultValue` ·
`durationMonths` · `paymentMethod` · `active` · `notes`.
**OfferService** — `offerId` + `serviceId` (único).

**Upsell** — `clientId` · `serviceId` · `offerId` · `title` · `value` · `responsible` · `status` ·
`expectedCloseAt` · `closedAt` · `notes` · `incomeId` (legado) · `billingId`.
**UpsellService** — `upsellId` + `serviceId` (único) · `unitPrice`.

### 9.7 Contratos e cobrança

**Contract** — `clientId` · `title` · `type` · `status` · `recurrence` · `monthlyValue` ·
`totalValue` · `setupFee` · `startDate` · `endDate` · `renewalDate` · `billingDay` (1-28) ·
`paymentMethod` · `paymentMode` · `autoRenew` · `canceledAt` · `notes`.
**ContractService** — `contractId` + `serviceId` (único) · `quantity` · `unitPrice` · `notes`.

**Billing** — `clientId` · `contractId` · `serviceId` · `description` ·
`competenceMonth`/`competenceYear` · `amount` · `paidTotal` · `dueDate` · `paidAt` · `status` ·
`revenueType` · `collectionStatus` · `collector` · `canceledAt` · `cancelReason` · `canceledBy` ·
`notes` · **`isLate`** · **`paidInDifferentMonth`** · relações: `payments[]`, `history[]`,
`incomes[]`, `extraRevenue`.

**Payment** — `billingId` · `amount` · `paidAt` · `method` · `status` · `accountId` · `notes`.

**ExtraRevenue** — `clientId` · `originBillingId` (**único** → idempotência) · `sourcePaymentId` ·
`type` · `origin` · `description` · `amount` · `receivedAt` ·
`originalReferenceMonth`/`originalReferenceYear`.

**CollectionHistory** — `billingId` · `clientId` · `status` · `channel`
(whatsapp/email/telefone/outro) · `message` · `contactedAt` · `nextActionAt` ·
`actionType` (auditoria: PAYMENT_REGISTERED, STATUS_CHANGED, DELETED…) · `createdBy`.

### 9.8 Equipe e folha

**Employee** — `name` · `role` · `type` (CLT/PJ/FREELANCER) · `baseSalary` · `active` ·
`personId` · `startedAt` · `endedAt` · `notes` · relação `salesOwnedClients`.
**Payroll** — `month`/`year` (único por dono) · `status` · `paidAt` · `notes`.
**PayrollItem** — `payrollId` · `employeeId` · `kind` · `amount` (DEDUCTION negativo) · `notes`.
**Commission** — `employeeId` · `clientId` · `contractId` · `basisAmount` · `rate` (Decimal 7,4) ·
`amount` · `month`/`year` · `status` · `paidAt` · `notes`.

### 9.9 Patrimônio

**Asset** — `name` · `type` · `value` · `acquiredAt` · `notes`.
**Liability** — `name` · `type` · `totalValue` · `remainingValue` · `dueDate` · `installments` ·
`monthlyPayment` · `notes`.
**Loan** — `lender` · `principal` · `interestRate` · `installments` · `installmentValue` ·
`remainingValue` · `firstDueDate` · `liabilityId` · `notes`.

### 9.10 Plataforma

**ImportTemplate** — `name` · `entity` · `columns` (JSON) · `notes`.
**ExportReport** — `name` · `module` · `format` (CSV/XLSX/PDF) · `filters` (JSON) · `fileName` · `generatedAt`.
**FinancialAlert** — `kind` · `title` · `body` · `refType` · `refId` · `dueAt` · `readAt` · `resolvedAt`.
**SavedView** — `name` · `module` · `params` (querystring) · `visibility` (PRIVATE/GLOBAL) · `createdBy`.
**AnnualTarget** — `year` · `revenueTarget` · único por dono+ano.

### 9.11 Contratos documentais

**ContractTemplate** — `name` · `description` · `commercialType` · `billingModel` ·
`durationType` · `durationMonths` · `monthlyAmount` · `totalAmount` · `defaultDueDay` ·
`includedServices` (JSON string[]) · `internalNotes` · `originalFileName` · `filePath` ·
`mimeType` · `fileSize` · `fileHash` · `variables` (JSON `TemplateVariable[]`) ·
`warnings` (JSON string[]) · `status`.

**GeneratedContract** — `templateId` · `clientId` · `name` · `commercialType` · `amount` ·
`startDate` · `dueDay` · `filledVariables` (JSON) · `generatedFileName` · `generatedFilePath` ·
`status` · `generatedAt` · `formLinkId`.

**ContractFormLink** — `token` (único) · `templateId` · `clientId` · `active` · `submissions` ·
`ownerId` (explícito). **Modelo global** de propósito.

---

## 10. Enums / valores possíveis

| Enum | Valores |
|---|---|
| `ClientStatus` | `LEAD` (legado) · `PROSPECT` · `ACTIVE` · `INACTIVE` · `PAUSED` · `RENEWAL` · `DELINQUENT` · `CHURNED` |
| `ClientModality` | `MRR` · `TCV` |
| `DelinquencyStatus` | `PAGO` · `DEVENDO` |
| `OfferModality` | `MRR` · `TCV` · `CUSTOM` |
| `UpsellStatus` | `OPPORTUNITY` · `NEGOTIATION` · `WON` · `LOST` · `PAUSED` |
| `ContractStatus` | `PENDING` · `ACTIVE` · `RENEWAL` · `OVERDUE` · `ENDED` · `CANCELED` |
| `ContractType` | `MRR` · `TCV` · `ONE_TIME` · `SETUP` · `CUSTOM` |
| `RecurrenceType` | `NONE` · `MONTHLY` · `QUARTERLY` · `SEMIANNUAL` · `ANNUAL` · `CUSTOM` |
| `BillingStatus` | `PENDING` · `PARTIAL` · `PAID` · `OVERDUE` · `CANCELED` |
| `PaymentStatus` | `CONFIRMED` · `PENDING` · `FAILED` · `REFUNDED` |
| `PaymentMethod` | `PIX` · `TRANSFER` · `BOLETO` · `CARD` · `CASH` · `OTHER` |
| `RevenueType` | `MRR` · `TCV` · `ONE_TIME` · `SETUP` · `RECOVERY` · `OTHER` |
| `ExpenseType` | `FIXED` · `VARIABLE` · `PAYROLL` · `TAX` · `TOOL` · `ADS` · `LOAN` · `CARD` · `OTHER` |
| `CollectionStatus` | `NOT_CONTACTED` · `CONTACTED` · `PROMISED` · `PAID` · `IGNORED` · `ESCALATED` |
| `EmployeeType` | `CLT` · `PJ` · `FREELANCER` |
| `PayrollStatus` | `DRAFT` · `APPROVED` · `PAID` |
| `PayrollItemKind` | `SALARY` · `BONUS` · `COMMISSION` · `BENEFIT` · `REIMBURSEMENT` · `DEDUCTION` |
| `CommissionStatus` | `PENDING` · `APPROVED` · `PAID` · `CANCELED` |
| `AssetType` | `CASH` · `RECEIVABLE` · `EQUIPMENT` · `INVESTMENT` · `INTANGIBLE` · `OTHER` |
| `LiabilityType` | `LOAN` · `TAX` · `SUPPLIER` · `CARD_DEBT` · `LABOR` · `OTHER` |
| `AlertKind` | `BILLING_DUE` · `BILLING_OVERDUE` · `CONTRACT_RENEWAL` · `LOW_CASH` · `GOAL` · `PAYROLL` · `CUSTOM` |
| `ImportEntity` | `CLIENTS` · `CONTRACTS` · `BILLINGS` · `REVENUES` · `EXPENSES` · `EMPLOYEES` · `ASSETS` · `LIABILITIES` |
| `ExtraRevenueType` | `RECOVERY_OF_OVERDUE` · `MANUAL_EXTRA_REVENUE` · `ONE_TIME_SERVICE` · `ADJUSTMENT` · `OTHER` |
| `ExtraRevenueOrigin` | `AUTOMATIC` · `MANUAL` |
| `ViewVisibility` | `PRIVATE` · `GLOBAL` |
| `ContractTemplateStatus` | `DRAFT` · `ACTIVE` · `ARCHIVED` |
| `GeneratedContractStatus` | `GENERATED` · `SENT` · `SIGNED` · `CANCELED` · `ARCHIVED` |
| `ContractCommercialType` | `MRR` · `TCV` · `ONE_TIME` · `CUSTOM` |
| `BillingModel` | `MONTHLY` · `UPFRONT` · `INSTALLMENTS` · `CUSTOM` |
| `ContractDurationType` | `MONTHLY` · `QUARTERLY` · `SEMIANNUAL` · `ANNUAL` · `CUSTOM` |
| `ClientDocumentType` | `CONTRACT` · `PROPOSAL` · `RECEIPT` · `BRIEFING` · `LEGAL_DOCUMENT` · `OTHER` |

**Campos string com domínio fixo** (não são enums no banco):

| Campo | Valores |
|---|---|
| `User.role` | `ADMIN` · `GESTOR` · `FINANCEIRO` · `ADMINISTRATIVO` · `COMERCIAL` · `COBRANCA` · `USER` |
| `Person.type` / `Transaction.belongsTo` | `pessoal` · `empresa` · `terceiro` · `familiar` |
| `Account.type` | `corrente` · `poupanca` · `dinheiro` · `investimento` |
| `CreditCard.type` | `pessoal` · `empresarial` · `terceiro` |
| `AccountCard.kind` | `fisico` · `virtual` |
| `Category.kind` | `despesa` · `receita` · `mista` |
| `Transaction.type` | `despesa` · `receita` · `transferencia` · `ajuste` |
| `Transaction.origin` | `cartao` · `pix` · `debito` · `boleto` · `dinheiro` |
| `Transaction.status` | `pendente` · `pago` · `devendo` · `reembolsado` · `cancelado` |
| `CreditCardInvoice.status` | `aberta` · `fechada` · `paga` · `atrasada` · `parcial` |
| `Income.sourceType` | `BANK_ACCOUNT` · `PIX` · `TRANSFER` · `CASH` |
| `Income.incomeType` | `SALARY` · `COMPANY_WITHDRAWAL` · `CLIENT` · `REIMBURSEMENT` · `SALE` · `LOAN_RECEIVED` · `OTHER` |
| `Income.status` | `RECEIVED` · `EXPECTED` · `LATE` · `CANCELED` |
| `CashBox.type` | `PERSONAL` · `EMERGENCY` · `INVESTMENT` · `COMPANY` · `GOAL` · `OTHER` |
| `CashBoxMovement.type` | `IN` · `OUT` |
| `PersonPayment.method` | `PIX` · `TRANSFER` · `CASH` · `OTHER` |
| `Receivable.status` | `aberto` · `pago` · `atrasado` · `renegociado` |
| `ClientRenewal.paymentMode` | `à vista` · `parcelado` · `mensal` |
| `ClientNote.type` | `observacao` · `comercial` · `negociacao` · `atendimento` · `alerta` |
| `RoutineItemState.itemType` / `.status` | `cobranca`/`pagamento`/`acao` — `removed`/`done` |

---

## 11. Como alimentar o sistema (todas as entradas de dados)

Existem **sete** caminhos de entrada de dados.

### 11.1 Formulários da interface (cadastro manual)

| Formulário | Campos (\* = obrigatório) |
|---|---|
| **Cliente** | Nome\* · WhatsApp/Telefone · E-mail · Status · Responsável (colaborador) · **Modalidade** (MRR/TCV) · Início da relação · *MRR:* Valor mensal\* + Dia recorrente de pagamento\* + Prazo (meses) · *TCV:* Valor total do contrato\* + Prazo (meses)\* · Razão social · CNPJ/CPF · Segmento · Cidade · UF · Endereço (usado nos contratos) · Representante legal · Origem · Responsável operacional · Tags · Observações |
| **Contato do cliente** | Nome · Cargo/função · E-mail · Telefone · Principal? · Observações |
| **Despesa** | Nome\* · Valor total\* · Vencimento\* · Tipo · Categoria · Status · Recorrência · Intervalo (meses, se personalizada) · Cartão/conta + Mês da fatura (se cartão) · Descrição · Escopo da edição (esta / esta e as próximas) |
| **Cobrança avulsa** | Cliente · Contrato · Serviço · Descrição · Competência · Valor · Vencimento · Tipo de receita · Observações |
| **Incluir cliente no mês** | Cliente · valor/vencimento herdados do cadastro (editáveis) · conta |
| **Inadimplência de mês anterior** | Cliente · competência · valor · vencimento |
| **Pagamento** | Valor · Data · Método (PIX/Transferência/Boleto/Cartão/Dinheiro/Outro) · Conta bancária · Observações |
| **Renovação ("Sim, renovou")** | Modalidade · Prazo (meses) · Valor mensal + dia de pagamento (MRR) ou valor total (TCV) · Forma de pagamento · Lançar nos recebimentos? + Competência · Status do pagamento (aberto / pago total / pago parcial) + valor pago · Detalhes |
| **Perda de cliente** | Data da perda · Motivo · (snapshot de valor e responsável é automático) |
| **Upsell** | Cliente · Serviço · Oferta · Título · Valor · Responsável · Status · Previsão de fechamento · Serviços com preço unitário · Observações |
| **Contrato (acordo)** | Cliente · Título · Tipo · Status · Recorrência · Valor mensal · Valor total · Setup · Início · Fim · Renovação · Dia de cobrança · Forma/modo de pagamento · Renovação automática · Serviços (quantidade × preço) · Observações |
| **Serviço** | Nome · Descrição · Categoria · Preço base · Custo estimado · Responsável padrão · Ativo |
| **Oferta (Plano)** | Nome · Descrição · Modalidade · Valor padrão · Duração (meses) · Forma de pagamento · Serviços incluídos · Ativa |
| **Colaborador** | Nome · Cargo · Vínculo · Salário base · Início · Fim · Pessoa vinculada · Observações |
| **Item de folha** | Colaborador · Tipo · Valor · Observação |
| **Comissão** | Colaborador · Cliente · Contrato · Base × % · Valor · Competência · Status |
| **Caixa/Reserva** | Nome · Tipo · Valor atual · Valor alvo · Conta vinculada · Observações |
| **Movimento de caixa** | Tipo (entrada/saída) · Valor · Data · Descrição |
| **Receita / Receita Extra** | Descrição · Valor · Data · Tipo · Origem · Conta · Pessoa · Cliente · Status |
| **Cartão / conta de cartão** | Nome · Banco · Tipo · Titular · Conta · Limite · Dia de fechamento · Dia de vencimento |
| **Cartão da conta** | Nome · Tipo (físico/virtual) · Últimos 4 dígitos · Limite · Observações |
| **Categoria** | Nome · Cor · Tipo · Categoria pai |
| **Regra de categoria** | Nome · Prioridade · Ativa · Condições (descrição contém, cartão, valor >, valor <) · Ações (categoria, responsável, pertence a, reembolsável, status) |
| **Usuário** | Nome · E-mail · Senha · Papel · Ativo · Pessoa vinculada · Ajustes de permissão |
| **Documento do cliente** | Nome · Descrição · Tipo · Arquivo |
| **Nota de contexto** | Título · Conteúdo · Tipo |
| **Meta anual** | Ano · Meta de faturamento |
| **Assistente IA** | Provedor · Base URL · Chave de API · Modelo · Temperatura · Ativo |

### 11.2 Gestos inline (a planilha viva)

Sem abrir formulário, direto na linha da tabela:

- Gestão do Mês: status 🟢🟡🔴 · modalidade · valor · vencimento · prazo.
- Carteira de clientes: status · modalidade · mês de renovação · valor mensal · observações ·
  célula **Pagamento (mês)** (que materializa a cobrança quando ela ainda não existe).
- Contas a pagar: marcar paga · alterar vencimento.
- Upsell: arrastar entre colunas do Kanban.
- Rotina: concluir/remover itens do dia.

Todos os gestos financeiros relevantes têm **Desfazer por 15 minutos**.

### 11.3 Importação em massa por planilha (`/importacoes`)

**Fluxo:** baixar modelo (`/importacoes/template?tipo=<modulo>`) → preencher → subir `.xlsx`/`.xls`
→ **prévia validada** linha a linha → confirmar. Nada é gravado antes da confirmação.

O modelo gerado traz duas abas: **Dados** (cabeçalhos + linha de exemplo) e **Instruções**
(obrigatoriedade, formato e opções válidas de cada coluna).

**Limites e validações:** máximo **500 linhas** por importação · tipos `text` / `date` (dd/mm/aaaa,
serial Excel, ISO) / `money` (`1234,56`, aceita `R$`) / `int` / `enum` (aceita **valor ou rótulo**) ·
datas impossíveis rejeitadas (31/02, ano fora de 1990-2100) · relacionamentos resolvidos **por
nome exato** (case-insensitive) · detecção de duplicidade **na planilha e contra o banco**.

#### As 8 planilhas disponíveis

**1. Clientes** — carteira de clientes
| Coluna | Tipo | Obrig. | Exemplo |
|---|---|---|---|
| Nome | texto | ✅ | Empresa Alfa |
| Razão social | texto | | Alfa Comércio LTDA |
| CNPJ/CPF | texto | | 12.345.678/0001-00 |
| E-mail | texto | | contato@alfa.com |
| Telefone | texto | | (71) 99999-0000 |
| Segmento | texto | | E-commerce |
| Cidade / UF | texto | | Salvador / BA |
| Origem | texto | | Indicação |
| Responsável comercial | texto | | Israel |
| Dia de pagamento | inteiro (1-31) | | 5 |
| Status | enum | | Ativo · Prospect · Inativo · Pausado · Renovação · Inadimplente · Perdido |
| Valor mensal (R$) | dinheiro | | 2500,00 |
| Observações | texto | | |

*Duplicidade:* nome normalizado. *Padrão:* status = `ACTIVE`.

**2. Serviços** — Nome\* · Categoria · Preço base (R$) · Custo estimado (R$) · Responsável padrão · Descrição.

**3. Colaboradores** — Nome\* · Cargo · Vínculo (PJ/CLT/Freelancer) · Salário fixo (R$) · Início · Observações.

**4. Acordos comerciais** — Cliente\* · Título do contrato\* · Tipo (Recorrente/Fechado/Avulso/Setup) ·
Recorrência (Mensal/Trimestral/Semestral/Anual/Sem recorrência) · Valor mensal · Valor total ·
Início\* · Fim · Dia de cobrança · Status · Renovação · Observações.
*Instruções:* cliente localizado pelo nome exato · informando só o valor total + data fim, o valor
mensal é derivado (e vice-versa) · **as cobranças NÃO são geradas na importação** — use
"Gerar cobranças" em `/acordos` depois.

**5. Cobranças** — Cliente\* · Descrição\* · Competência\* (mm/aaaa) · Valor (R$)\* · Vencimento\* ·
Tipo de receita · Contrato (título exato, opcional) · Observações.
*Instruções:* vencimento no passado entra automaticamente como **VENCIDA** · colisão com o índice
único de mensalidade é pulada (não derruba o lote).

**6. Receitas** — Data\* · Descrição\* · Valor (R$)\* · Status (Recebida/Prevista/Atrasada) ·
Cliente (opcional) · Tipo de receita · Observações.

**7. Despesas** — Data\* · Descrição\* · Valor (R$)\* · Status (Paga/Pendente) ·
Tipo (Fixa/Variável/Imposto/Ferramenta/Mídia-Ads/Outra) · Categoria (já cadastrada) ·
Cliente (aloca para rentabilidade) · Vencimento · Observações.

**8. Folha de pagamento** — Competência\* (mm/aaaa) · Colaborador\* · Tipo (Salário/Bônus/Comissão/
Benefício/Reembolso/Desconto) · Valor (R$)\* · Observação.
*Instruções:* colaborador pelo nome exato · se a folha da competência não existir, é criada como
**Rascunho** · descontos entram automaticamente como negativo.

### 11.4 Importação de fatura de cartão (CSV/XLSX ou PDF)

Diálogo em `/cartoes/[id]` com duas abas.

**CSV / XLSX** (`.csv`, `.xlsx`, `.xls`): leitura tolerante a separador, detecção de colunas,
prévia com duplicados marcados.

**PDF** (`pdf-parse`): detecção automática do **emissor** pelo cabeçalho (Nubank, Inter, C6,
Will Bank, Itaú, PicPay, Sicredi, Bradesco, Santander, Caixa, Banco do Brasil, Original, Next,
Neon, XP, BTG, Ame) com casamento automático dos cartões cadastrados; parsers dedicados
(`nubank-like`, `inter-like`, `itau-like`, `fatura-2026`, `generic-statement`).

**Fatura âncora** (mês de referência) resolvida nesta ordem: vencimento detectado no PDF →
fechamento detectado → inferido pela compra mais recente + dia de fechamento do cartão.
O **total declarado** no PDF é guardado (`declaredTotal`) para conferência com a soma importada.

**Enriquecimento automático de cada linha:**
- **hash único** (`transactionHash`) → duplicidade nunca entra duas vezes;
- **parcelamento** detectado no texto ("3/10") → `installmentNumber`/`installmentTotal` +
  `installmentGroupKey` (sha1 de cartão + descrição normalizada + valor + total);
- **herança de histórico**: categoria/pessoa/contexto herdados de uma parcela anterior
  reconhecida → `historyMatched = true`;
- **regras de categorização** aplicadas por prioridade;
- **cartão físico/virtual** identificado pelos 4 últimos dígitos quando o layout traz.

Cada importação vira um `ImportBatch` (total, importados, duplicados, erros), reversível.

### 11.5 Formulário público de contrato (`/f/[token]`)

Terceiros (o próprio cliente) preenchem as variáveis do modelo **sem login** e o contrato é gerado
dentro da plataforma. Link pode ser direcionado a um cliente (pré-preenche) ou geral.
Ver [§6.10](#610-contratos--documentos-contratos).

### 11.6 Upload de arquivos

| Tipo | Onde | Destino |
|---|---|---|
| Modelo de contrato `.docx` | `/contratos` | `ContractTemplate` (arquivo imutável + variáveis extraídas) |
| Documento do cliente | Área do cliente → Documentos | `ClientDocument` |
| Fatura `.pdf` / `.csv` / `.xlsx` | `/cartoes/[id]` | transações + `CreditCardInvoice` |
| Planilha de importação `.xlsx` | `/importacoes` | conforme o módulo |

Storage: Supabase (bucket privado `B2C_STORAGE_BUCKET`) em produção; disco `.uploads/` em dev.
O banco guarda apenas caminho + metadados. Download sempre autenticado via `/api/arquivos/*`.

### 11.7 Seed inicial (`npm run db:seed`, create-only)

Cria: usuário **admin** (senha de `ADMIN_PASSWORD`, sem fallback) · 6 Pessoas ·
9 cartões de exemplo · conta "Conta Principal" · **16 categorias** (Pessoal, Empresa, Família,
Terceiros, Carro, Cabelo/Estética, Luz/Água, Tráfego Pago, Ferramentas, Alimentação, Transporte,
Lazer, Reserva de Emergência, Investimentos, Reembolsável, Dívida a Receber) ·
**8 regras de categorização** (META/ADS, Facebook, Google, ADS, Uber, Posto, COELBA, EMBASA).

---

## 12. Saídas: relatórios, exportação e documentos

| Saída | Formato | Onde |
|---|---|---|
| 18 relatórios com filtros, agrupamento e totais | tela | `/relatorios/[tipo]` |
| Exportação de relatório | **CSV** e **XLSX** | `/relatorios/[tipo]/export?formato=` |
| Planilha modelo de importação | XLSX (2 abas) | `/importacoes/template?tipo=` |
| Contrato preenchido | **DOCX** | `/api/arquivos/contrato/[id]` |
| Modelo original de contrato | DOCX | `/api/arquivos/modelo/[id]` |
| Documento do cliente | arquivo original | `/api/arquivos/documento/[id]` |
| Mensagem de cobrança (7 tons) | texto para WhatsApp | diálogo em Gestão do Mês / Rotina / Inadimplência |
| Relatórios executivos da IA | Markdown na tela | `/assistente` |
| Impressão | CSS `print:hidden` nas telas operacionais | qualquer módulo |

---

## 13. Assistente de IA

### Configuração (`AISetting`, singleton, admin)

Provedor (`openai` · `anthropic` · `custom` compatível-OpenAI: OpenRouter, Groq, local) ·
Base URL · Chave de API · Modelo · Temperatura (padrão 0.3) · Ativo.
Há um **teste de conexão**. Sem configuração completa, o assistente responde com instrução amigável.

### Dois system prompts

| Prompt | Para quem | Contexto injetado a cada mensagem |
|---|---|---|
| **BASE_ROLE** (copiloto pessoal) | usuários não-admin | "Retrato financeiro atual" (finanças pessoais) + memória |
| **AGENCY_ROLE** (copiloto da agência) | ADMIN | "Retrato da agência" + "Retrato pessoal do usuário" + memória |

**Retrato da agência** (`ai/agency-context.ts`): faturamento esperado/recebido/pendente/vencido ·
MRR · TCV · clientes · contratos e renovações · inadimplência detalhada por cliente ·
despesas (fixas/variáveis/folha) · caixa atual e projeções 30/60/90 · renovações e perdas ·
tendências de 6 meses · rankings por cliente/serviço/categoria · próximos vencimentos · alertas.

**Retrato pessoal** (`ai/context.ts`): visão do mês · saúde financeira · gastos por categoria e por
pertencimento · cartões e faturas · quem me deve · metas · transações recentes.

### Guardrails codificados no prompt

- O retrato é a **única** fonte de verdade — proibido inventar dados; "não tenho esse dado no
  snapshot" é resposta válida e preferida a estimativa.
- Diferenciar sempre **fato × projeção × sugestão**.
- Isolamento: nunca mencionar, comparar ou supor dados de outros usuários.
- Não prometer retorno de investimento nem agir como consultor regulado.
- Formato Markdown limpo, valores em R$ padrão brasileiro, próximos passos numerados e
  priorizados por impacto.
- Conceitos do ERP explicitados no prompt (MRR, TCV, esperado × recebido, lucro, margem,
  folha saudável ≤40%, aging 1-15/16-30/31-60/60+, base da projeção de caixa).

### Funcionalidades

- **Chat** com histórico por conversa (limite de 12 mensagens de contexto), contagem de tokens.
- **Insights**: relatório personalizado com seções fixas (Resumo · Alertas · Dicas práticas ·
  Boas práticas · Próximos passos). Extrai 1-3 memórias automáticas da resposta.
- **8 relatórios executivos**: Resumo financeiro do mês · Plano de ação semanal ·
  Relatório de inadimplência · Análise de saúde financeira · Projeção de caixa ·
  Análise de clientes críticos · Análise de despesas · Análise de crescimento.
- **Memória** (`AIMemory`): fatos duráveis (fact/pattern/preference/alert/note), manuais ou
  automáticos, com pin. Isolada por usuário.
- **Sugestões na Rotina Diária** (`generateRoutineSuggestions`).

---

## 14. Operação: ambiente, deploy, scripts e performance

### Variáveis de ambiente

| Variável | Uso |
|---|---|
| `POSTGRES_PRISMA_URL` | conexão pooled (runtime) — **obrigatória** |
| `POSTGRES_URL_NON_POOLING` | conexão direta (migrations) — **obrigatória** |
| `SESSION_SECRET` | assinatura HMAC das sessões — **obrigatória em produção** (boot falha sem ela) |
| `ADMIN_PASSWORD` (+ `ADMIN_NAME`, `ADMIN_EMAIL`) | admin criado pelo seed (sem fallback) |
| `SUPABASE_SERVICE_ROLE_KEY` + `B2C_STORAGE_BUCKET` | storage de arquivos (opcional em dev) |
| `PRISMA_LOG=1` | mostra cada query SQL com duração (profiling) |

Nunca usar prefixo `NEXT_PUBLIC_` em variável sensível. Nunca versionar `.env*`.

### Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | desenvolvimento (lento — nunca julgue performance nele) |
| `npm run build:ci` | **validar build** (typecheck + build, não toca no banco) |
| `npm run build` | ⚠️ roda `prisma migrate deploy` **no banco real** — só a Vercel usa |
| `npm start` | servir o build de produção localmente |
| `npm run db:seed` | seed inicial (create-only) |
| `npm run db:migrate:deploy` / `db:push` / `db:baseline` | ferramentas de migração |
| `npm run prisma:migrate` / `prisma:studio` / `prisma:generate` | ferramentas Prisma |

Scripts de tooling em `scripts/`: `backfill-sales-owner.ts` · `env.ts` · `mint-token.ts` ·
`validate-integrity.js` + `validate-data-integrity.sql` · `wipe-data.ts` (⚠️ destrutivo).

> ⚠️ O `.env` local aponta para o **banco de produção**. Rodar o app localmente lê/escreve dados
> reais. Nunca rode `wipe-data.ts`, seeds destrutivos ou `prisma migrate reset` sem confirmar 3×.

### Deploy

- **A Vercel publica** via integração Git nativa: push na `main` → produção; PR → preview.
- O GitHub Actions (`.github/workflows/deploy.yml`) é **só portão de qualidade**: lint +
  `build:ci`. Não há passo de deploy ali de propósito (duplicaria a publicação).
- `vercel.json`: região `gru1` (banco em São Paulo) + cabeçalhos de segurança + cache de estáticos.
  Não re-adicionar chaves legadas (`name`, `version`, `public`, `env`) — a Vercel rejeita o deploy.
- Nunca commitar direto na `main`; branch + commits pequenos + `build:ci` verde antes de cada commit.

### Regras de performance (aprendidas com números reais)

O Dashboard já custou **4,4s e 405 queries por clique**; hoje custa **0,9s e 12**.

- **Nada de escrita em caminho de leitura.** Manutenções periódicas usam throttle
  (`markOverdueBillings`, `ensureMonthlyBillings` com TTL de 1h por dono+competência).
- **Nada de query em loop (N+1).** Usar `createMany`, `updateMany` com `id: { in: [...] }`, ou
  buscar tudo com `findMany` e agrupar em JS ("bucketize").
- **`findMany` sempre com `take`** em listas que podem crescer.
- **Pool da Vercel ≈ 5 conexões** → páginas pesadas buscam em **FASES sequenciais**, nunca um
  `Promise.all` gigante (lição do crash do Dashboard). A Gestão do Mês usa fases A→B→C→D.
- Biblioteca pesada nunca no bundle inicial: `recharts` via `next/dynamic`;
  `xlsx`, `pdf-parse`, `docxtemplater` só em código server.
- Cada roundtrip ao banco custa ~60-120ms — pense em "quantas queries essa página dispara?".

### Helpers únicos (não duplicar)

| Precisa de | Importar de |
|---|---|
| `toNumber`, `clean`, `formatBRL`, `formatBRL0`, `formatBRLShort`, `parseBRL`, `formatDecimalInput`, `formatDateBR`, `parseDateBR`, `parseMonthParam`, `MONTHS_PT`, `MONTHS_PT_SHORT`, `monthRange`, `monthLabel` | `@/lib/format` |
| `BILLING_OPEN_STATUSES`, `BILLING_AWAITING_STATUSES`, `MONEY_EPSILON` | `@/lib/billing-status` |
| Rótulos/badges/tintura de status | `@/lib/status-meta` e os `_meta.ts` por módulo |
| `cn()` | `@/lib/utils` |

Já existiram **16 cópias** de `toNumber` e **9** de `clean` neste código.

---

## 15. Capacidades, limites e pendências conhecidas

### O que o sistema faz bem hoje

✅ Fecha o mês inteiro numa tela só, no vocabulário da planilha (🟢🟡🔴) com pagamento em 1 clique e Desfazer
✅ Trata MRR e TCV com regras contábeis distintas e coerentes em todas as superfícies
✅ Classifica corretamente pagamento no prazo / com atraso / em outro mês (recuperação)
✅ Renovação como fluxo único, atômico, auditável e à prova de duplo clique
✅ Cobrança operacional com fila priorizada por score e mensagens prontas em 7 tons
✅ Contratos DOCX com variáveis, pré-preenchimento e link público sem login
✅ Importação em massa validada (7 módulos) + fatura de cartão por PDF de 17 emissores
✅ 18 relatórios exportáveis sem alterar dado original
✅ RBAC granular (63 permissões) com gates que também evitam queries desnecessárias
✅ Isolamento multiusuário fail-closed em toda query

### Limites atuais

| Limite | Detalhe |
|---|---|
| Importação | 500 linhas por planilha |
| Listas | `take` fixo por tela (cobranças 500, clientes 1000-2000, contratos 2000) |
| Pool de banco | ≈5 conexões (Vercel) — origem das fases sequenciais |
| `Category` | modelo **global**, sem `ownerId`, nome único global |
| Tipos monetários | núcleo pessoal legado ainda em `Float` (ERP já em `Decimal(14,2)`) |
| Storage local | `.uploads/` é efêmero na Vercel — produção exige Supabase |
| Rate limit de login | por instância Edge (memória) — complementado pelo bloqueio por conta no banco |

### Divergências conhecidas (auditoria 2026-07-20)

1. **Resultado/Margem — 2 definições.** Card: `recebido − despesas`. Saúde Financeira + IA:
   `lucro = receitas(caixa) − despesas pagas`. Mesmo mês → dois números. *Pendente unificar.*
2. **MRR — 5 definições.** Oficial: `getPeriodRevenue.mrr` (base `Client`). Paralelas: `mrrAtivo`,
   `receitaReconhecidaMes`, `series.mrr` (base `Contract`), `getYearlySeries.mrr`.
3. **"Previsto"/"Em aberto" — bases distintas.** Card usa `revenue.total(+extra)`;
   `expectedTotal` é outra métrica; `getCommercialKpis.faturamentoEsperado` usa `dueDate` (não
   competência) e alimenta só a IA.
4. **Recebido — 3 bases.** `receiptsCorrectMonth` (oficial) × `kpis.faturamentoRecebido` ×
   Σ `paidTotal` do grid da Gestão do Mês (visão operacional).
5. **`getLossSummary` ignora o período** (sempre mês corrente) — alimenta alertas/IA.
6. **Novos clientes**: card usa `startedAt`→`createdAt`; kpis usa só `createdAt`.
7. **Renovações**: `renewalMonth` (cards) × `renewalDate ≤30d` (kpis/contratos).
8. **Folha**: projeções ainda incluem payroll `DRAFT` (decisão pendente).
9. **Cálculos inline em páginas** (despesas, cobranças, projeções, inadimplência, receitas, caixa,
   rotina) — mudanças de regra exigem N edições; migração gradual para services.

### Débitos visuais conhecidos

- 183 classes de cor crua em 40 arquivos (migrar para tokens do design system).
- 6 tabelas sem fallback mobile (clientes/[id], contratos, contratos/[id], folha, importacoes, rotina).
- ~60 `alert()`/`confirm()` nativos — trocar por AlertDialog + toast.
- `EmptyState` adotado em poucos dos ~30 estados vazios.

### Models com pouco ou nenhum uso hoje

`Loan` · `ImportTemplate` · `ExportReport` · `FinancialAlert` · `Asset` · `Liability` —
candidatos a remoção ou ativação antes de uma migração de plano de contas
(ver [PLANO_DE_CONTAS_GERENCIAL.md](PLANO_DE_CONTAS_GERENCIAL.md)).

### Próximos passos mapeados

- Plano de contas gerencial (evoluir `Category` para conta gerencial com `ownerId`, código e
  grupo) e relatório de DRE gerencial.
- Unificar as definições divergentes de Resultado/Margem e MRR.
- Migrar `Float` → `Decimal` no núcleo pessoal.
- Consolidar os 4 componentes de KPI num só.
- Preparação para Open Finance já existe no schema (`externalId` em `Transaction` e
  `CreditCardInvoice`).

---

*Documento gerado a partir do código-fonte em 29/08/2026. Ao mudar regra de negócio, atualize
também [METRICAS_FINANCEIRAS.md](METRICAS_FINANCEIRAS.md) e [SPEC.md](../SPEC.md).*
