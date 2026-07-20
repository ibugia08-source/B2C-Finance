# Auditoria Técnica — B2C Finance (2026-07-20)

Auditoria completa de estrutura, duplicação, camada financeira, schema Prisma,
CSS/UX e responsividade. Este documento registra o estado encontrado, o que foi
corrigido na hora e o backlog priorizado.

## 1. Testes técnicos

| Comando | Resultado |
|---|---|
| `npm run lint` (next lint) | ✅ 0 erros · 8 warnings pré-existentes (`<img>` em receitas/lazy-load/mascot, react-hooks em lazy-load) |
| `npx tsc --noEmit` (não há script `typecheck`) | ✅ 0 erros |
| `npm run build:ci` | ✅ Compila (31 rotas) |
| `npm run test` / `format` / `check` | não existem no package.json |

**Erro real encontrado e corrigido:** `.env.production` tinha 4 variáveis
auto-referentes (`JWT_SECRET=${JWT_SECRET}`, STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET,
SENDGRID_API_KEY) → recursão infinita no interpolador do `@next/env` →
`RangeError: Maximum call stack size exceeded` em todo build/start local.
Placeholders comentados (arquivo é gitignored; sem impacto no deploy).

## 2. Estrutura (mapa)

- **src/app** — 33 rotas/módulos (~177 arquivos). Maiores: clientes (27),
  cobrancas (17), cartoes (13), pessoas (13), contratos (10).
- **src/components** — 47 arquivos (25 raiz + dashboard/ 7 + report/ 2 + ui/ 14).
- **src/lib** — ~87 arquivos: actions/ (29 server actions), services/ (20),
  financial/ (3), reports/ (3), pdf/ (11), ai/ (4), auth/ (4), imports/ (2) etc.
- **Auth:** cookie HMAC `b2c_session` + middleware Edge (formato/exp/HMAC) +
  `getCurrentUser` (validação completa). Multi-tenant via extensão `ownerId` em
  `src/lib/prisma.ts` (OWNED_MODELS, fail-closed).
- **API routes:** 3 em /api/arquivos/* (download de arquivos) + 2 route.ts de
  export (importacoes/template, relatorios/[tipo]/export).

## 3. Código duplicado / redundante (top achados)

| # | Achado | Escala | Status |
|---|---|---|---|
| 1 | `row-actions.tsx` clonado | **15 cópias, 918 linhas** (esqueleto idêntico: Dialog+Pencil+Trash+confirm) | Backlog: extrair `<RowActions>` genérico |
| 2 | Helper `const n = (v)=>Number(v)` | **18 arquivos**, byte-idêntico | Canônico criado: `toNumber` em `lib/format.ts` (migração incremental) |
| 3 | Famílias de tabela paralelas | clientes/clients-* e cobrancas/receivables-* (~9 arquivos) reimplementam o que `responsive-table.tsx` faz p/ outros 18 módulos | Backlog (mudança grande) |
| 4 | 4 componentes de KPI-card | StatCard (global, 20 usos) + MetricCard + SecondaryStat (dashboard) + KpiCard (clientes) | Backlog: consolidar |
| 5 | Arquivos mortos | 10 confirmados com 0 importadores | ✅ **Removidos** (fab, lazy-load, period-filter, swipe-gesture, scroll-snap, pull-to-refresh, bar-chart, saved-views-bar, ui/bottom-sheet, clientes/contract-upload-dialog) |
| 6 | Exports mortos em charts.tsx | GroupedBarChart, DivergingBarChart, LineChart | ✅ **Removidos** (ficaram ChartCard + HBarList) |
| 7 | Arrays de meses PT-BR | 5 cópias idênticas | Canônico criado: `MONTHS_PT`/`MONTHS_PT_SHORT` em format.ts (migração incremental) |
| 8 | `*-dialog.tsx` de CRUD | ~31 arquivos com o mesmo padrão | Backlog (form genérico dirigido por schema — avaliar custo/benefício) |
| 9 | `filters.tsx` por módulo | 6 cópias da mecânica de query-string | Backlog |
| 10 | Parse de moeda reimplementado | 3 variantes locais (cobrancas parseMoneyParam, imports parseMoneyCell, reports parseMoney) + `monthRange` local em month-filter | Backlog (unificar em parseBRL/monthRange) |

Nota de verificação: `personal-dashboard.tsx` foi apontado como morto pelo scan
inicial, mas **tem importador** (dashboard/page.tsx) — mantido.

## 4. alert() / confirm()

**~25 `alert()` + ~35 `confirm()`** em ~26 arquivos (top: despesas/row-actions 9,
cobrancas/receivables-actions 8, folha/dialogs 7). Não existem primitives de
toast/AlertDialog. **Backlog prioritário de UX** — resolver junto com o
`<RowActions>` genérico (item 3.1) elimina a maioria de uma vez.

## 5. CSS / Design / Responsividade

- **Tokens**: sistema HSL bem estruturado (light+dark) em globals.css; tailwind
  mapeado; pill buttons/radius editorial/JetBrains Mono aplicados (2026-07-19).
- **183 classes de cor crua** (emerald/red/amber/blue/…) em 40 arquivos que
  deveriam usar tokens (`text-success/destructive/warning`). Top: projecoes/
  simulator (26), cobrancas/receivables-actions (23), pessoas/[id] (13),
  dashboard (10), stat-card (9). ✅ Dark-mode dos badges de status de Recebimentos
  corrigido (era o pior caso: ilegível no escuro). Restante: backlog incremental.
- **Tabelas sem versão mobile (6)**: clientes/[id], contratos, contratos/[id],
  folha, importacoes, rotina — podem estourar em telas pequenas. `ResponsiveTable`
  existe e não é usado por ninguém. Backlog.
- **EmptyState** usado em só 2 lugares vs ~30 arquivos com "Nenhum..." solto.
- **loading.tsx**: 29 rotas cobertas; ✅ adicionados em contratos/[id] e
  contratos/[id]/gerar (faltantes).
- Estilos inline: 24 usos, todos legítimos (safe-area/gráficos/valores dinâmicos).
- PageHeader: cobertura 100% das páginas de topo. Badges manuais: praticamente zero.

## 6. Riscos técnicos (ordenados)

1. **Divergências de métricas financeiras** (ver ARQUITETURA_FINANCEIRA.md):
   2 definições de Resultado/Margem, 5 de MRR, 4 de "em aberto"; 13 funções
   "oficiais" sem consumidores enquanto a lógica real vive em dashboard-main.
2. **Float para dinheiro** no núcleo legado (Transaction, Income, CashBox,
   Account.balance…) vs Decimal no ERP — soma mista reintroduz erro de ponto
   flutuante. Migração Float→Decimal exige recálculo de saldos (planejar).
3. **Status string minúscula vs enum MAIÚSCULO** convivendo no mesmo fluxo
   (228 literais minúsculos; ex.: rotina/page.tsx filtra Billing por enum e
   Transaction por string no mesmo arquivo; folha vira despesa via
   `status:"pago"` string).
4. **Pool de conexões (Vercel = 5)**: nunca voltar a Promise.all gigante em
   páginas pesadas (causou o crash do Dashboard; buscar em fases).
5. **Models mortos no schema**: Loan, ImportTemplate, ExportReport,
   FinancialAlert (0 usos) — remover exige migration; documentado, não aplicado.
6. ownerId: sem bypass real (nenhum PrismaClient cru; $executeRaw só advisory
   locks). Risco residual: update/delete por id único confiam no id escopado.

## 7. Correções aplicadas nesta auditoria (seguras)

1. `.env.production`: 4 placeholders auto-referentes comentados (RangeError em
   todo build eliminado).
2. **Bug de Folha**: `finance-metrics.ts folhaPeriodo` não aplicava o sinal de
   `kind=DEDUCTION` → superestimava a folha, `folhaSobreReceita`, "% Folha" e a
   Saúde Financeira. Corrigido (alinha com getPayrollSummary e as séries).
3. 10 arquivos mortos removidos + 3 exports mortos de charts.tsx.
4. Dark mode dos pills de status em cobrancas/receivables-actions.tsx e do pill
   MRR/TCV em receivables-row.tsx.
5. loading.tsx em contratos/[id] e contratos/[id]/gerar.
6. Canônicos criados em lib/format.ts: `toNumber`, `MONTHS_PT`, `MONTHS_PT_SHORT`.
7. docs/METRICAS_FINANCEIRAS.md reescrito para refletir o código real; criados
   ARQUITETURA_FINANCEIRA.md, PLANO_DE_CONTAS_GERENCIAL.md e DESIGN_SYSTEM.md.

## 8. Backlog priorizado (exige decisão/esforço maior — NÃO aplicado)

| Prioridade | Item | Esforço |
|---|---|---|
| P1 | Unificar Resultado/Margem (Saúde Financeira + IA → mesma base do card) | M |
| P1 | `<RowActions>` genérico + AlertDialog/toast (mata 15 clones + ~60 alert/confirm) | M |
| P1 | Plano de contas gerencial (ver PLANO_DE_CONTAS_GERENCIAL.md) | G |
| P2 | Versão mobile das 6 tabelas sem fallback | M |
| P2 | Tokens de cor nos 15 arquivos top de cor crua | M |
| P2 | Unificar as 5 definições de MRR (eleger Client como fonte, reconciliar IA/acordos) | M |
| P2 | EmptyState nos ~30 estados vazios soltos | P |
| P3 | Float→Decimal no núcleo legado (migration cuidadosa + recálculo) | G |
| P3 | Status minúsculo→enum (228 literais + backfill) | G |
| P3 | Remover models mortos (Loan, ImportTemplate, ExportReport, FinancialAlert) | P |
| P3 | Consolidar 4 KPI-cards em 1; filters genérico; dialog-form genérico | M |
