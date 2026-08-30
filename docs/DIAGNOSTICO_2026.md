# Diagnóstico 2026 e Reestruturação do Sistema — B2C Gestão

> Resultado da análise profunda da pasta `Reestruturacao/` (planilhas gerenciais
> de Jan–Ago/2026 + prints da planilha do dono), realizada em 29/08/2026.
> Os dados foram importados no ambiente de desenvolvimento
> (`scripts/import-reestruturacao.ts`) e batem com a planilha ao centavo.

## 1. A empresa nos números (Jan–Ago/2026)

| Mês | Esperado | Recebido | Realização | Despesas | Resultado |
|---|---:|---:|---:|---:|---:|
| Jan | 52.072 | 44.582 | 85,6% | 45.096 | −514 |
| Fev | 57.440 | 50.150 | 87,3% | 43.098 | **+7.052** |
| Mar | 79.050 | 73.260 | 92,7% | 53.916 | **+19.344** |
| Abr | 67.880 | 50.000 | 73,7% | 54.335 | −4.335 |
| Mai | 59.980 | 34.490 | 57,5% | 65.851 | **−31.361** |
| Jun | 78.890 | 44.600 | 56,5% | 82.353 | **−37.753** |
| Jul | 31.900 | 44.600 | 139,8%* | 65.488 | −20.888 |
| Ago (parcial) | 38.606 | 13.748 | 35,6% | 8.249** | — |

\* Julho recebeu mais do que emitiu: recuperação de meses anteriores + cobranças do mês não emitidas.
\** Agosto só tinha o tráfego lançado na planilha de despesas.

**Acumulado Jan–Jul: prejuízo de ≈ R$ 68 mil · margem −20%.**
Gap esperado−recebido no ano: **R$ 106 mil** (R$ 65,8 mil disso em clientes **ativos**).

## 2. As cinco descobertas centrais

1. **Churn é a causa-raiz.** 49 clientes perdidos em 8 meses. Vida mediana de
   **4,0 meses**; 84% das perdas acontecem até o 6º mês; **nenhum** perdido passou
   de 12 meses. Churn de agosto: **28%**.
2. **A empresa é uma esteira.** ~9 acordos novos/mês (73 em 2026) e 49 saídas.
   Da base pré-2026, 57% já morreu; dos novos de 2026, 34% morreram no próprio ano.
   LTV ≈ R$ 3,6–4,7 mil ≈ **3 mensalidades** — o cliente vai embora antes de pagar
   o custo de aquisição + operação.
3. **O prejuízo veio de uma dupla pinça.** Recebimento despencou (92,7% → 56,5% de
   realização) ENQUANTO a despesa subiu 91% (43k fev → 82k jun). A categoria
   "Operacionais/Aluguel" saltou de 10k para 38k em junho — é a válvula sem
   detalhamento que precisa ser aberta.
4. **As óticas são o núcleo saudável.** 32 óticas, 22 ativas (69% de retenção vs
   43% no resto), 37% do MRR ativo, ticket acima da média (R$ 1.365) — carteira
   do Sucesso do Cliente (LUENDEL), com **zero perdas**. As 49 perdas estão 100%
   na carteira geral (ALVARO, 63 clientes → restam 14).
   **O modelo nicho + CS dedicado retém; o modelo generalista sangra.**
5. **Vazamento operacional de cobrança.** Julho teve mais recebimento que emissão;
   agosto tinha 13 ativos sem cobrança emitida. (O sistema já corrige isso:
   mensalidades MRR são geradas automaticamente — na importação, 9 cobranças de
   agosto foram criadas na hora pelo ciclo.)

## 3. Nota de fidelidade dos dados

Os **totais mensais** (esperado, recebido, despesas, folha) são reais — conferem
com a planilha do dono. O **rateio por cliente** dos recebimentos foi feito
proporcionalmente na origem (todo cliente de um mês tem o mesmo fator de
realização). Portanto: análises agregadas e por coorte são confiáveis; o **saldo
individual histórico de cada cliente não deve virar cobrança** — cada registro
importado carrega essa nota no próprio banco.

## 4. O que foi readequado no sistema (fase 1 — entregue)

| Mudança | Onde | Por quê |
|---|---|---|
| **Módulo Retenção** (novo) | `/retencao` · `retention-metrics.ts` | Churn mensal, vida/LTV, coortes de sobrevivência, perdas por responsável e segmento e a **Zona de Risco** (ativos com 2–6 meses de casa — 54 clientes hoje). Nada disso existia em tela. |
| **% Realização no Dashboard** | grupo Receita | A régua central da planilha do dono (recebido ÷ esperado) não existia como métrica. |
| **Churn no score de saúde** | `computeHealth` | O score ignorava churn — a empresa marcava "estável" perdendo 28% da base/mês. Agora: >10% = −20 pts, >5% = −10 pts. |
| **Importador do histórico 2026** | `scripts/import-reestruturacao.ts` | Sistema de desenvolvimento agora opera sobre a empresa real (115 clientes, 477 cobranças, 560 pagamentos, folha, despesas). Conferência automática contra a planilha. |
| **Correção crítica de escopo** | `owner-scope.ts` | O AsyncLocalStorage podia ser instanciado 2× pelo bundler → toda métrica cacheada zerava (fail-closed). Storage agora é singleton global por processo. |

## 5. Roadmap (fases seguintes)

**Fase 2 — Retenção operacional**
- Motivo de perda estruturado (enum + diálogo na marcação de perda) — hoje é texto livre.
- Zona de risco na Rotina Diária (contato proativo no mês 2–3 do cliente).
- Health score por cliente (atraso + idade + engajamento).

**Fase 3 — Comercial por nicho**
- KPIs por segmento no módulo Clientes (óticas provaram ser o eixo).
- Metas por responsável (carteira × retenção × cobrança).
- Relatório exportável de coortes/retenção.

**Fase 4 — Custos e caixa**
- Abrir a categoria-válvula "Operacionais/Aluguel" (orçamento por categoria + alerta de estouro).
- Runway/fluxo de caixa em destaque no Dashboard (7 meses de prejuízo = caixa é sobrevivência).
- Playbook de replicação do modelo óticas (nicho + CS) como processo no sistema.

## 6. Para onde a empresa aponta sem mudança

Com churn de agosto (28%) e entrada média (~9/mês × ticket R$ 1.239), a base de
66 ativos encolhe: a perda potencial mensal (R$ 15–22k de MRR) supera a entrada
(R$ 11k). A prioridade absoluta é **retenção nos meses 2–6** e **réplica do
modelo óticas** — não aquisição.
