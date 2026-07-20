# Design System — B2C Finance (2026-07-20)

Padrão institucional/financeiro (white-canvas, minimalista, editorial) com a
identidade B2C Gestão. Referência de construção: SaaS financeiro premium.

## Tokens (globals.css → tailwind)

| Token | Light | Uso |
|---|---|---|
| `--primary` | `#1E70D3` (212 75% 47%) | ÚNICO acento: CTAs, nav ativa, links, foco, série principal de gráfico |
| `--primary-active` / `--primary-disabled` | #195FB5 / #A8C7EA | press-state / disabled |
| `--background` | #F8FAFC | canvas |
| `--card` | #FFF | superfícies |
| `--success` / `--success-soft` | verde sóbrio / fundo suave | positivo/pago (texto/pill, nunca CTA) |
| `--destructive` | #DC2626 | negativo/vencido/perda |
| `--warning` / `--warning-soft` | âmbar sóbrio | atenção/a vencer |
| `--surface-soft` / `--surface-strong` | cinzas de apoio | busca pill, botão secundário, toggles |
| `--border` / `--border-soft` | #E2E8F0 / mais leve | divisores |
| `--radius` | 0.75rem | inputs (12px) |

Todos com par **dark** (`.dark`). Regra: nunca cor crua de Tailwind
(emerald/red/amber/blue-*) em UI — usar tokens; exceção: dataviz. Fundos suaves
sempre com par `dark:` (modelo: `bg-red-50 ... dark:bg-red-500/10 dark:text-red-300`).

## Tipografia

- **Inter** (next/font, `--font-inter`) para tudo; títulos por peso/tracking, não
  por fonte. H1 do PageHeader: `font-semibold tracking-[-0.02em]` (calmo, nunca 700+).
- **JetBrains Mono** (`--font-mono`) para **valores financeiros** via classe
  global `.stat-number` (mono + tabular-nums + weight 500; componentes usam
  font-semibold no valor). Aplicada em StatCard/MetricCard/SecondaryStat/KpiCard/
  MainChart.
- Formatação: `R$ 1.500,00` (formatBRL) · eixos `R$ 12 mil` (formatBRLShort) ·
  datas DD/MM/AAAA (formatDateBR) · meses Jan..Dez (MONTHS_PT_SHORT em format.ts).

## Formas (geometria editorial)

| Elemento | Radius |
|---|---|
| Botões e badges | pill (`rounded-full`) — global via ui/button e ui/badge |
| Inputs/selects | 12px (`rounded-lg`) |
| Cards | 16px (`rounded-2xl`, ui/card) |
| Modais | 24px (`rounded-2xl sm:rounded-[24px]`, p-5 sm:p-8) |
| Avatares/ícones | círculo |

## Componentes canônicos

| Necessidade | Componente | Nota |
|---|---|---|
| KPI simples | `components/stat-card.tsx` (StatCard) | 20 usos — o padrão |
| KPI com tooltip+detalhe | `components/dashboard/metric-card.tsx` | Dashboard; clique abre modal |
| KPI compacto agrupado | `components/dashboard/secondary-stat.tsx` | Dashboard |
| KPI com filtro por clique | `app/clientes/kpi-card.tsx` | ⚠️ backlog: consolidar os 4 em um |
| Tooltip de métrica "?" | `components/dashboard/metric-help.tsx` | hover desktop / toque mobile |
| Gráfico principal | `components/dashboard/main-chart.tsx` | Recharts, linha 2px, sem dots, grid vertical sutil, toggle Mensal/Acumulado pill, tooltip com variação; envolver em `ClientOnly` |
| Donut composição | `components/dashboard/composition-donut.tsx` | |
| Card de gráfico simples | `components/charts.tsx` (ChartCard + HBarList) | |
| Tabela responsiva | `components/ui/table.tsx` + `ui/record-card.tsx` (MobileCards) | padrão `hidden md:block` + cards no mobile |
| Estado vazio | `components/empty-state.tsx` | ⚠️ adotar nos ~30 "Nenhum..." soltos |
| Header de página | `components/page-header.tsx` | título + subtítulo específico + ações |
| Skeleton | `loading.tsx` por rota + `page-skeleton.tsx` | |

## Regras de uso

1. Azul B2C com moderação — 1-2 momentos por seção; verde/vermelho/âmbar são
   SEMÂNTICOS (nunca fundo de CTA).
2. Linhas de tabela: hover discreto (`hover:bg-muted/50`); linha clicável =
   `cursor-pointer` + `stopPropagation` nas células interativas; devendo/vencido
   = fundo vermelho MUITO suave (`bg-red-50/70 dark:bg-red-500/[0.07]`).
3. Próximo do vencimento = amarelo suave (`bg-warning-soft/60`).
4. Sem sombras pesadas: `shadow-sm` em cards, `shadow-modal` em modais,
   hover `shadow-md` apenas em clicáveis.
5. Animações discretas (page-enter, fades); NUNCA bounce/glow (removidos).
6. Touch: alvos ≥44px (`min-h-touch`); mobile sem scroll horizontal (tabelas →
   MobileCards).
7. Modais para ações rápidas; detalhe abre DENTRO do contexto (nunca redirect
   ao clicar em card de métrica).
8. Números sempre `.stat-number`/tabular-nums para comparação estável.

## Débitos visuais conhecidos (auditoria 2026-07-20)

- 183 classes de cor crua em 40 arquivos (top: projecoes/simulator, pessoas/[id],
  dashboard, stat-card) — migrar a tokens incrementalmente.
- 6 tabelas sem fallback mobile (clientes/[id], contratos, contratos/[id], folha,
  importacoes, rotina).
- ~60 alert()/confirm() nativos — trocar por AlertDialog + toast.
- EmptyState adotado em 2/30 estados vazios.
