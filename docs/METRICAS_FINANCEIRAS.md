# Dicionário de Métricas Financeiras — B2C Finance

> **Atualizado em 2026-07-20 (auditoria completa).** Fonte da verdade para nomes,
> fórmulas e origem das métricas. Regra de ouro: antes de criar uma métrica nova,
> verifique se ela já existe aqui com outro nome.

**Camada central real:** `src/lib/services/dashboard-main.ts` (Dashboard) +
`src/lib/services/revenue-metrics.ts` (regras MRR/TCV/recebimentos) — re-exportadas
por `src/lib/financial/calculations.ts`. Ver `docs/ARQUITETURA_FINANCEIRA.md` para o
mapa completo e as divergências conhecidas.

Regras contábeis oficiais:
- **TCV nunca é rateado** — entra cheio no mês da adesão/fechamento/renovação
  (cobrança `Billing revenueType=TCV` na competência).
- **MRR** = Σ `Client.monthlyValue` dos clientes `modality=MRR` ativos no mês.
- **Receita Extra é apenas manual** (`ExtraRevenue origin=MANUAL` + `Income` avulsa
  sem cobrança). Nunca gerar automática.
- Pagamento de mês anterior recebido depois = **recuperação de inadimplência**
  (conta no mês do pagamento; o mês original permanece em aberto no fechamento).

---

## 1ª linha do Dashboard (fórmulas OFICIAIS — `getDashboardMainMetrics`)

| Métrica | Fórmula | Fonte |
|---|---|---|
| **Faturamento total** | `getPeriodRevenue().total` (MRR+TCV) **+ Receita Extra manual do mês** | `dashboard-main.ts` |
| **Total de despesas** | Σ `Transaction type=despesa ≠cancelado` no período | `finance-metrics.ts` (`getFinanceSummary.despesas`) |
| **Faturamento recebido** | `receiptsCorrectMonth` (pagos na competência + adiantamentos) **+ extra manual** | `revenue-metrics.ts` (`getReceiptsSummary`) |
| **Em aberto** | `max(0, Faturamento total − Recebido)` | `dashboard-main.ts` |
| **Vencido** (⊂ Em aberto) | Σ (amount−paidTotal) das cobranças abertas da competência com `dueDate < hoje` (`overdueOpenAmount`) | `revenue-metrics.ts` |
| **Resultado do mês** | `Recebido − Despesas` | `dashboard-main.ts` |
| **Margem operacional** | `Resultado / Recebido` (0 se nada recebido) | `dashboard-main.ts` |

Decisões documentadas:
- **Clamp em 0** no Em aberto (adiantamento pode fazer Recebido > Previsto).
- A Receita Extra manual entra **dos dois lados** (previsto e recebido) — o Em
  aberto continua = previsto MRR/TCV − recebido de cobranças, coerente com
  Recebimentos e Rotina.
- **Rotina diária** usa a MESMA fórmula do Em aberto ("Falta receber") e o mesmo
  `overdueOpenAmount` ("Vencido do mês").
- ⚠️ `expectedTotal` (Σ TODAS as cobranças da competência, incl. SETUP/ONE_TIME)
  é uma métrica **diferente** do Faturamento total do card. Existe em
  `getReceiptsSummary` para usos contábeis por cobrança emitida. Não misturar.

## Comparativo com mês anterior
`getPreviousMonthComparison(current, previous, hadData)` (`dashboard-main.ts`) —
mês cheio compara com o mês-calendário anterior; intervalo livre, com janela de
mesmo tamanho. Sem base → "Sem dados do mês anterior".

## Faturamento MRR / TCV (mês)
- **MRR (oficial)** = `getPeriodRevenue().mrr` — Σ `Client.monthlyValue` dos
  clientes MRR ativos no mês (mês corrente exige ACTIVE/RENEWAL/DELINQUENT).
- **TCV (oficial)** = `getPeriodRevenue().tcv` — Σ `Billing revenueType=TCV` da
  competência (valor cheio, sem rateio).
- ⚠️ Definições PARALELAS que ainda existem (usos legados/IA — não usar em telas):
  `mrrAtivo` e `receitaReconhecidaMes` (base **Contract**), `series.mrr`
  (Contract, `getMonthlySeries`), `kpis.tcvVendido` (Contract.totalValue por
  startDate). Ver ARQUITETURA_FINANCEIRA.md.

## Séries anuais (gráficos do Dashboard)
`getYearlySeries(year)` (`dashboard-main.ts`): faturamento (MRR+TCV+extra),
despesas, recebido (por competência) e resultado — Jan..Dez do ano filtrado.

## Indicadores gerenciais
| Métrica | Fórmula oficial | Onde |
|---|---|---|
| Ticket médio geral | Faturamento total / clientes ativos | dashboard/page.tsx |
| Custo por cliente | Despesas / clientes ativos | `getMonthlyCostPerClient` |
| % Folha no faturamento | Folha do mês / Faturamento total | dashboard/page.tsx |
| % Recorrência | MRR / Faturamento total | dashboard/page.tsx |
| Folha (`folhaPeriodo`) | Σ PayrollItem (APPROVED/PAID) do mês, **DEDUCTION negativo** | `finance-metrics.ts` (bug do sinal corrigido em 2026-07-20) |
| Churn / Receita perdida | count/Σ `ClientLoss` por `lostAt` no período | `getMonthlyChurn` |
| Novos clientes | `startedAt` no período (fallback `createdAt`) + receita (MRR mensal / TCV total) | `getNewClientsSummary` |
| Renovações | `Client.renewalMonth == mês` (base ativa) | `getRenewalOutlook` |
| Inadimplência (mês) | = Vencido (`overdueOpenAmount`) | `revenue-metrics.ts` |
| Inadimplência (aging acumulado) | `getDelinquentClients` — OVERDUE global + buckets 1-15/16-30/31-60/60+ | `billing-metrics.ts` |
| Caixa disponível | Σ `Account.balance` + Σ `CashBox.currentAmount`; projeções 30/60/90 | `getCashSummary` |

## Módulo Clientes (KPIs da carteira)
Clientes ativos (status=ACTIVE) · Novos este mês (startedAt/createdAt no mês) ·
Perdidos este mês (CHURNED + churnedAt no mês) · Renovações próximas
(renewalMonth = mês atual, base ativa).

## Lançar ao caixa
Resultado positivo do mês pode ser lançado (total/parcial) ao "Caixa operacional"
(`launchResultToCash`). Anti-duplicidade: marcador `[resultado:YYYY-MM]` na
descrição do `CashBoxMovement`; disponível = resultado − já lançado.

## Funções legadas (mantidas por compatibilidade — NÃO usar em telas novas)
`getMonthlyExpectedRevenue/ReceivedRevenue/OpenRevenue/OverdueRevenue`,
`computeMonthlyResult/computeOperationalMargin` (aliases do dicionário antigo,
base `expectedTotal`), `getMonthlyAverageTicket` (Recebido/pagos — o card usa
previsto/ativos). Zero consumidores hoje; candidatas a remoção na próxima limpeza.

## Divergências conhecidas (ver ARQUITETURA_FINANCEIRA.md)
1. `finance.lucro/margem` (receitas caixa − despesas pagas) ≠ Resultado do card —
   usados pela Saúde Financeira e IA. **Pendente de unificação.**
2. `getCommercialKpis` usa bases globais/dueDate/createdAt — alimenta só a IA.
3. `getLossSummary` é sempre mês corrente (ignora filtro) — alimenta alertas.
4. Módulo Cobranças calcula KPIs do ciclo sobre `paidTotal` (visão operacional do
   grid) — difere do Recebido contábil por `Payment.paidAt`.
