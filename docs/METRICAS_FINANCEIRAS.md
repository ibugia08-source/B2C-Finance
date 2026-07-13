# Dicionário de Métricas Financeiras — B2C Finance

**Fonte da verdade** para nomes, significados e cálculos das métricas do sistema.
Regra de ouro: **antes de criar uma métrica nova, verifique se ela já existe aqui
com outro nome.** Toda métrica é calculada na camada central
(`src/lib/financial/calculations.ts` re-exporta `src/lib/services/*`) — nunca em
componente.

Regra contábil oficial: **Faturamento = Recebimentos no mês correto + Receitas Extras.**
Pagamento de mês anterior recebido depois = *inadimplência regularizada* (conta no mês
do pagamento; o mês original permanece não recebido). Receita Extra é **apenas manual**.
TCV nunca é rateado por mês.

---

## As 6 métricas da 1ª linha do Dashboard (fórmulas OBRIGATÓRIAS)

```
Faturamento total previsto = Σ cobranças da competência do mês (exceto canceladas)
Recebido                   = Σ pago dentro do mês de competência (+ adiantamentos)
Em aberto                  = max(Faturamento total previsto − Recebido, 0)
Falta receber (Rotina)     = Em aberto do mês vigente  ← MESMO cálculo, outro nome
Vencido                    = parte do Em aberto com vencimento passado (Vencido ⊂ Em aberto)
Resultado                  = Recebido − Despesas do mês
Margem Operacional         = Resultado / Recebido  (0 quando nada recebido)
```

Decisões documentadas:
- **Clamp em 0** no Em aberto: adiantamento de competência futura pode fazer
  Recebido > Previsto; nunca exibir valor negativo.
- **Margem sobre o Recebido** (não sobre o previsto): representa a margem
  sobre o que realmente entrou.
- **Inadimplência de meses anteriores NÃO entra** no Em aberto do mês atual —
  ela aparece no card próprio "A cobrar (vencido)" da Rotina e no módulo
  Inadimplência (aging acumulado).
- Funções oficiais em `lib/financial/calculations.ts`:
  `getMonthlyExpectedRevenue`, `getMonthlyReceivedRevenue`,
  `getMonthlyOpenRevenue`, `getMonthlyOverdueRevenue`,
  `computeMonthlyResult`, `computeOperationalMargin`
  (base: `getReceiptsSummary` → `expectedTotal`, `receiptsCorrectMonth`,
  `openMonth`, `overdueOpenAmount`).

## Recebimentos (dinheiro que entra de clientes)

| Métrica | Significado | Cálculo (campo na camada central) | Onde aparece |
|---|---|---|---|
| **Faturamento total previsto** | Tudo previsto para entrar no mês | `receipts.expectedTotal` | Dashboard L1 |
| **Recebido** | Pago dentro do mês de competência | `receipts.receiptsCorrectMonth` | Dashboard L1, Recebimentos, Relatório Recebimentos |
| **Em aberto / Falta receber** | Ainda falta receber no mês | `receipts.openMonth` = max(previsto − recebido, 0) | Dashboard L1, Rotina |
| **Vencido** | Parte do em aberto já vencida | `receipts.overdueOpenAmount` | Dashboard L1, Recebimentos, Inadimplência |
| **Faturamento (realizado)** | Fechamento oficial: recebido + recuperações + Receita Extra manual | `receipts.totalRevenue` | Relatório Executivo, IA |
| **A receber** (só em Recebimentos) | Em aberto + Vencido do mês selecionado | soma dos `openAmount` das cobranças do ciclo | Painel de Recebimentos |
| **MRR recebido** | Parte recorrente do Recebido | `receipts.mrrReceived` | Hint do card Recebido, Relatório MRR |
| **TCV recebido** | Parte de contratos fechados do Recebido (valor cheio no mês da adesão) | `receipts.tcvReceived` | Hint do card Recebido, Relatório TCV |
| **Clientes pagos** | Clientes com pagamento do mês registrado | `clientsBlock.pagosMes` / ciclo de Recebimentos | Dashboard L2, Recebimentos |
| **Clientes em aberto** | Clientes ainda sem pagamento no mês | `clientsBlock.devendoMes` (com override manual) | Dashboard L2, Rotina, Carteira |
| **Inadimplência regularizada** | Vencido de mês anterior pago depois | `receipts.paidDifferentMonthValue` (= `extraRevenueAutomatic`) | Dashboard (hint do Faturamento), Rotina |
| **Receita Extra (manual)** | Entradas avulsas cadastradas à mão | `receipts.extraRevenueManual` (ExtraRevenue MANUAL + Income sem cobrança) | Receitas, Relatório Receita Extra |

**Nomes proibidos** (ambíguos — não usar em telas novas): "Valor a receber",
"Valor pendente", "Receita esperada", "Faturamento esperado", "Previsto" para
receita de clientes.

## Despesas (dinheiro que sai)

| Métrica | Significado | Cálculo | Onde aparece |
|---|---|---|---|
| **Despesas do mês** | Total de despesas do mês (não canceladas) | `expenses.total` | Despesas, hint do Resultado |
| **Pagas** | Despesas quitadas | `expenses.paid` | Despesas |
| **Em aberto** | Pendentes dentro do prazo | `expenses.pending` | Despesas |
| **Vencidas** | Pendentes com vencimento passado (derivado, nunca gravado) | `expenses.overdue` | Dashboard L2, Despesas, Rotina |
| **Recorrentes** | Despesas com recorrência no mês | `expenses.recurring` | Despesas (Resumo) |
| **Cartão usado** | Limite usado nos cartões | `expenses.creditLimitUsed` | Despesas (Cartões) |
| **Limite disponível** | Limite livre nos cartões | `expenses.creditLimitAvailable` | Despesas (Cartões) |

## Resultado

| Métrica | Significado | Cálculo | Onde aparece |
|---|---|---|---|
| **Resultado** | Lucro/prejuízo do mês | `finance.lucro` = receitas − despesas pagas | Dashboard L1, Relatório Financeiro mensal |
| **Margem** | Resultado ÷ Faturamento | `finance.margem` (0–1, exibida em %) | Dashboard L1, Projeções |
| **Caixa estimado** | Caixa atual + a receber − a pagar | `cash.saldoPrevisto` | Hint do Resultado, módulo Caixa |

## Operação

| Métrica | Significado | Cálculo | Onde aparece |
|---|---|---|---|
| **Clientes ativos** | Status ACTIVE na Carteira | `clientsBlock.ativos` | Dashboard L2, Carteira |
| **Renovações do mês** | Clientes com `renewalMonth` = mês atual | `renewalOutlook[0]` (`getRenewalOutlook`) | Dashboard L2, Rotina, Relatório Renovações |
| **Upsell em aberto** | Oportunidades abertas + valor | `upsell.openCount` / `openValue` | Dashboard L2, Upsell, Rotina |

## Convenção de status (universal para dinheiro)

`Previsto → Recebido/Pago → Em aberto → Vencido` — nenhuma tela deve criar
sinônimos ("pendente", "atrasado", "a vencer") sem mapear para um destes.
Em Recebimentos, os detalhes de *como* foi pago aparecem no status da linha:
Pago · Pago com atraso · Recebido em outro mês (todos contam como "Pagos").

## Histórico de decisões

- 2026-07-12 — Simplificação geral: Dashboard reduzido a 3 linhas (15 cards);
  removidos os cálculos paralelos da antiga seção "Comercial & faturamento"
  da tela (MRR/TCV por contratos continuam no serviço apenas para a IA);
  relatórios 25 → 18 (removidos: margem-operacional, faturamento-total,
  pagamentos-atrasados, pagos-outro-mes, receita-perdida,
  rentabilidade-servico, projecao-financeira — todos recortes de outros).
- 2026-07-11 — Receita Extra passou a ser **apenas manual**; recuperação de
  inadimplência conta direto dos pagamentos.
- 2026-07-10 — Regra oficial de fechamento mensal implantada
  (`payment-accounting.ts`); TCV sem rateio.

## Indicadores gerenciais do mês (Bloco 2 do Dashboard)

| Métrica | Fórmula | Função oficial |
|---|---|---|
| Resultado do mês | Recebido − Despesas do mês | `computeMonthlyResult` / `getMonthlyResult` |
| Faturamento MRR (mês) | parte MRR do Recebido | `getMonthlyMrrRevenue` |
| Faturamento TCV (mês) | parte TCV do Recebido (valor cheio, sem rateio) | `getMonthlyTcvRevenue` |
| Ticket médio (mês) | Recebido ÷ clientes pagos (0 se nenhum) | `getMonthlyAverageTicket` |
| Custo por cliente | Despesas do mês ÷ clientes ativos (0 se nenhum) | `getMonthlyCostPerClient` |
| % Folha no faturamento | Folha do mês ÷ Recebido (dinheiro que entrou) | `getPayrollPercentageOfRevenue` |
| Churn de clientes (mês) | perdas com `lostAt` no período filtrado | `getMonthlyChurnCount` |
| Receita perdida (mês) | MRR = mensal perdido; TCV = última adesão | `getMonthlyLostRevenue` |
| Novos clientes (mês) | entrada = `startedAt` (fallback `createdAt`) no período | `getMonthlyNewClientsCount` |
| Receita de novos clientes | MRR = mensal; TCV = total do último contrato | `getMonthlyNewClientsRevenue` |
| Total inadimplência | = Vencido (parte vencida do Em Aberto) | `getMonthlyDelinquencyTotal` |

Análises visuais (abaixo dos indicadores): Receita por modalidade ·
Evolução financeira mensal · Recebimento do mês (recebido/aberto/vencido) ·
Novos clientes × churn · Receita perdida × novos clientes · % Folha (12m).
