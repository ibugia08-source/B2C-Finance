# B2C FINANCE 2.2 - PLANO DE EXECUÇÃO (EXECUTAR.md)

Este arquivo é o motor de execução do projeto. Os 3 arquivos de especificação (01-dominio-e-regras.md, 02-produto-ux-design.md, 03-engenharia-seguranca-roadmap.md) dizem O QUE o sistema é; este diz O QUE FAZER, em ordem. O repositório base é o B2C Finance v1: as tarefas evoluem esse código, não criam projeto novo.

## PROTOCOLO DE EXECUÇÃO (leia e siga em toda sessão)

1. Execute UMA tarefa por vez, na ordem, pegando a primeira desmarcada [ ] da fase mais baixa. Não pule fases: a ordem é dependência arquitetural, não preferência.
2. Antes de codar a tarefa, leia SOMENTE as seções de spec referenciadas nela (grep pelo título). Não releia arquivos inteiros.
3. Ao concluir: rode os testes da tarefa, marque [x], acrescente uma linha no bloco DIÁRIO no fim deste arquivo (data, tarefa, arquivos tocados, observações) e faça commit atômico com mensagem "fase-N: <id da tarefa>". Nunca commite na main.
4. Se a tarefa depender de uma decisão aberta (marcada DECISÃO), pare, liste a pergunta objetivamente e aguarde; não invente regra financeira nem assuma default não aprovado.
5. Toda mutação financeira nasce em serviço de domínio (03 seção 4.1); idempotência em unique constraint; dinheiro Decimal(14,2); competência YYYY-MM explícita; UTC. UI só com tokens; termo de arquitetura nunca aparece em tela.
6. Tarefas com prefixo [SCHEMA] alteram o Prisma: gere migration nomeada, nunca use db push, nunca rode contra produção; ambiente exige ALLOW_DESTRUCTIVE=true para scripts destrutivos.
7. Ao fim de cada fase, execute o bloco GATE da fase: os cenários citados devem passar em staging com dados migrados antes de abrir a fase seguinte.

-

## FASE 0 - FUNDAÇÃO DE SEGURANÇA E PREPARO

Objetivo: rede de proteção antes de mexer no que funciona.

- [x] F0.1 Ambientes: criar projeto/banco de staging separado; ajustar .env.example para nunca apontar produção por padrão; guard ALLOW_DESTRUCTIVE=true + APP_ENV explícito em todo script destrutivo existente em /scripts. Ref: 03 4.6.
- [x] F0.2 Suíte de proteção do v1: escrever testes sobre o código ATUAL cobrindo settle/revert nas 3 situações de pagamento, dedupe de geração de mensalidade, clamp de datas (getValidDueDateForMonth, addMonthsClamped), reversão de renovação. Eles são a rede antes do refactor. Ref: 01 3.3-3.5; 03 4.5.
- [x] F0.3 [SCHEMA] Float -> Decimal(14,2) em Transaction, Income, CashBox e demais campos monetários remanescentes; migration com backfill verificado por soma antes/depois; atualizar helpers de formato para Decimal. Ref: 01 3.14.
- [x] F0.4 [SCHEMA] Temporalidade: garantir competence como string YYYY-MM indexada onde hoje é mês/ano separados ou data; timestamps UTC; timezone America/Bahia no Workspace. Ref: 01 3.15.
- [x] F0.5 [SCHEMA] Criar LegalEntity (nomeLegal, nomeFantasia, cnpj, regimeTributario, inscricoes, timezone, currency, taxSettings, active) e Agencia (nome, slug, cor, legalEntityId, active); seed 1:1 espelhado para o workspace atual (B2C Gestão). Ref: 01 4.2.
- [x] F0.6 [SCHEMA] Plano de contas: evoluir Category para AccountingAccount com code, name, parentId, group, accountType, normalBalance, statementType, isPostingAccount, active, ownerId; seed da estrutura de 15 grupos; conta "Não classificado" temporária. Ref: 03 2.2.
- [x] F0.7 MetricRegistry v1: criar MetricDefinition e registrar as métricas da seção 7 do arquivo 01 com versão 1 (chave, fórmula descritiva, grain, dateBasis, rounding, nullPolicy); criar módulo metric-engine que expõe cada métrica por chave; substituir os cálculos inline do Dashboard atual por chamadas ao engine SEM mudar resultados (paridade por fixture). Ref: 01 7; 03 4.1.
- [x] F0.8 Matriz canônica: implementar AccountingEngine com PostingRule versionada e a tabela de eventos de 01 3.10 como seed; nesta fase apenas os eventos de receita reconhecida, recebimento, despesa reconhecida/paga; postagem ainda atrás de feature flag ledger_enabled. Ref: 01 3.10-3.11; 03 4.1.
- [x] F0.9 [SCHEMA] Constraints de idempotência: uniques de 03 4.3 (geração MRR, parcela TCV, Payment externalId, LedgerTransaction source+postingType, avaliação relação+competência); checks de debit/credit. Ref: 03 4.3.
- [x] F0.10 Transactional Outbox: model OutboxEvent (status, tentativas, dedupeKey, payload) + worker com retry exponencial e dead-letter; sem consumidores ainda. Ref: 03 4.2.
- [ ] F0.11 Desenho de cutover: script dry-run que extrai do banco v1 os saldos de abertura (contas, reservas, receber aberto, pagar, cartões, folha a pagar, empréstimos) e gera relatório de conferência. DECISÃO 19.32: data oficial de cutover. Ref: 03 3.2.
- [ ] F0.12 CI: build:ci + testes como gate de merge; lint proibindo cor crua de Tailwind fora de dataviz (regra inicial permissiva com allowlist do legado). Ref: 02 7.10; 03 4.6.

GATE F0: F0.2 e F0.7 verdes com paridade; dry-run F0.11 rodando; nenhuma DECISÃO da fase pendente.

-

## FASE 1 - FUNDAÇÃO FINANCEIRA E MULTIAGÊNCIA

Objetivo: paridade com o v1, já multiagência, com termos por vigência e ledger mínimo.

Modelo:
- [ ] F1.1 [SCHEMA] Client mestre + ClientAgencyRelationship (lifecycleStatus, financialStatus cache, renewalStatus cache, onboardingStatus, startedAt, pausedAt, churnedAt, endedAt, currentCommercialTermId); migrar cada Client atual para 1 relação com a agência B2C Gestão; mover ClientLoss, CollectionHistory, AvaliacaoMensal (nova), OnboardingTask (nova) para a relação. Ref: 01 4.3, 3.9.
- [ ] F1.2 [SCHEMA] CommercialTerm (modality, monthlyValue, totalContractValue, contractMonths, validFrom, validTo, contractId, reason); backfill: 1 termo por cliente a partir do cadastro atual com validFrom = startedAt; Client.monthlyValue vira cache documentado. Ref: 01 4.4.
- [ ] F1.3 [SCHEMA] ClientManagerAssignment (role MANAGER_1|MANAGER_2|COMMERCIAL_ORIGIN|SDR_ORIGIN, vigência); backfill de salesOwner/opsOwner. Ref: 01 4.3.
- [ ] F1.4 [SCHEMA] Billing 2.0: billingKind, recognitionMode, installmentGroupId/Number, relationshipId; PaymentApplication (N:N Payment x Billing) com backfill 1:1 dos pagamentos existentes; CustomerCredit + CustomerCreditMovement; paidTotal passa a derivado das aplicações. Ref: 01 4.5, 3.3.
- [ ] F1.5 Engines: extrair BillingEngine, PaymentEngine (settleBilling com pipeline permission -> period guard -> idempotency -> Payment -> Application -> AccountingEngine -> AuditLog -> Outbox -> commit), ExpenseEngine; pages/actions passam a chamar engines, nunca Prisma direto para fatos financeiros. Ref: 03 4.1.
- [ ] F1.6 Ledger mínimo ligado: ativar ledger_enabled para receitas e despesas principais; job de verificação débito=crédito. Ref: 01 3.10, 5.4.
- [ ] F1.7 TCV parcelado: geração de N Billings por installmentGroup com residual na última; métricas TCV vendido x TCV faturado no registry. Ref: 01 3.7.
- [ ] F1.8 Excedente/crédito: pagamento maior cria crédito com toast da Camada de Simplicidade; aplicação de crédito em cobrança futura. Ref: 01 3.12; 02 1.
- [ ] F1.9 [SCHEMA] AuditLog append-only campo a campo nas entidades financeiras e de carteira, com origem e motivo; helper único de escrita. Ref: 01 4.10.

Segurança:
- [ ] F1.10 RBAC estendido com as permissões novas de 03 1.2; escopos workspace|legalEntity|agency|meus clientes; permissão de campo para valores sensíveis. Ref: 03 1.1-1.2.
- [ ] F1.11 Cache seguro: chaves de ownerCached ganham legalEntityId/agencyId, userScope, permissionFingerprint, competence, metricVersion; teste provando que cache de Admin não serve Gestor. Ref: 03 1.4.
- [ ] F1.12 RLS: revisar policies para as tabelas novas; teste de isolamento de escopo. Ref: 03 1.4.

Produto:
- [ ] F1.13 Design tokens: implementar fundações de 02 7.2 (escalas, semânticos, dark de primeira classe, tipografia, espaçamento, elevação); unificar o azul institucional; migrar componentes canônicos existentes para tokens. Ref: 02 7.1-7.2; decisão 19.5.
- [ ] F1.14 Barra global: MonthNav + seletor de escopo (Todas | EntidadeLegal | Agência) + busca global (/), com índice local da carteira; paleta de comandos Ctrl/Cmd+K com registro de comandos respeitando RBAC; atalhos g m, g c, g r, [, ], ?. Ref: 02 2-3.
- [ ] F1.15 Gestão do Mês 2.0: manter as 5 seções; card renomeado "Projeção do mês"; recebimentos distinguem competência x recuperação; coluna opcional estabilidade/risco; estado do período no cabeçalho; gestos otimistas conforme tabela de 02 7.7 com undo-toast. Ref: 02 5.2, 7.7.
- [ ] F1.16 Carteira 2.0: colunas configuráveis (conjunto da planilha + vigentes), agrupamentos com subtotais, célula pagamento, dedupe no Client ao cadastrar, ações churn/pausar/retomar/reativar; área do cliente com as abas de 02 4.1 incluindo Histórico de preço/termos e linha do tempo das 3 trilhas. Ref: 02 4.1; 01 3.9.
- [ ] F1.17 Avaliação mensal em grade: pré-preenchida do mês anterior, confirmação em lote, teclado célula a célula, risco sugerido por 2+ vencidas. Ref: 02 4.1; 01 4.13.
- [ ] F1.18 Onboarding básico: OnboardingTask + template padrão + board por cliente + prazos D+7/30/90; cliente manual também inicia. Ref: 01 4.11; 02 4.2.
- [ ] F1.19 Homes por papel: executiva (painel auditado de 02 5.1 com sparklines e card Liquidez disponível) e do gestor (02 5.4); central de notificações in-app com catálogo, agrupamento e teto diário. Ref: 02 2, 4.7, 5.1, 5.4.
- [ ] F1.20 Setup guiado de primeiro uso (6 passos, nada bloqueia; EmptyStates apontando para o passo). Ref: 02 3.
- [ ] F1.21 Migração v1 completa + planilhas (CONCILIADA, AJUSTES, COMERCIAL) com proveniência (sourceSystem, sourceRow, importBatchId, migrationConfidence), fila de revisão para ambíguos, lançamento de abertura dos saldos; validação da lista de 03 3.3 gerando MigrationReconciliationIssue. DECISÕES 19.13 e 19.15 afetam esta tarefa. Ref: 03 3.2-3.3.

GATE F1: cenários S1, S8, S11, S12, S13, S23 passam em staging; paridade reconciliada dos números do Dashboard com o v1 no mesmo mês.

-

## FASE 2 - FECHAMENTO E MÁQUINA DO TEMPO

- [ ] F2.1 [SCHEMA] ClosingPeriod (escopo, competence, OPEN|SOFT_CLOSED|CLOSED|REOPENED, version) + guard assertPeriodAllows(eventType, competence) em todos os engines. Ref: 01 5.2; 03 4.4.
- [ ] F2.2 Checklist de fechamento com os 16 itens de 01 5.3, cada pendência com dono e link; assistente de rotina mensal (abrir dia 1, fechar dias 1-5, SOFT_CLOSED intermediário). Ref: 01 5.3; 02 4.6.
- [ ] F2.3 Snapshot: serialização determinística por área com schemaVersion, metricRegistryVersion, sourceCutoffAt, layoutDefinition, checksum e checksumByArea; ClosingEngine gera no CLOSED. Ref: 01 5.4.
- [ ] F2.4 Navegação em fotografia: competência CLOSED lê snapshot, faixa âmbar com selo/versão/autor, controles ausentes, badge temporal travado; colunas posteriores marcadas "não existia neste período". Ref: 02 7.8.
- [ ] F2.5 Comparativo de períodos lado a lado com deltas (entradas, saídas, valores, estabilidade). Ref: 02 5.3, 7.8.
- [ ] F2.6 Reabertura: Approval + justificativa, versão N+1, SnapshotDependency marcando posteriores NEEDS_REVALIDATION; pagamento posterior a período fechado seguindo 01 5.6. Ref: 01 5.5-5.6.
- [ ] F2.7 Snapshots retroativos da migração (REBUILT_FROM_MIGRATION) desde jan/2026. Ref: 03 3.3.
- [ ] F2.8 Job de integridade: balanço do ledger + recálculo até sourceCutoffAt + comparação de checksums + alerta. Ref: 01 5.4.
- [ ] F2.9 Fotografias avulsas nomeadas por permissão. Ref: 01 5.7.
- [ ] F2.10 Tema documento: exportação PDF de fotografia e DRE com capa navy/grão/quadrados/dourado e miolo no gabarito Documento, rodapé com versão e checksum. Ref: 02 7.8.

GATE F2: S4, S6, S10, S17, S22, S27.

-

## FASE 3 - CONTÁBIL, CONCILIAÇÃO E COBRANÇA AVANÇADA

- [ ] F3.1 Ledger completo: todos os eventos da matriz (empréstimos com principal x juros, cartão compra/fatura, transferências, provisão x pagamento de imposto, write-off, reembolso, chargeback, reversal). Ref: 01 3.10-3.12.
- [ ] F3.2 DRE por competência/agência/entidade (só PNL) + razão + filtros (competência, caixa, gerencial, normalizada informativa, consolidado); exportação do contador por CNPJ com NF. DECISÃO 19.12 (pró-labore) define flag padrão. Ref: 02 4.5.
- [ ] F3.3 Provisão tributária automática por EntidadeLegal + sugestão de reserva (nunca executa transferência). Ref: 01 3.8.
- [ ] F3.4 Allocation Engine genérico + regras + tela de rateio da fatura de ads + "não alocado" visível + margem de contribuição por cliente. Ref: 01 4.7; 02 4.4.
- [ ] F3.5 Conciliação: import OFX/CSV, BankStatementEntry, matches sugeridos (1:N, N:1, parcial), estados, proposta de ajuste; % conciliado no checklist. Ref: 01 4.7; 02 4.4.
- [ ] F3.6 FiscalDocument completo + pendências por regra. DECISÃO 19.38 (quais serviços exigem NF). Ref: 01 4.7.
- [ ] F3.7 Renegociação/reparcelamento: wizard, RenegotiationAgreement, SETTLEMENT_ONLY, aging pelo saldo renegociado. Ref: 01 3.13.
- [ ] F3.8 BillingAdjustment (desconto, juros, write-off) com thresholds e Approval automático; fila de aprovações completa com segregação. DECISÕES 19.35/19.36 (thresholds). Ref: 01 4.7, 4.10; 02 4.7.
- [ ] F3.9 Régua de cobrança em modo tarefa (D-3 a D+15, tons, promessa/opt-out/silêncio) + Modo Fila operável por teclado para cobrança, aprovações, conciliação e revisão de import. Ref: 02 4.3, 7.5, 7.7.
- [ ] F3.10 Rotina semanal. Ref: 02 4.6.
- [ ] F3.11 Fluxo de caixa por conta com projeções 30/60/90 e Liquidez disponível (reservas restritas configuráveis; DECISÃO 19.34). Ref: 01 7.2; 02 4.4.
- [ ] F3.12 Atalhos completos + e-mails transacionais no tema. Ref: 02 3, 7.8.

GATE F3: S7, S9, S14, S15, S16, S18, S19, S21, S25.

-

## FASE 4 - COMERCIAL COMPLETO

- [ ] F4.1 [SCHEMA] Lead, Interaction, Opportunity, PipelineEvent/StageHistory, AtividadeDiaria, GastoAdsDiario; dedupe lead x cliente por documento na conversão. Ref: 01 4.6.
- [ ] F4.2 Funil kanban + tempo por etapa + indicações (indicado_por/solicitado_por). Ref: 02 4; 01 4.6.
- [ ] F4.3 Atividade diária SDR mobile (30 segundos, 1 toque por campo, meta visível). Ref: 02 5.4; cenário S2.
- [ ] F4.4 Handoff de venda: WON cria/vincula Client + Relationship + Contract rascunho + CommercialTerm + Onboarding + Billings; nada trava sem contrato. Ref: 01 6.1.
- [ ] F4.5 Metas por agência/SDR/closer/gestor + homes de closer e SDR. Ref: 02 5.4.
- [ ] F4.6 Métricas comerciais no registry (CPL, CPMQL, custo por agendamento/reunião, comparecimento, conversão, CAC, ROAS com base de valoração explícita, pipeline coverage). Ref: 01 7.5.
- [ ] F4.7 Comissão por regra versionada com gatilho configurável alimentando folha. DECISÃO 19.14 (regras da Bianca e Raiane por escrito). Ref: 01 4.8.
- [ ] F4.8 Integração AvanceCRM por webhook (Outbox na saída; idempotência na entrada). Ref: 03 4.2; cenário S20.

GATE F4: S2, S3, S5, S24 e reconstrução de pipeline histórico.

-

## FASE 5 - AUTOMAÇÃO E INTELIGÊNCIA (contínua)

- [ ] F5.1 Régua automática via WhatsApp/AvanceCRM com janelas, frequência máxima e opt-out. DECISÃO 19.17.
- [ ] F5.2 Gateway Pix/boleto com link na cobrança e baixa automática idempotente. DECISÃO 19.10 (pode antecipar).
- [ ] F5.3 Open Finance / conciliação automática avançada.
- [ ] F5.4 NRR, coortes e previsão de churn por sinais (estabilidade, atraso, ads pausado, tenure).
- [ ] F5.5 Margem totalmente alocada (overhead via Allocation).
- [ ] F5.6 Assistente IA com retrato ampliado (agências, fechamento, avaliação) e guardrails do v1.
- [ ] F5.7 Relatórios agendados; PWA instalável para SDR/cobrança. DECISÃO 19.38 do arquivo 03 (19.38 operacional).

-

## TRANSVERSAL (executar dentro das fases, nunca depois)

- [ ] T1 Consolidar os 4 componentes de KPI em um (na F1.13).
- [ ] T2 MobileCards nas tabelas faltantes (até o fim da F3).
- [ ] T3 AlertDialog no lugar de todo alert/confirm nativo (até o fim da F1).
- [ ] T4 EmptyState universal (na F1.20).
- [ ] T5 Acessibilidade AA como critério de pronto de toda tela nova desde a F1; auditoria das herdadas até o fim da F3 (cenário S26).
- [ ] T6 Storybook/catálogo no CI com os 5 estados por componente (a partir da F1.13).
- [ ] T7 Observabilidade: correlationId, duração de actions, p95 por página com alerta nos orçamentos de 03 4.7 (a partir da F1).

-

## DECISÕES QUE BLOQUEIAM TAREFAS (perguntar quando alcançar)

19.9 assinatura certificada ou aceite; 19.10 gateway antecipado; 19.11 escopo de leitura do gestor; 19.12 pró-labore; 19.13 contas pessoais históricas; 19.14 regras de comissão; 19.15 CNPJs por entidade; 19.16 quem fecha/reabre; 19.17 régua automática; 19.32 data de cutover; 19.33 calendário de vencimento; 19.34 reservas na liquidez; 19.35/19.36 thresholds; 19.37 mínimos de conciliação; 19.38 NF; 19.39 arredondamento (default half-up aprovado salvo exceção).

## DIÁRIO DE EXECUÇÃO

(adicionar uma linha por tarefa concluída: data . tarefa . arquivos . observações)

- 2026-08-31 . F0.1 Ambientes . scripts/guard.ts (novo), scripts/{wipe-data,import-reestruturacao,backfill-sales-owner,mint-token}.ts, scripts/archive/test-*.ts (14), .env.example, .env.staging.example (novo), .gitignore, docs/AMBIENTES.md (novo) . Guarda única com 3 travas (APP_ENV explícito + ALLOW_DESTRUCTIVE=true + APP_ENV conferido contra a URL do banco); produção só com allowProduction no código (nenhum script passa). Banco b2c_finance_staging criado e migrado na instância local. .env.example agora aponta local por padrão. Testado negativo: bloqueia sem APP_ENV e bloqueia APP_ENV mentindo.
- 2026-08-31 . F0.2 Suíte de proteção do v1 . vitest.config.ts, tests/support/db.ts, tests/{due-date,payment-settle,payment-revert,billing-generation,renewal-flow}.test.ts, scripts/setup-test-db.mjs, package.json, src/lib/financial/due-date.ts, src/lib/actions/renewals.ts . 37 testes verdes em banco dedicado (b2c_finance_test), isolados por dono. Cobre: settle nas 3 situações (prazo/atraso no mês/mês posterior=RECOVERY) + parcial + excedente recusado + cancelada; revert (saldo, status, caixa por paymentId, dois parciais iguais no mesmo dia); dedupe de ensureMonthlyBillings (idempotente, não recria cancelada, respeita entrada na carteira, ignora churned/sem valor) e ensureClientBillingForMonth (reusa/restaura); clamp de datas; renovação MRR/TCV com guarda anti-duplo-envio. addMonthsClamped movido para ponto único em financial/due-date.ts (01 §3.4).
- 2026-08-31 . F0.3 Float→Decimal(14,2) . prisma/schema.prisma, prisma/migrations/20260831093654_money_float_to_decimal, scripts/verify-decimal-backfill.mjs, src/lib/format.ts, src/lib/services/{calculations,invoices,rules,import-engine}.ts, src/lib/actions/{cashboxes,import}.ts, src/lib/ai/context.ts, src/app/{caixa,despesas,receitas,cartoes/[id]}/page.tsx . 16 campos monetários convertidos (AISetting.temperature segue Float: não é dinheiro). Backfill conferido soma-antes/depois: Transaction 418386.42999999993→418386.43 e Income 355429.87000000017→355429.87, 0 divergências em dev e test. DROP INDEX de drift (User_workspaceOwnerId_idx) removido da migration, com aviso no cabeçalho. Helpers de formato passam a aceitar Decimal (tipo Money) — resolveu 58 dos 99 erros de tipo; os 41 restantes eram aritmética real, corrigidos com toNumber. 37 testes verdes, build:ci verde, 12 telas renderizando valores reais sem NaN.
- 2026-08-31 . F0.4 Temporalidade (competência YYYY-MM, UTC, Workspace) . src/lib/competence.ts (novo), prisma/schema.prisma, prisma/migrations/20260831094814_competence_and_utc, scripts/verify-timestamps.mjs (novo), tests/competence.test.ts (novo) . 139 colunas DateTime viraram timestamptz(3) — a migration abre com SET LOCAL TIME ZONE 'UTC' porque o cast implícito interpretaria os valores no fuso da SESSÃO (America/Bahia) e deslocaria tudo 3h. Coluna competence YYYY-MM indexada em Billing/Income/Payroll/Commission/ClientMonthDelinquency, preenchida por GATILHO no banco (b2c_set_competence) — escrita direta na coluna é desfeita, a fonte é o par mês/ano. Backfill: 489/489 cobranças, 0 divergências. Model Workspace (timezone America/Bahia, pt-BR, BRL) semeado para o dono atual. O verificador de instantes precisou ser corrigido: AT TIME ZONE inverte de sentido conforme o tipo da coluna e acusava falso positivo; com sessão em UTC + cast a comparação ficou independente de tipo. 50 testes verdes, build:ci verde, 16 telas com vencimentos corretos.
- 2026-08-31 . F0.5 LegalEntity + Agencia . prisma/schema.prisma, prisma/migrations/20260831100043_legal_entity_and_agency, tests/organization.test.ts (novo) . Models LegalEntity (razão social, fantasia, CNPJ, regime, inscrições, timezone, currency, taxSettings), Agency (nome, slug único por workspace, cor, legalEntityId) e EconomicGroup (agregador analítico). Seed 1:1 espelhado B2C Gestão aplicado em dev e test. CNPJ segue NULO: depende da DECISÃO 19.15, em aberto. DROP INDEX de drift removido da migration outra vez.
- 2026-08-31 . F0.6 Plano de contas . prisma/chart-of-accounts.ts (novo), prisma/seed-chart-of-accounts.ts (novo), prisma/schema.prisma, prisma/migrations/20260831100516_chart_of_accounts, scripts/setup-test-db.mjs, tests/chart-of-accounts.test.ts (novo) . Model AccountingAccount com natureza (accountType, normalBalance, statementType, isPostingAccount, isUnclassified) + enums; Category ganhou accountId (a interface segue usando categoria, o motor usa a conta — sem renomear nada do v1). Seed idempotente: 62 contas nas 15 raízes + conta 99 "Não classificado"; hierarquia montada pelo código; 19/19 categorias do v1 ligadas por de-para explícito (Pessoal/Família/Lazer/Carro/Estética vão para 3.2 Distribuições, fora do resultado). Conferência: 42 contas de DRE, 20 patrimoniais, 0 com saldo normal incoerente. Testes travam que caixa/reservas/cartões/impostos/empréstimos/transferências ficam fora da DRE e que juros são despesa com o principal fora dela.
- 2026-08-31 . F0.7 MetricRegistry v1 + metric-engine . src/lib/metrics/{registry,engine}.ts (novos), prisma/schema.prisma, prisma/migrations/20260831101*_metric_registry, prisma/seed-metric-registry.ts (novo), scripts/verify-metric-parity.ts (novo), src/app/dashboard/page.tsx, src/lib/owner-cache.ts, src/lib/services/{revenue-metrics,dashboard-main}.ts, tests/metric-engine.test.ts (novo) . 37 métricas do §7 registradas com contrato completo (fórmula, grão, base temporal, arredondamento, política de nulo, seção de origem) e versão 1. Motor serve por chave e NÃO reimplementa fórmula — orquestra as funções provadas do v1, que é o que garante a paridade exigida. PARIDADE: 216 comparações em 12 meses de dados reais, 0 divergências. Dashboard passou a consumir por chave (% Realização, Ticket médio, Custo por cliente, % Folha, % Recorrência) com o tooltip vindo do contrato; divisão por zero agora é política do contrato (null → "—"), não guarda inline. De quebra: os 2 usos diretos de unstable_cache viraram ownerCached (03 §4 proíbe duplicar helper) e ownerCached ganhou B2C_DISABLE_CACHE=1, que é como scripts e testes conseguem exercitar os mesmos serviços da tela.
- 2026-08-31 . F0.8 AccountingEngine + matriz canônica . src/lib/accounting/{posting-rules,engine}.ts (novos), prisma/schema.prisma, prisma/migrations/*_ledger_and_posting_rules, prisma/seed-posting-rules.ts (novo), scripts/setup-test-db.mjs, tests/accounting-engine.test.ts (novo) . Models PostingRule (versionada), LedgerTransaction (idempotencyKey única, postingRuleVersion, reversalOfId), LedgerEntry (dimensões agência/cliente/serviço) e FeatureFlag. Matriz de 01 §3.10 com os 17 eventos semeada em v1; motor implementa 5 (receita reconhecida, recebimento, receita extra, despesa a prazo, despesa à vista) e RECUSA explicitamente os demais em vez de improvisar. Postagem atrás da bandeira ledger_enabled, DESLIGADA. Travas no banco por CHECK constraint (valores não negativos; um lado por lançamento) — o teste negativo confirma que o Postgres recusa. Reversão inverte as contas e preserva a original; conferência débito=crédito por transação. 18 testes novos, 92 no total.
- 2026-08-31 . F0.9 Constraints de idempotência . prisma/schema.prisma, prisma/migrations/20260831072734_payment_idempotency (escrita à mão: o migrate dev exige confirmação interativa para uniques), tests/idempotency.test.ts (novo) . Payment ganhou externalId/externalSource/idempotencyKey com uniques — a trava do webhook duplicado (S20) fica no BANCO; NULL não colide no Postgres, então pagamento manual segue livre. Inventário completo de 03 §4.3 no cabeçalho da migration, dizendo o que já existe, o que nasce em F1.1/F1.2/F1.4 e o que NÃO foi criado de propósito: a unique grosseira (source+eventType) em LedgerTransaction bloquearia o caso legítimo de um Payment que liquida N cobranças via PaymentApplication — a idempotencyKey já é mais precisa. 7 testes novos, 99 no total.
- 2026-08-31 . F0.10 Transactional Outbox . src/lib/outbox/index.ts (novo), prisma/schema.prisma, prisma/migrations/*_transactional_outbox, tests/outbox.test.ts (novo) . Model OutboxEvent (status, attempts, nextAttemptAt, lastError, dedupeKey único por workspace, payload mínimo). publish(tx, ...) exige o cliente de TRANSAÇÃO de propósito: publicar fora dela quebraria a garantia. Worker com recuo exponencial (1min dobrando até o teto de 6h), MAX_ATTEMPTS=8 e dead-letter; requeue é ação humana explícita. Testes provam as duas pontas da regra: transação desfeita leva o evento junto (não se notifica fato inexistente) e um evento que falha não impede a entrega dos outros. Sem consumidores, como a tarefa pede. 13 testes novos, 112 no total.
- 2026-08-31 . F0.10 (correção) worker do Outbox: corrida de relógio . src/lib/outbox/index.ts . A suíte flakeou 1 em ~3 execuções. Diagnóstico com precisão de microssegundo: o Prisma carimba nextAttemptAt com o relógio da APLICAÇÃO (precisão de ms) e a seleção comparava com o relógio do BANCO — linha gravada em .148000 contra NOW() de .147966, ou seja, carimbo 34µs NO FUTURO; o evento ficava invisível até a rodada seguinte (4 de 30 ciclos). Corrigido avaliando a elegibilidade no banco, na mesma consulta, com tolerância de 1 segundo — inofensiva (o menor recuo é 1 minuto) e que também cobre a defasagem real entre servidores em produção. Verificado: 80 ciclos sem perda e 5 execuções seguidas da suíte com 112/112.
