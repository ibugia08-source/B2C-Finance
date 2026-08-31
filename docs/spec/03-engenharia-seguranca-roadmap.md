# B2C FINANCE 2.2 - ARQUIVO 3/3: ENGENHARIA, SEGURANÇA E ROADMAP

Especificação de produção. Conjunto: 01 domínio e regras, 02 produto/UX/design, 03 engenharia/segurança/roadmap (este).

## 1. USUÁRIOS, PAPÉIS, HIERARQUIA E CONTROLES

### 1.1 Hierarquia e escopos

```
Workspace -> LegalEntity -> Agency -> data scopes
User -> Role -> Permission -> Scope
Escopos: workspace inteiro | EntidadeLegal | Agência | meus clientes | compartilhados explícitos
Permissão = módulo.ação; campos sensíveis têm permissão de campo além da de tela
```

Papéis: Administrador, Financeiro, Gestor de contas, Closer, SDR, Cobrança, Suporte/Automação, Contador (read-only de fechados), Leitura. RBAC do v1 mantido (resolução: sem usuário nega; ADMIN permite; ajuste fino do usuário vence o papel; só diferenças gravadas; gates evitam render e query; requirePagePermission para páginas; tryPermission para gestos, devolvendo erro amigável sem perder estado).

### 1.2 Permissões novas (além do catálogo do v1)

| Módulo | Permissões |
| --- | --- |
| Entidades Legais / Agências | visualizar . gerenciar |
| Termos Comerciais | visualizar . editar |
| Avaliação | visualizar . editar (escopo meus clientes) |
| Onboarding | visualizar . operar |
| Recebíveis/Créditos | visualizar . operar . ajustar |
| Contábil | visualizar . lançar . exportar |
| Fechamento | fechar . reabrir . fotografar |
| Conciliação | visualizar . conciliar . ajustar |
| Fiscal | visualizar . emitir/registrar . cancelar |
| Rateios | visualizar . editar . aprovar |
| Comercial | visualizar . operar . registrar venda . metas |
| Aprovações | solicitar . decidir por tipo |
| Auditoria | visualizar |
| PostingRule/Métrica | sensível, Admin |

### 1.3 Segregação e thresholds

requestedBy != decidedBy para write-off, reabertura, lançamento manual e operações configuradas; thresholds por tipo/valor configuráveis; aprovação dupla opcional para valores críticos; decisão registra contexto, motivo, usuário, timestamp; ações de Admin continuam auditadas (sem bypass invisível).

### 1.4 Sessão, banco e cache

MFA obrigatório para Admin/Financeiro quando suportado; cookie httpOnly Secure SameSite; rotação/expiração; fail-closed sem secrets; rate limit + lockout; downloads autenticados; log de acesso a dados sensíveis; upload com validação de MIME/tamanho.

RLS em toda tabela privada; nenhuma role de aplicação com BYPASSRLS; FORCE RLS quando apropriado; testes automatizados provam que escopo inferior não lê escopo superior.

Chave de cache de leitura sensível inclui: workspaceId, legalEntityId/agencyId, userScope, permissionFingerprint, competence, filters, metricVersion. Cache de Admin nunca serve Gestor por compartilharem ownerId. Invalidação por helpers de domínio e escopo.

### 1.5 Continuidade

Backups automáticos; PITR quando disponível; teste periódico de restauração (backup sem teste não é válido); RPO/RTO documentados; runbook de incidente; trilha append-only; secrets fora do repositório.

## 2. CONFIGURAÇÕES E PLANO DE CONTAS

### 2.1 Configurável sem deploy

Workspace (timezone, locale, moeda, calendário); Entidades Legais (CNPJ, regime, fiscal, alíquotas, contas bancárias); Agências; Serviços e Ofertas (preço vive na oferta; legados PRO AV, PRO AV 2X, PRO 3X, PRO MENSAL, PRO PARCELADO inativos); motivos (churn, pausa, ajuste); regras de comissão versionadas; metas; parâmetros de fechamento (conciliação mínima, classificação mínima, thresholds); régua de cobrança (etapas, tons, canal, janela); aprovações por tipo/valor; notificações (catálogo, teto diário, silêncio, digest); templates de onboarding; CategorizationRule; AllocationRule; PostingRule; MetricDefinition/versões; layout padrão (vai ao snapshot); integrações; Assistente IA; aparência (tema, densidade, home inicial por usuário); atalhos; dados da capa de exportação.

### 2.2 Plano de contas gerencial-contábil

UI usa grupos amigáveis; toda conta carrega natureza (accountType, normalBalance, statementType, isPostingAccount, code, parentId, group, active, escopo). DRE usa só statementType=PNL. Caixa/reserva fora da DRE; principal de empréstimo não é despesa.

```
1 ATIVOS: 1.1 Caixa e bancos . 1.2 Reservas . 1.3 Contas a receber . 1.4 Adiantamentos/Créditos . 1.5 Outros
2 PASSIVOS: 2.1 Contas a pagar . 2.2 Cartões . 2.3 Impostos . 2.4 Folha/Comissões . 2.5 Empréstimos/parcelamentos . 2.6 Outros
3 PATRIMÔNIO/SÓCIOS: 3.1 Capital/ajustes . 3.2 Distribuições/retiradas conforme política
4 RECEITAS OPERACIONAIS: 4.1 MRR . 4.2 TCV . 4.3 Setup . 4.4 One-time/Avulso . 4.5 Upsell . 4.6 Recuperação (classificação analítica, sem duplicar reconhecimento)
5 RECEITAS EXTRAS: 5.1 Reembolso recebido . 5.2 Ajuste positivo . 5.3 Outras
6 CUSTOS DIRETOS: 6.1 Tráfego repassado . 6.2 Criativos/freelancers . 6.3 Comissão comercial . 6.4 Comissão renovação/upsell
7 FOLHA E PESSOAS: salários, benefícios, encargos, bonificações, pró-labore conforme flag
8 FERRAMENTAS E SOFTWARES
9 MARKETING E VENDAS DA AGÊNCIA
10 ADMINISTRATIVAS
11 IMPOSTOS E CONTABILIDADE
12 FINANCEIRAS: juros, tarifas, antecipações, multas
13 INVESTIMENTOS/CAPEX GERENCIAL
14 AJUSTES/CONTRA-RECEITA/PERDAS
15 TRANSFERÊNCIA E CONTROLE
```

Contas "Não classificado": temporárias (migração/import), com alerta, limite máximo no fechamento, proibidas como destino permanente de regra, job sugere reclassificação.

PostingRules: cada evento tem versão ativa; mudança não altera lançamentos passados; configuração sensível com testes e aprovação de release.

## 3. ENTRADAS, MIGRAÇÃO E CONFORMIDADE

### 3.1 Caminhos de entrada

1 formulários internos; 2 gestos inline; 3 importação em massa com prévia (500 linhas, dedupe na planilha e contra o banco, lote reversível); 4 import de fatura (PDF 17 emissores, hash único, parcelamento, herança, regras); 5 formulário público de contrato com aceite; 6 upload privado (download autenticado); 7 webhooks; 8 extrato OFX/CSV; 9 futuro Open Finance/gateway. Todos passam por serviços de domínio; importador não grava ledger por SQL direto.

### 3.2 Cutover e saldo inicial

Data oficial de cutover financeiro (recomendação: início de competência fechada e conciliável). Na abertura devem existir saldos reconciliados de: contas bancárias, reservas, contas a receber abertas, créditos de clientes, contas a pagar, cartões, impostos/passivos, folha/comissões a pagar, empréstimos/parcelamentos. Saldo inicial postado por lançamento de abertura auditado.

### 3.3 Migração e proveniência

Fonte A: banco do B2C Finance v1 (tudo). Fonte B: planilhas históricas (CONCILIADA, AJUSTES, RENOVACOES, ACOMPANHAMENTO COMERCIAL). Todo registro migrado recebe: sourceSystem, sourceFile, sourceSheet, sourceRow, importBatchId, legacyId, migrationConfidence, migrationNote. Correspondências ambíguas vão para fila de revisão humana. Client.monthlyValue histórico vira CommercialTerm por vigência inferida só quando a fonte sustentar; caso contrário registra confiança e decisão auditável.

Validação (diferenças viram MigrationReconciliationIssue com decisão e responsável): contagem de entidades; saldos por conta; recebíveis; pagar; faturamento por competência; recebido por caixa; DRE; MRR por competência; churn/renovação; hashes de lote. Depois: snapshots retroativos desde jan/2026 marcados REBUILT_FROM_MIGRATION (lote, fonte, versão de métricas).

### 3.4 LGPD e retenção

Base legal e finalidade registradas (execução de contrato para clientes; legítimo interesse com opt-out para prospecção/cobrança); anonimização de leads antigos por política; preservação fiscal/financeira pelo prazo legal sem dados pessoais desnecessários; exportação completa do workspace; logs de acesso; storage privado. Anonimização que afeta snapshot é reprocessamento excepcional, auditado e marcado (única exceção à imutabilidade).

## 4. DIRETRIZES TÉCNICAS

Stack: Next.js App Router (Server Components leitura, Server Actions mutação; sem API routes de dados além de download/export/webhooks), TypeScript, Prisma/PostgreSQL, Tailwind/Radix, Zod safeParse em toda action, Supabase Storage, Vercel gru1. Evoluir o repositório do Finance v1 (núcleo comprovado), envolvido por testes e serviços de domínio. Helpers únicos (format, billing-status, status-meta); nunca duplicar.

### 4.1 Serviços de domínio

Nenhuma page/action manipula fatos contábeis diretamente:

```
BillingEngine . PaymentEngine . AccountingEngine . ExpenseEngine . AllocationEngine
CollectionEngine . ReconciliationEngine . ClosingEngine . MetricEngine . CommercialEngine

settleBilling(): permission -> period guard -> idempotency guard -> Payment
 -> PaymentApplication -> AccountingEngine -> AuditLog -> OutboxEvent -> commit
```

### 4.2 Transactional Outbox

Integração externa fora da transação financeira:

```
DB tx: fato + ledger + audit + OutboxEvent -> COMMIT
worker: entrega WhatsApp/CRM/e-mail/webhook; retry exponencial; dedupeKey; dead-letter
```

### 4.3 Constraints no banco (além da aplicação)

Unique: geração MRR (relationship+competence+kind+generationKey); parcela TCV (groupId+number); Payment externalId/idempotencyKey; LedgerTransaction source+postingType; avaliação por relação+competência; CommercialTerm sem sobreposição lógica validada. Check: debit/credit não negativos, um lado por Entry. Validado em serviço/teste: LedgerTransaction balanceada; rateios totalizam a origem. Decimal em toda moeda.

### 4.4 Períodos, cache, performance

Toda mutação financeira chama assertPeriodAllows(eventType, competence); CLOSED bloqueia postagem econômica retroativa; caixa posterior posta na competência do caixa sem reabrir.

ownerCached evolui para chaves com fingerprint (1.4); invalidação por domínio e escopo; RLS fail-closed.

Performance (lições do v1 viram lei): sem N+1 (createMany/updateMany/bucketize); take/paginação em toda lista; libs pesadas server-only; queries em fases sequenciais (pool ~5 conexões); índices por workspace/competência/agência/estado; materialização só onde medido; nenhuma escrita escondida em caminho de leitura (manutenções com throttle); referência: dashboard do v1 caiu de 4,4s/405 queries para 0,9s/12.

### 4.5 Testes obrigatórios (pré-merge)

Pagamento normal/atrasado/recuperação; parcial; excesso/crédito; refund/chargeback/reversal; TCV parcelado + rounding; MRR por vigência; renovação; reparcelamento sem duplicar receita; empréstimo principal/juros; cartão sem dupla despesa; reserva x provisão; unique/dedupe concorrente; período fechado; reabertura + revalidação; permission fail-closed; cache scope; ledger balance; métricas oficiais com fixtures; snapshot determinístico.

### 4.6 Ambientes, deploy, observabilidade

Produção e staging com bancos separados; .env local nunca aponta para produção por padrão; script destrutivo exige ALLOW_DESTRUCTIVE=true + ambiente explícito; migrations revisadas; build:ci e testes verdes; feature flags para módulos sensíveis; deploy com rollback; nunca commitar na main.

Observabilidade: logs estruturados com correlationId; duração de actions; métricas de erro; p95 de páginas; falha de Outbox; divergência de snapshot; job de integridade; acessos negados relevantes. PII/dados bancários fora de log desnecessário.

### 4.7 Orçamentos de experiência (p75 em produção; regressão bloqueia release)

| Medida | Orçamento |
| --- | --- |
| Esqueleto visível | <= 200 ms |
| LCP das telas de trabalho | <= 1,5 s |
| Resposta visual a gesto | <= 100 ms |
| Troca de mês (com prefetch) | <= 300 ms percebidos |
| Busca na carteira (índice local) | <= 50 ms |
| Abertura da paleta | <= 100 ms |
| Item do Modo Fila (lado sistema) | <= 400 ms |
| Gestão do Mês interativa | <= 2,5 s |

## 5. ROADMAP COM DEFINIÇÃO DE PRONTO

Ordenado por dependência: ledger mínimo, Decimal e temporalidade antes de snapshot. Cenários S1-S27 no arquivo 02.

Fase 0 (fundação e decisões): decisões críticas da seção 6; LegalEntity x Agency; Decimal concluído; timezone/calendário; MetricRegistry v1 congelado; matriz canônica; plano de contas com natureza; staging; testes do núcleo v1 (rede de proteção); desenho de cutover/saldos; unique/idempotency; Domain Services + Outbox. Pronto: testes base verdes, dry-run de migração possível, nenhum P0 aberto.

Fase 1 (fundação financeira e multiagência): Workspace -> LegalEntity -> Agency; Client mestre + Relationship; ClientManagerAssignment; CommercialTerm; Billing/PaymentApplication/CustomerCredit; ledger mínimo + PostingRules de receitas/despesas principais; plano de contas; migração v1 + saldos iniciais; Gestão do Mês; Carteira; avaliação em grade; onboarding básico; homes executiva/gestor; busca global + paleta; RBAC/RLS/cache seguro; AuditLog; notificações básicas; setup guiado. Pronto: S1, S8, S11, S12, S13, S23 e paridade reconciliada com o v1.

Fase 2 (fechamento e máquina do tempo): estados do período; checklist; snapshot versionado/checksum; fotografia; comparativo; reabertura; SnapshotDependency; snapshots migrados; verificação de integridade; rotina mensal; tema documento (PDF com identidade). Pronto: S4, S6, S10, S17, S22, S27.

Fase 3 (contábil, conciliação, cobrança avançada): ledger completo; DRE/razão; empréstimos/passivos; cartão sem dupla contabilização; Allocation Engine; OFX/CSV + ReconciliationMatch; FiscalDocument; provisão x reserva; renegociação; BillingAdjustment; write-off/aprovações; régua modo tarefa + Modo Fila; rotina semanal; atalhos completos; e-mails no tema. Pronto: S7, S9, S14, S15, S16, S18, S19, S21, S25.

Fase 4 (comercial completo): funil; PipelineEvent; atividade diária; indicações; vendas; metas; CAC/ROAS; homes closer/SDR; integração AvanceCRM; onboarding no handoff; comissão versionada. Pronto: S2, S3, S5, S24 e cenários de pipeline histórico.

Fase 5 (automação e inteligência): cobrança automática WhatsApp; gateway Pix/boleto; Open Finance; conciliação automática avançada; NRR/coortes avançados; margem totalmente alocada; previsão de caixa/churn; IA ampliada; relatórios agendados. Todo webhook/gateway passa S20 antes de produção.

Transversal (com o design system como critério de pronto): KPI único; tokens no lugar de cor crua; MobileCards; AlertDialog no lugar de alert/confirm; EmptyState universal; acessibilidade AA (S26); documentação; testes; observabilidade. Float -> Decimal não é paralelo: é pré-requisito da Fase 1.

## 6. DECISÕES

### 6.1 Resolvidas (vigentes)

TCV vendido e faturado são métricas distintas; normalização só analítica. Competência aberta corrige por eventos auditados; lançamento postado nunca some. Contrato formaliza, não bloqueia. Centro de custo não volta (Agência + Conta + Allocation + Cliente/Serviço cobrem). Design: base do v1 + direção Precisão Editorial + territórios marca x produto; dourado proibido nas telas de trabalho; tokens de azul unificados. Folha DRAFT fora do realizado. Evoluir o repositório do Finance; monorepo com COP só se autenticação/infra justificar. Rotas pessoais do v1: isolar ou desativar. EntidadeLegal separada de Agência. DRE gerencial por dupla entrada e matriz canônica. PostingRule por evento (tabela 3.10 do arquivo 01 é a base). Reabertura marca posteriores NEEDS_REVALIDATION. CommercialTerm é fonte do MRR histórico. Cliente multiagência via relações. CustomerCredit para adiantamentos/excessos. Reparcelamento não duplica reconhecimento. Allocation genérico. Card de caixa usa Liquidez disponível. Desfazer = reversal append-only. Self-approval proibido; thresholds configuráveis. Períodos OPEN/SOFT_CLOSED/CLOSED/REOPENED. Métricas versionadas em registry. Modo Fila obrigatório (cobrança, aprovações, conciliação, revisão de import) a partir da Fase 3. Paleta e busca na Fase 1. AA como critério de pronto desde a Fase 1. Tema documento na Fase 2.

### 6.2 Operacionais pendentes da direção

19.9 Assinatura: aceite atual basta ou integrar certificada? 19.10 Gateway: Fase 5 ou antecipar para a 3? 19.11 Gestor vê carteira inteira (leitura) ou só a sua? 19.12 Pró-labore: despesa operacional ou fora do resultado (flag)? 19.13 Contas pessoais históricas: migrar como Sócio ou deixar fora? 19.14 Regras de comissão vigentes (Bianca, Raiane) por escrito. 19.15 CNPJs reais e a que LegalEntity cada Agência pertence. 19.16 Fechamento: recomendação Financeiro fecha, Admin reabre, Contador read-only. 19.17 Régua automática: horários, frequência máxima, opt-out. 19.32 Data de cutover e saldos iniciais reais antes do primeiro dry-run. 19.38 PWA/app instalável para SDR e cobrança (candidato Fase 5).

### 6.3 Parâmetros a confirmar antes de produção

Calendário: vencimento em fim de semana/feriado (manter, antecipar, postergar). Liquidez: quais reservas reduzem o disponível (recomendação: configurável por reserva). Thresholds de write-off e de desconto por papel/agência. Conciliação: mínimo por conta e tratamento de contas não críticas. Fiscal: quais serviços/agências exigem NF e em qual evento nasce a pendência. Arredondamento: half-up com residual na última linha (confirmar exceções de contratos existentes).

### 6.4 Congelamento da arquitetura (gate da Fase 1)

Fase 1 só inicia com: 6.2 com dono e prazo; 6.3 com parâmetros iniciais ou default aprovado; matriz de eventos validada com o contador quanto à lógica gerencial; fixtures de jan-ago/2026 batendo com a realidade reconciliada; saldos iniciais documentados.
