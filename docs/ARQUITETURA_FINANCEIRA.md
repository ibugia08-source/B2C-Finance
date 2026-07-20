# Arquitetura Financeira — B2C Finance (2026-07-20)

Mapa de onde cada cálculo vive, quem consome o quê, e as divergências conhecidas.
Complementa `docs/METRICAS_FINANCEIRAS.md` (fórmulas oficiais).

## Camadas

```
src/lib/financial/calculations.ts      ← barrel "oficial" (re-exporta tudo)
src/lib/services/
  revenue-metrics.ts     ← REGRAS MRR/TCV/recebimentos (getPeriodRevenue,
                            getReceiptsSummary, churn, novos, renovações, perdas)
  dashboard-main.ts      ← métricas do Dashboard redesenhado (5 cards, séries
                            anuais, detalhes, resumo, comparativo, lançar-ao-caixa)
  dashboard-metrics.ts   ← orquestrador legado (getExecutiveDashboard, kpis,
                            séries 12m, breakdowns, saúde, alertas)
  finance-metrics.ts     ← resultado caixa (receitas/despesas/lucro), folha, caixa
  expense-metrics.ts     ← resumo de despesas do mês
  billing-metrics.ts     ← vencidos/aging/inadimplentes (global)
  client-metrics.ts      ← inadimplência do mês por cliente + risco individual
  contract-metrics.ts    ← mrrAtivo/tcvVendido/receitaReconhecida (base Contract)
  upsell-metrics.ts, receivables-cycle.ts, payment-accounting.ts ...
```

**Realidade de consumo:** só `dashboard/page.tsx` importa do barrel
`financial/calculations`; todas as outras páginas importam direto de
`services/*`. O barrel é conveniência, não enforcement.

## Fluxo de dados canônico (MRR/TCV)

```
Client (modality, monthlyValue, totalContractValue, paymentDay 1-31)
  └─ Contract (type MRR/TCV; TCV força recurrence=NONE, monthlyValue=0)
       └─ Billing (competenceMonth/Year, revenueType, dueDate, amount, paidTotal)
            └─ Payment (paidAt, amount)  → Income (espelho de caixa)
ExtraRevenue (origin=MANUAL)  → receita extra manual
Transaction (type=despesa)    → despesas   ·   PayrollItem → folha
CashBox/CashBoxMovement       → caixa/reservas
```

- MRR previsto NÃO depende de billing existir (Σ Client.monthlyValue dos MRR
  ativos) — imune a mensalidade não gerada.
- TCV previsto = billings TCV da competência (o cadastro TCV gera exatamente 1
  cobrança cheia no mês do fechamento).
- Recebido casa Payment.paidAt com a competência (pagou no mês ou adiantado);
  atrasado de mês anterior vira RECUPERAÇÃO (não reabre o mês).

## Quem consome o quê

| Superfície | Fonte |
|---|---|
| Dashboard (5 cards, gráficos, resumo) | `getDashboardMainMetrics` + `getYearlySeries` (dashboard-main) |
| Dashboard (saúde, alertas, indicadores) | `getExecutiveDashboard` (dashboard-metrics) |
| Rotina diária | queue (billing-metrics/collection-priority) + billings diretos + getCashSummary |
| Clientes (KPIs) | counts diretos + client-metrics (inadimplência mês) |
| Recebimentos (grid) | receivables-cycle + KPIs do ciclo calculados na página (paidTotal) |
| Relatórios | reports/registry.ts (mistura getPeriodRevenue + agregações próprias) |
| IA (assistente/rotina) | ai/agency-context.ts → kpis (dashboard-metrics) + finance + séries |
| Projeções | getCashSummary + getPeriodRevenue + agregações inline na página |

## DIVERGÊNCIAS CONHECIDAS (auditoria 2026-07-20)

1. **Resultado/Margem — 2 definições.** Card: `recebido − despesas` /
   `resultado/recebido` (dashboard-main). Saúde Financeira + IA: `finance.lucro =
   receitas(caixa tx+income) − despesasPagas` e `margem = lucro/receitas`
   (finance-metrics). Mesmo mês → dois números. *Pendente: unificar a Saúde/IA
   na base do card.*
2. **MRR — 5 definições.** Oficial: getPeriodRevenue.mrr (base Client). Paralelas:
   mrrAtivo e receitaReconhecidaMes (Contract, snapshot/vigência — IA e Acordos),
   series.mrr (Contract — séries 12m), getYearlySeries.mrr (Client — gráfico
   anual). Se Client.monthlyValue ≠ Σ contratos, IA/Acordos divergem do Dashboard.
3. **"Previsto"/"Em aberto" — bases distintas.** Card usa revenue.total(+extra);
   `expectedTotal` (Σ todas as billings da competência, incl. SETUP/ONE_TIME) é
   outra métrica; getCommercialKpis.faturamentoEsperado usa **dueDate** (não
   competência) e receitaPendente/Vencida **globais** (sem período) — só IA.
4. **Recebido — 3 bases.** receiptsCorrectMonth (oficial) vs kpis.faturamento-
   Recebido (Payment por paidAt sem casar competência) vs Cobranças
   (Σ paidTotal do grid).
5. **getLossSummary ignora o período** (sempre mês corrente) — alimenta alertas/
   IA; getMonthlyChurn (período) alimenta o card.
6. **Novos clientes**: card usa startedAt→createdAt; kpis usa só createdAt.
7. **Renovações**: renewalMonth (cards) vs renewalDate ≤30d (kpis/contratos).
8. **Folha**: finance-metrics agora aplica sinal DEDUCTION (bug corrigido
   2026-07-20); projeções ainda inclui payroll DRAFT (decisão pendente).
9. **Cálculos inline em páginas** (despesas, cobranças, projeções, inadimplência,
   receitas, caixa, rotina, pessoas, registry) — mudanças de regra exigem N
   edições. Migrar gradualmente para services.

## Regras invioláveis (validadas na auditoria)

- ownerId: todas as queries passam pela extensão de `src/lib/prisma.ts`
  (fail-closed). Sem PrismaClient cru; $executeRaw só para advisory locks.
- TCV nunca rateado; nunca aparece como recorrência mensal.
- Receita Extra: apenas manual.
- Pool Vercel = 5 conexões → páginas pesadas buscam em FASES sequenciais
  (nunca um Promise.all gigante — lição do crash do Dashboard, fix f67220a).
- Datas de vencimento: dia 1-31 com clamp de fim de mês via
  `getValidDueDateForMonth` (lib/financial/due-date.ts) — único ponto.
