# B2C FINANCE 2.2 - ARQUIVO 1/3: DOMÍNIO E REGRAS

Especificação de produção. Conjunto: 01 domínio e regras (este), 02 produto/UX/design, 03 engenharia/segurança/roadmap. Fonte: doc unificada 2.1 + revisão 2.2 aplicada. Regras aqui são invariantes: nenhuma tela, relatório, importação, webhook ou automação pode contrariá-las.

## 1. VISÃO

ERP financeiro, contábil, comercial e de carteira da B2C Gestão e agências irmãs (Assessoria B2C, Life Ads). Reconstrução evolui o repositório do B2C Finance v1 (Next.js 14, Prisma, PostgreSQL/Supabase), preservando seu núcleo comprovado: Gestão do Mês como tela-âncora, status derivado nunca gravado, pagamento em 1 clique com Desfazer 15 min, geração idempotente de cobranças, fluxo único de renovação, fila de cobrança com score, mensagens em 7 tons, contratos DOCX com link público, importação de fatura (17 emissores), RBAC granular, isolamento fail-closed, MonthNav único (?mes=AAAA-MM), SavedView, lições de performance (fases sequenciais, sem N+1, take em toda lista).

```
Lead -> Cliente -> Contrato -> Cobrança (competência) -> Pagamento -> Caixa -> Ledger -> DRE
Despesa . Folha . Comissão . Cartões . Caixa/Reservas -> Resultado
Tudo por Agência . Tudo por Competência . Tudo fotografável no fechamento
```

Telas-âncora: Gestão do Mês (aba do mês da planilha) e Painel Anual (indicador x JAN..DEZ + meta + simulador). Fora de escopo: operação de entrega (fica no AvanceCRM).

## 2. PRINCÍPIOS DE ARQUITETURA

1. Uma verdade por entidade; referência por ID, nunca por nome.
2. Cliente mestre no workspace; situação operacional, gestores, contratos e cobrança vivem na relação Cliente x Agência.
3. EntidadeLegal (CNPJ, regime, fiscal, contas bancárias) é diferente de Agência (unidade de negócio/dimensão gerencial).
4. Competência é dimensão, não aba; MonthNav é o único seletor temporal.
5. Competência e caixa coexistem: DRE lê competência; fluxo de caixa lê caixa.
6. Reconhecimento não é pagamento: Billing/Payable são direitos/obrigações; Payment/Income são liquidação. Pagar dívida reconhecida não cria nova despesa.
7. Ledger é consequência dos fatos: telas chamam serviços de domínio; o AccountingEngine aplica a matriz canônica. Nenhuma tela escreve ledger.
8. Correção com rastro: Desfazer 15 min na UX, mas lançamento postado é revertido por evento compensatório append-only; nada é apagado.
9. Períodos com governança: OPEN opera; SOFT_CLOSED restringe; CLOSED congela; REOPENED exige aprovação e pode invalidar posteriores.
10. Snapshot preserva a verdade do fechamento; pagamento posterior muda o estado operacional, nunca a fotografia.
11. Status derivado; dimensões do cliente ortogonais (ciclo de vida, financeiro, renovação, onboarding em enums separados).
12. Histórico econômico é temporal: MRR, modalidade, gestor e termos usam vigência validFrom/validTo.
13. Idempotência garantida no banco (unique constraints, idempotency keys); throttle é só economia de trabalho.
14. Arredondamento determinístico (política única, residual alocado).
15. Multiagência e multiempresa nativas; todo relatório informa o escopo (workspace | legalEntity | agency).
16. Tudo auditável e parametrizável sem deploy; mudança sensível deixa trilha.
17. Hierarquia de leitura: decidir (até 6 cards), entender (até 3 gráficos), agir (até 2 listas) por tela analítica.
18. Todo dado cobrado tem dono, frequência e custo alvo; campo sem dono é candidato a automação ou remoção.
19. Segregação de funções: quem solicita operação sensível não aprova a própria solicitação; thresholds configuráveis.
20. Integração externa fora da atomicidade financeira: Transactional Outbox após commit.
21. Métrica é contrato versionado (fórmula, fontes, grain, dataBasis, versão); snapshot guarda a versão usada.
22. Dado fechado não depende do código atual: consulta histórica lê snapshot versionado.
23. Nenhum termo de arquitetura aparece na interface (Camada de Simplicidade, arquivo 02): o usuário faz gestos de planilha; o domínio cria os fatos por trás.

Regra de estabilidade: nova funcionalidade financeira só entra em desenvolvimento respondendo: 1 qual o fato de domínio; 2 qual competência afeta; 3 qual data de caixa afeta; 4 reconhece resultado ou move ativo/passivo; 5 qual regra de ledger; 6 qual chave de idempotência; 7 pode ocorrer em período fechado; 8 qual trilha de auditoria; 9 qual métrica/versão impacta; 10 há efeito em snapshot/períodos posteriores; 11 qual gesto simples o usuário faz e o que ele vê.

## 3. REGRAS FINANCEIRAS CANÔNICAS

### 3.1 Fluxo canônico

```
Client -> ClientAgencyRelationship -> Contract -> CommercialTerm
 -> Billing (competência) -> PaymentApplication -> Payment/Income (caixa)
 -> AccountingEngine -> LedgerTransaction + LedgerEntry -> DRE / Recebíveis / Caixa
Expense/Payable -> Settlement -> AccountingEngine -> Ledger
CreditCardPurchase -> Card Liability -> Invoice Settlement -> Ledger
Cash Transfer / Reserve -> Ledger patrimonial (não cria despesa)
```

Não são sinônimos: Cobrança/Billing (direito de receber por competência), Payment (evento de caixa), PaymentApplication (parcela de um Payment aplicada a um Billing; N:N), Income (entrada de caixa quando aplicável), Receita Extra (fato manual sem cobrança a cliente), Ledger (dupla entrada gerada pelos fatos), Fatura de cartão (passivo agrupador), Reserva (segregação de caixa, não despesa).

### 3.2 MRR x TCV

| | MRR | TCV |
| --- | --- | --- |
| Definição | receita recorrente mensal contratada | valor total de contrato não recorrente/por ciclo |
| Fonte histórica | CommercialTerm vigente na competência | Contract + Billing TCV |
| MRR oficial | soma de monthlyValue dos termos MRR vigentes na competência de relações ativas | n/a |
| TCV vendido | n/a | valor do contrato fechado no mês comercial |
| TCV faturado | n/a | soma de Billing TCV recognitionMode=REVENUE da competência |
| Rateio operacional | mensal por natureza | nunca rateado como faturamento |
| Receita normalizada | próprio MRR | TCV/prazo apenas em análise |

Atividade no mês usa a relação Cliente x Agência e o ciclo de vida. Retornou não é estado: cria ClientReactivationEvent, encerra o churn e inicia novo vínculo/termo (ACTIVE ou ONBOARDING).

### 3.3 Pagamento, aplicação e reversão

Uma cobrança recebe N aplicações; um pagamento liquida N cobranças.

| Situação | Condição | Efeito |
| --- | --- | --- |
| Pago no prazo | liquidação até o vencimento, na competência | PAID |
| Pago com atraso | após vencimento, mesmo mês de caixa | marca isLate |
| Pago em outro mês | caixa posterior à competência | fotografia do mês original permanece vencida; caixa conta como recuperação no mês recebido |
| Parcial | aplicado < saldo | PARTIAL |
| Adiantado | caixa anterior à competência | caixa entra no período; receita fica na competência definida |
| Excedente | Payment > saldos aplicados | restante vira CustomerCredit/UnappliedReceipt |

Proteções: idempotencyKey/externalId único em Payment externo; aplicação nunca excede saldo sem criar crédito explícito; Billing cancelado não recebe aplicação; paidTotal é derivado das aplicações, nunca fonte; Desfazer cria ReversalEvent/compensação (a história não é apagada) e recalcula saldo/status.

### 3.4 Vencimentos e calendário

Dia recorrente 1-31 com clamp de fim de mês em ponto único (getValidDueDateForMonth); renovação usa addMonthsClamped (31/01 + 1 mês = 28/02); billingDay de contrato pode limitar a 1-28. Workspace: timezone America/Bahia, moeda BRL, locale pt-BR, calendário de dias úteis configurável. Vencimento em fim de semana/feriado: manter, antecipar ou postergar, configurável por EntidadeLegal. Régua de cobrança respeita dias úteis e janela de horário.

### 3.5 Geração e dedupe de cobranças (chaves no banco)

| Origem | Chave canônica |
| --- | --- |
| MRR do mês | (relationshipId, competence, billingKind, generationKey) |
| Contrato | (contractId, competence, installmentNumber) |
| TCV parcelado | (installmentGroupId, installmentNumber) |
| Upsell | upsellId único em Billing |
| Renovação | renewalId + competence |
| Importação externa | externalSource + externalId |
| Reparcelamento | renegotiationId + installmentNumber |

Throttle 1h só evita retrabalho; UNIQUE + skipDuplicates protegem corrida serverless. Cobrança cancelada na competência bloqueia recriação automática (marcador restaurável, nunca duplicado).

### 3.6 Receita Extra x Cobrança avulsa

Tem cliente e é cobrável: Billing ONE_TIME, SETUP ou UPSELL (entra no ciclo, inadimplência e faturamento). Sem cobrança a cliente: Receita Extra/Income manual classificado em conta gerencial. Reembolso recebido e ajuste positivo não viram cliente fictício. Nenhum movimento entra no resultado sem regra do AccountingEngine.

### 3.7 TCV parcelado

Venda TCV parcelada gera N Billings TCV com competências/vencimentos próprios, ligados por installmentGroupId e numerados. TCV vendido = valor integral no mês da venda; TCV faturado = soma das parcelas da competência; à vista coincidem. Arredondamento: residual na última parcela (R$ 1.000 em 3x = 333,33 + 333,33 + 333,34).

### 3.8 Impostos: provisão x reserva

Eventos independentes. A) Provisão tributária (reconhece obrigação): débito Despesa tributária, crédito Impostos a pagar; base e competência por regra da EntidadeLegal. B) Reserva de impostos (segrega caixa): débito Reserva, crédito Caixa operacional; não cria despesa. O sistema sugere a transferência; nunca executa sem autorização.

### 3.9 Ciclo do cliente (dimensões independentes)

```
lifecycleStatus:  PROSPECT | ONBOARDING | ACTIVE | PAUSED | CHURNED | INACTIVE
financialStatus:  REGULAR | DUE_SOON | OVERDUE | DELINQUENT | WRITE_OFF (derivado/cache)
renewalStatus:    NOT_APPLICABLE | UPCOMING | NEGOTIATING | RENEWED | LOST (derivado/cache)
onboardingStatus: NOT_STARTED | IN_PROGRESS | COMPLETE | EXCEPTION
```

Pausar suspende geração recorrente a partir da competência escolhida; retomar cria evento e novo termo; contrato com prazo pergunta se estende o fim pelo período pausado. Churn cria ClientLoss (snapshot de modalidade, receita perdida, responsável, motivo) e não apaga recebível: a cobrança da dívida continua.

### 3.10 Matriz canônica de eventos contábeis

Nenhuma tela cria LedgerEntry. O domínio publica evento; o AccountingEngine aplica a PostingRule ativa e versionada:

| Evento | Débito | Crédito | DRE? |
| --- | --- | --- | --- |
| Receita reconhecida (Billing elegível) | Contas a Receber | Receita operacional | Sim |
| Recebimento de cliente | Banco/Caixa | Contas a Receber | Não (se já reconhecida) |
| Receita Extra reconhecida+recebida | Banco/Caixa | Receita extra | Sim |
| Despesa reconhecida a prazo | Despesa/Custo | Contas a Pagar | Sim |
| Despesa paga à vista | Despesa/Custo | Banco/Caixa | Sim |
| Pagamento de conta reconhecida | Contas a Pagar | Banco/Caixa | Não |
| Compra no cartão | Despesa/Custo | Cartão a Pagar | Sim |
| Pagamento de fatura | Cartão a Pagar | Banco/Caixa | Não |
| Entrada de empréstimo | Banco/Caixa | Empréstimos a Pagar | Não |
| Amortização de principal | Empréstimos a Pagar | Banco/Caixa | Não |
| Juros | Despesa financeira | Banco/Contas a Pagar | Sim |
| Transferência entre contas/reservas | Conta destino | Conta origem | Não |
| Provisão de imposto | Despesa tributária | Impostos a Pagar | Sim |
| Pagamento de imposto | Impostos a Pagar | Banco/Caixa | Não |
| Reembolso ao cliente (reversão de receita) | Contra-receita/conta definida | Banco/Caixa | Sim conforme origem |
| Write-off de recebível | Perda com crédito | Contas a Receber | Sim |
| Reversal | contas inversas do original | conforme original | Neutraliza |

### 3.11 Natureza das contas

Toda conta: accountType ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE; normalBalance DEBIT|CREDIT; statementType BALANCE_SHEET|PNL; isPostingAccount. Grupos gerenciais continuam amigáveis na UI; o engine conhece a natureza (impede empréstimo/fatura/transferência virarem despesa duplicada). DRE usa apenas statementType=PNL.

### 3.12 Adiantamentos, créditos, reembolsos, chargebacks

Adiantamento: crédito/receita diferida ou aplicação futura conforme regra. Excesso: CustomerCredit. Pagamento duplicado: crédito ou devolução, nunca aplicado duas vezes. Reembolso: ligado ao Billing/Payment original, contra-receita quando aplicável. Chargeback: evento próprio referenciando o pagamento. Estorno: reversão, nunca edição destrutiva. Write-off: motivo obrigatório; acima do threshold, aprovação.

### 3.13 Reparcelamento

Não cria nova receita. Billing(s) originais -> RenegotiationAgreement -> saldo original RENEGOTIATED -> novos Billings recognitionMode=SETTLEMENT_ONLY (entram em recebíveis/cobrança; não duplicam faturamento/DRE). O acordo registra saldo original, juros/desconto, data, responsável, parcelas e vínculos.

### 3.14 Política monetária

Moeda em Decimal(14,2); taxas em Decimal(9,6); jamais Float, nem em intermediários. Half-up padrão. Rateio soma exatamente a origem; residual determinístico (última linha ou maior peso). Invariantes testadas: soma parcelas = total; soma rateios = origem; débitos = créditos.

### 3.15 Política temporal

Timestamps em UTC, exibição no timezone do workspace. competence é dimensão explícita YYYY-MM, nunca derivada de createdAt. Datas semânticas distintas: recognizedAt/competence (resultado), dueDate (vencimento), paidAt (caixa), postedAt (ledger), closedAt (fechamento), effectiveFrom/effectiveTo (vigência).

## 4. MODELO DE DOMÍNIO

Convenções: id cuid/uuid; createdAt/updatedAt; ownerId/workspaceId em todo modelo privado; Decimal; UTC; competência explícita; soft delete onde necessário; campo desnormalizado só como cache/índice, nunca fonte histórica.

### 4.1 Mapa de entidades

```
Workspace 1-* LegalEntity 1-* Agencia; Workspace 1-* Client; 1-* AccountingAccount
LegalEntity 1-* BankAccount; 1-* FiscalDocument
Client *-* Agencia via ClientAgencyRelationship
Client 1-* ClientReactivationEvent | ClientNote | ClientDocument
ClientAgencyRelationship 1-* Contract | CommercialTerm | ClientManagerAssignment
  | AvaliacaoMensal | OnboardingTask | ClientLoss | CollectionHistory
Contract 1-* Billing; Billing 1-* PaymentApplication *-1 Payment
Payment 0..1-* CustomerCreditMovement; Billing 1-* BillingAdjustment
Billing *-* RenegotiationAgreement
Expense/Payable -> Settlement; CreditCard -> CreditCardInvoice -> CardPurchase
Employee -> Payroll -> PayrollItem; Commission
FinancialFact -> AccountingEngine -> LedgerTransaction 1-* LedgerEntry
Allocation -> Agency/Client/Service
BankStatement -> BankStatementEntry -> ReconciliationMatch
Lead -> Interaction -> Opportunity -> PipelineEvent -> Contract; Upsell -> Billing
ClosingPeriod -> Snapshot; SnapshotDependency
Approval . Notification . AuditLog . OutboxEvent
SavedView . AnnualTarget . ImportBatch . CategorizationRule . GrupoEconomico
ContractTemplate 1-* GeneratedContract 0..1-1 ContractFormLink
AIConversation . AIMessage . AIMemory . AISetting
```

### 4.2 Workspace, LegalEntity, Agencia

Workspace: dono lógico e limite de isolamento. LegalEntity: nomeLegal, nomeFantasia, cnpj, regimeTributario, inscrições, timezone, currency, taxSettings, ativa; dona de emissão fiscal, contas bancárias, passivos fiscais, calendário tributário, exportação por CNPJ. Agencia: nome, slug, cor, legalEntityId, ativa; agências podem compartilhar LegalEntity. Default de setup: 1 LegalEntity = 1 Agencia espelhadas até o Administrador separar. GrupoEconomico: agregador analítico de clientes relacionados (receita, LTV, inadimplência, exposição consolidada); não substitui Client.

### 4.3 Client (mestre) e ClientAgencyRelationship

Client: nome, razão social, documento (chave forte de dedupe), e-mail, telefone, nicho, cidade/UF, endereço, representante, origem, tags, contatos, notas, soft delete. Sem agencia_id operacional.

ClientAgencyRelationship: clientId, agencyId, lifecycleStatus, financialStatus (cache), renewalStatus (cache), onboardingStatus, startedAt, pausedAt, churnedAt, endedAt, currentCommercialTermId. Mesmo cliente pode estar ativo em duas agências com contratos, gestores e cobranças distintos. ClientLoss pertence à relação.

ClientManagerAssignment: relationshipId, managerId, role MANAGER_1|MANAGER_2|COMMERCIAL_ORIGIN|SDR_ORIGIN, validFrom, validTo, changedBy, reason. A AvaliacaoMensal copia gestores para fotografia, mas não é fonte de vigência.

### 4.4 Contract e CommercialTerm

Contract: título, status comercial (PENDING|ACTIVE|RENEWAL|OVERDUE|ENDED|CANCELED), status documental (Rascunho|Enviado|Assinado|Não assinado|Cancelado), oferta, serviços N:N, início/fim, renewalDate, billingDay, paymentMethod/Mode, autoRenew, contrato anterior (encadeia renovações), condições especiais, parcelamento. Contrato formaliza, não bloqueia: cliente e cobranças podem existir sem contrato.

CommercialTerm (fonte temporal): modality MRR|TCV, monthlyValue, totalContractValue, contractMonths, validFrom, validTo, contractId, reason. Client.monthlyValue existe só como cache do valor atual; métrica histórica nunca o usa.

### 4.5 Billing, Payment, Aplicação, Crédito

Billing: relationshipId, contractId?, competence, billingKind MRR|TCV|SETUP|ONE_TIME|UPSELL|RENEGOTIATION, recognitionMode REVENUE|SETTLEMENT_ONLY, dueDate, amount, cancelledAt?, installmentGroupId?, installmentNumber?. Payment: evento de caixa (externalId?, método, conta, paidAt, valor). PaymentApplication liga os dois com valor aplicado. CustomerCredit/UnappliedReceipt + CustomerCreditMovement (origem e uso). isLate e paidInDifferentMonth podem ser materializados para performance.

### 4.6 Comercial

Lead: contato, empresa, telefone, documento, nicho, agência alvo, canal, campanha, SDR, fonte, status. Conversão deduplica por documento; nome/telefone parecidos geram sugestão humana; churnado reativa sem duplicar. Opportunity: closer, oferta, valor, modalidade, prazo, ganho/perdido com motivo. PipelineEvent/StageHistory: opportunityId, fromStage, toStage, changedAt, changedBy, reason (reconstrói pipeline histórico e tempo por etapa). Interaction: ligação, abordagem, reunião, no-show, proposta. AtividadeDiaria por SDR/agência. GastoAdsDiario por agência/plataforma. Upsell: Kanban OPPORTUNITY -> NEGOTIATION -> WON|LOST|PAUSED; WON cria Billing na competência escolhida.

### 4.7 Renegociação, ajustes, alocação, fiscal, conciliação

RenegotiationAgreement: relationshipId, originalBalance, negotiatedBalance, discountAmount, interestAmount, signedAt, ownerId, status; N:N com Billings originais, 1:N com novos SETTLEMENT_ONLY.

BillingAdjustment: billingId, type DISCOUNT|FEE|INTEREST|WRITE_OFF|CORRECTION, amount, reason, requestedBy, approvedBy?, effectiveAt; mantém originalAmount; desconto acima do threshold gera Approval; write-off sempre com motivo.

Allocation (motor genérico de rateio): sourceType/sourceId, dimensionType AGENCY|CLIENT|SERVICE, dimensionId, percentage?/amount, method MANUAL|FIXED_PERCENT|PROPORTIONAL|RULE, ruleId?, competence. Invariantes: soma não ultrapassa a origem; não alocado é visível; fechamento exige tratamento dos obrigatórios; despesa compartilhada rateia entre agências e depois clientes. Tráfego por cliente usa esta entidade.

FiscalDocument: legalEntityId, clientId, billingId?, type, number, series?, accessKey?, issuedAt, amount, status DRAFT|ISSUED|CANCELLED|REPLACED, fileId?, cancelledAt?. Relatório do contador lê por CNPJ.

BankAccount (da LegalEntity); BankStatement (importação/período); BankStatementEntry: bankAccountId, externalId/hash, postedAt, amount, description, balanceAfter?. ReconciliationMatch: 1:N, N:1 e parcial; estados UNMATCHED|MATCHED|PARTIAL|IGNORED|REVIEW. Conciliação nunca cria receita/despesa silenciosamente; diferença vira proposta de ajuste.

### 4.8 Despesa, cartões, folha, reservas

Transaction/Payable distingue reconhecimento de pagamento; conta gerencial obrigatória; natureza/belongsTo (pessoal|empresa|terceiro|familiar) define entrada no resultado operacional (Sócio/Pessoal fora). Recorrência com escopo de edição (esta / esta e as próximas) e recurrenceGroupId; parcelamento como metadado (installmentGroupKey); hash único de importação; cliente alocado e serviço vinculado.

Cartão: compra reconhece despesa + passivo; fatura agrupa passivo (total declarado do PDF para conferência); pagar fatura reduz passivo e caixa, sem nova despesa.

Folha: Payroll DRAFT -> APPROVED -> PAID (único por workspace+ano+mês); PayrollItem SALARY|BONUS|COMMISSION|BENEFIT|REIMBURSEMENT|DEDUCTION (negativo); Commission (base x taxa, competência, status) por regra versionada; alocação por agência; pró-labore com flag entra_no_resultado. DRAFT fora do realizado.

Reservas: CashBox + movimentos patrimoniais; provisão de imposto é fato separado (3.8).

### 4.9 Ledger

LedgerTransaction (imutável): id, eventType, sourceType, sourceId, competence, postedAt, reversalOfId?, postingRuleVersion, idempotencyKey. LedgerEntry: ledgerTransactionId, accountId, debit, credit, agencyId?, clientId?, serviceId?. Invariante: débitos = créditos por transação. Lançamento manual só com permissão, justificativa e aprovação por threshold.

### 4.10 Aprovações, notificações, trilhas, outbox

Approval: tipo, referência, solicitante, papel aprovador, valor, threshold, status, motivo, SLA; requestedBy != decidedBy nas operações segregadas. Notification: evento, destinatário, canal, lida/resolvida, link, preferências. OutboxEvent: evento externo pós-commit; status, tentativas, dedupeKey, payload mínimo.

Trilhas exclusivas (nada gravado em duas): AuditLog append-only = mudança de dado e ação sensível; CollectionHistory = interações de cobrança (contato, canal, mensagem, promessa, próximo passo); ClientNote = contexto humano tipado. A linha do tempo do cliente intercala as três.

### 4.11 Onboarding

OnboardingTask: relationshipId, template (por oferta/agência), tarefa, responsável, prazo (D+7/D+30/D+90 da ativação), status, obrigatória/opcional. Template padrão: contrato assinado, formulário Google Ads, formulário Meta Ads, GMN, Social Media, CTWA, acesso ao CRM, kickoff, primeira campanha no ar, primeira reunião de resultado. Sair de Onboarding exige obrigatórias completas ou exceção com motivo.

### 4.12 Fechamento, Snapshot, Métricas

ClosingPeriod: scopeType LEGAL_ENTITY|AGENCY|CONSOLIDATED, scopeId, competence, status OPEN|SOFT_CLOSED|CLOSED|REOPENED, closedBy, closedAt, version. Snapshot: closingPeriodId, snapshotSchemaVersion, metricRegistryVersion, sourceCutoffAt, payloadByArea, layoutDefinition, checksum, checksumByArea. SnapshotDependency: períodos posteriores VALID|NEEDS_REVALIDATION|REVALIDATED.

MetricDefinition: key, name, description, formulaDescription, grain, dateBasis, sourceEntities, filters, rounding, nullPolicy, version, effectiveFrom/To. Código implementa fórmulas testadas; o registry registra o contrato e a versão.

### 4.13 AvaliacaoMensal

Por relação e competência: estabilidade (Estável|Observação|Crítico), ads_status (Ativo|Pausado|Sem campanha), risco (Baixo|Médio|Alto; sugerido por 2+ cobranças vencidas), possibilidade_upsell (sim/não + serviço), gestores copiados da vigência, observação. Preenchida em grade em lote (arquivo 02).

## 5. FECHAMENTO MENSAL E MÁQUINA DO TEMPO

### 5.1 Quatro camadas de tempo

1 Estado operacional atual (tabelas vivas); 2 Ledger (fatos postados com competência e caixa); 3 AuditLog; 4 Snapshot (o que era verdade no fechamento). Convivem: "no fechamento de agosto o cliente X estava vencido" e "hoje essa dívida foi paga em setembro"; nenhuma sobrescreve a outra.

### 5.2 Estados do período

OPEN operação normal; SOFT_CLOSED fechamento em preparação (mutações comuns bloqueadas, pendências autorizadas seguem); CLOSED fotografia congelada, posting econômico na competência bloqueado; REOPENED por aprovação/justificativa. UI mostra: Aberto, Em fechamento, Fechado, Reaberto.

### 5.3 Checklist de fechamento (cada pendência com dono e link)

Nenhum MRR ativo sem Billing/justificativa; recebíveis com situação definida; contas a pagar reconhecidas/definidas; % sem conta gerencial abaixo do máximo; folha APPROVED/PAID; 100% dos ativos avaliados; zero ativos sem Gestor 1; conciliação acima do mínimo por conta relevante; rateios obrigatórios concluídos ou aceitos como não alocados; provisão tributária confirmada; reserva de impostos revisada; documentos fiscais exigidos emitidos ou justificados; vendas ganhas vinculadas; aprovações decididas; ledger balanceado; job de integridade sem divergência bloqueadora.

### 5.4 Snapshot

Grava por área: carteira, termos vigentes, receber+aging, pagar, caixa/reservas, folha, funil, DRE/razão resumido, indicadores, avaliação, layout vigente. Metadados: schemaVersion, metricRegistryVersion, sourceCutoffAt, systemVersion, closedBy/At, checksum e checksumByArea. Serialização determinística. Período CLOSED lê snapshot em painéis; drill-down pode acessar ledger/audit read-only. Job periódico: valida balanço do ledger, recalcula totais até sourceCutoffAt, compara checksums, alerta divergências.

### 5.5 Reabertura e dependências

Reabrir exige papel autorizado, justificativa e Approval quando configurado. Reabrir agosto após setembro/outubro fechados: agosto v1 preservado, agosto v2 novo, setembro e outubro NEEDS_REVALIDATION (nunca apagados). Mudança só de caixa posterior não exige reabrir a competência original.

### 5.6 Pagamento posterior a período fechado

Não altera o snapshot; cria Payment no mês do caixa; aplica ao Billing histórico; estado operacional vira pago; recuperação entra no caixa do mês; ledger posta no mês do caixa. "Como fechou agosto" mostra vencido; "saldo atual da carteira de agosto" mostra quitado.

### 5.7 Fotografias avulsas e retroativas

Fotografia nomeada por permissão, sem fechar período. Snapshots de migração marcados REBUILT_FROM_MIGRATION com proveniência do lote e confiança; nunca se passam por fechamentos nativos.

## 6. FLUXOS

### 6.1 Venda até receita

```
Lead -> Opportunity -> WON -> vincula/cria Client -> cria Relationship
 -> Contract rascunho -> CommercialTerm -> Onboarding -> Billing(s)
 -> reconhecimento por PostingRule -> Payment -> PaymentApplication
 -> AccountingEngine -> Ledger -> Outbox (CRM/notificações)
Comissão por regra versionada e gatilho configurado.
Sem contrato aprovado, o lançamento direto continua possível.
```

### 6.2 Renovação

```
D-30 -> notificação/tarefa Gestor 1 -> negociação -> RENEWED
 -> fecha vigência do termo anterior -> novo CommercialTerm MRR/TCV
 -> encadeia contrato -> gera cobranças -> ClientRenewal auditado
NRR/expansão/contração leem termos vigentes, nunca Client.monthlyValue.
Não renovou: churn com motivo -> ClientLoss; futuras canceladas; vencidas seguem em cobrança.
```

### 6.3 Inadimplência e recuperação

```
Billing vence -> OVERDUE derivado -> fila por score + régua
 -> promessa -> pagamento posterior -> aplicação -> recuperação no mês do caixa
 -> fotografia original preservada
2 vencidas -> financialStatus DELINQUENT sugerido + risco Alto na avaliação + Gestor notificado
```

### 6.4 Reparcelamento e crédito

```
Saldo vencido -> RenegotiationAgreement (desconto/juros aprovados se preciso)
 -> original RENEGOTIATED -> novos Billings SETTLEMENT_ONLY -> cobrança nas novas datas
Payment recebido -> aplica ao existente -> resto vira CustomerCredit
 -> crédito aplicável em Billing futuro -> devolução cria Refund/Reversal ligado à origem
```

### 6.5 Despesa até resultado

```
Expense/Payable -> reconhecimento por competência -> Conta Gerencial -> Allocation
 -> Ledger -> Settlement -> caixa
Cartão usa passivo intermediário; empréstimo separa principal de juros;
transferências e reservas não impactam DRE; natureza Sócio fora do resultado;
tráfego rateado por cliente -> margem de contribuição; provisão de imposto -> reserva sugerida.
```

### 6.6 Ciclo mensal

```
Dia 1: abre competência; recorrências idempotentes; folha DRAFT; provisões sugeridas;
       inicia fechamento do mês anterior
Dias 1-5: checklist -> SOFT_CLOSED -> valida ledger/conciliação -> CLOSED + Snapshot
Durante o mês: rotina diária; rotina semanal; avaliação; cobrança; conciliação; rateios
Reabertura: solicitação -> Approval -> REOPENED -> ajustes por evento/reversal
 -> novo fechamento vN+1 -> posteriores NEEDS_REVALIDATION
```

## 7. DICIONÁRIO OFICIAL DE MÉTRICAS

Toda métrica vive no MetricDefinition e é consumida por chave; nenhuma tela recalcula inline. Snapshot guarda metricRegistryVersion; mudança de fórmula cria versão nova sem reescrever o passado. A UI sempre rotula a base: competência, caixa, estado atual ou fotografia. Tooltip com definição, base e versão.

### 7.1 Financeiras

| Métrica | Definição |
| --- | --- |
| MRR oficial | soma de CommercialTerm.monthlyValue MRR vigentes na competência (relações ativas elegíveis) |
| TCV vendido | valor total dos contratos TCV fechados no período comercial |
| TCV faturado | soma de Billing TCV recognitionMode=REVENUE da competência |
| Receita SETUP/ONE_TIME/UPSELL | soma dos respectivos Billings de receita da competência |
| Receita Extra reconhecida | receita manual sem Billing na competência |
| Faturamento total | MRR + TCV faturado + SETUP + ONE_TIME + UPSELL + Receita Extra |
| Faturamento esperado (Gestão do Mês) | soma dos Billings de liquidação da competência + previstas elegíveis; operação/projeção, não DRE |
| Recebido da competência | caixa aplicado a Billings da competência analisada, conforme corte |
| Recuperação | caixa do período aplicado a Billings de competências anteriores |
| Adiantamentos recebidos | caixa do período ainda não aplicado a competência futura |
| Recebido em caixa no período | entradas de clientes + recuperação + adiantamentos + extras - reembolsos/chargebacks/estornos |
| Em aberto | soma de max(0, amount ajustado - aplicações válidas) dos Billings elegíveis abertos |
| Vencido (alias Inadimplência do mês) | parcela do Em aberto com dueDate < hoje no escopo |
| Aging | vencido atual em 1-15 / 16-30 / 31-60 / 60+ |
| Resultado do mês (Painel) | Recebido em caixa - saídas operacionais de caixa do período |
| Projeção do mês (Gestão do Mês) | Faturamento esperado - despesas previstas/da competência |
| Resultado gerencial (DRE) | receitas reconhecidas - custos - despesas reconhecidas, excluindo itens fora do operacional |
| Margem gerencial | Resultado gerencial / Receita operacional reconhecida |
| Receita recorrente normalizada | MRR + TCV ativo/prazo; somente análise |
| % Recorrência | MRR / Faturamento total (denominador zero tratado) |

### 7.2 Caixa e liquidez

Caixa total = saldo das contas/caixas incluídos. Caixa reservado = reservas restritas/planejadas. Liquidez disponível = total - reservado - compromissos imediatos configurados (o card principal usa esta, nunca saldo bruto). Projeção 30/60/90 = liquidez esperada por recebimentos e pagamentos projetados.

### 7.3 Carteira, retenção e expansão

| Métrica | Definição |
| --- | --- |
| Clientes ativos | relações ativas na competência |
| Novos clientes | relações iniciadas no período |
| Reativações | ClientReactivationEvent no período |
| Churn qtde / valor | ClientLoss no período / MRR perdido no evento |
| Churn rate | churn qtde / ativos no início |
| Revenue churn | MRR perdido / MRR inicial |
| Expansão / Contração | aumento / redução de MRR de clientes existentes por mudança de termo (pausa conta como contração conforme política) |
| NRR | (MRR inicial + expansão - contração - churn MRR) / MRR inicial |
| Taxa de renovação | renovados / elegíveis na coorte |
| Tenure | meses ativos acumulados da relação (política explícita para pausas) |
| Receita acumulada realizada | total de caixa recebido do cliente (substitui "LTV recebido") |
| LTV estimado | futuro; sempre rotulado estimativa |

### 7.4 Rentabilidade

Custo direto por cliente; Margem de contribuição do cliente = receita reconhecida - custos diretos/alocados (não chamar de lucro líquido enquanto overhead não estiver rateado); Margem totalmente alocada (futura, via Allocation); % Folha = folha elegível / base configurada, meta configurável; Tráfego não alocado = mídia obrigatória sem Allocation final.

### 7.5 Comercial

CPL; CPMQL; custo por agendamento; custo por reunião; comparecimento = realizadas/(realizadas+no-show); conversão de reunião = ganhas/realizadas; CAC = custos comerciais definidos / novos clientes; ROAS = valor de vendas ganhas pela base de valoração configurada / gasto em ads (a base que valoriza MRR: primeiro mês, valor contratual ou outra, é parâmetro obrigatório); TCV comercial = TCV vendido; Novo MRR = MRR iniciado no período; Pipeline coverage = pipeline ponderado / meta; Tempo por etapa via PipelineEvent; Conversão de upsell = ganhos/total no mês.

### 7.6 Operação e qualidade

% onboarding D+30 no prazo; % conciliação; % despesas classificadas; % rateio concluído; % NF emitidas quando obrigatórias; avaliações pendentes; promessas quebradas; tempo médio de fechamento; períodos NEEDS_REVALIDATION.

### 7.7 Saúde financeira

Score 0-100 com fatores, pesos e thresholds configuráveis e versionados (nada hard-coded como verdade estrutural); fatores penalizadores expostos na UI.
