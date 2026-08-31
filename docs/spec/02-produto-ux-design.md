# B2C FINANCE 2.2 - ARQUIVO 2/3: PRODUTO, UX E DESIGN

Especificação de produção. Conjunto: 01 domínio e regras, 02 produto/UX/design (este), 03 engenharia/segurança/roadmap. A interface preserva a lógica do v1: operação rápida, contextual, baixo custo de preenchimento. O usuário não pensa em débito e crédito para registrar um pagamento.

## 1. CAMADA DE SIMPLICIDADE

Contrato entre domínio e interface. Nenhum termo de arquitetura aparece em tela, rótulo, toast ou erro.

| O usuário faz | O domínio executa por trás |
| --- | --- |
| Edita o valor mensal na célula | Encerra o CommercialTerm atual e cria o próximo com a data escolhida (padrão: mês atual); o passado não muda |
| Marca Pago com valor maior que o devido | Aplica até o saldo e cria crédito; toast: "R$ X ficaram como crédito para a próxima cobrança" |
| Marca Pago em cobrança de mês fechado | Registra recuperação no mês atual; a fotografia não muda; o toast explica em uma frase |
| Usa Desfazer | Reversão/compensação append-only no ledger |
| Parcela uma dívida no assistente | RenegotiationAgreement + original renegociada + novas parcelas; DRE não dobra |
| Importa a fatura do cartão | Compras viram despesas, fatura vira passivo; pagar a fatura não duplica |
| Distribui tráfego na tela de rateio | Allocation grava e recalcula margem |
| Dá desconto na cobrança | BillingAdjustment com motivo; acima do limite vira pedido de aprovação automaticamente |
| Cria a conta no primeiro dia | 1 EntidadeLegal + 1 Agência espelhadas; separação só aparece ao criar a segunda entidade |
| Fecha o mês | ClosingPeriod muda de estado; snapshot com checksum e versão de métricas |
| Não faz nada | Mensalidades, provisões, recorrências, riscos e notificações acontecem sozinhos, com origem visível ("gerado automaticamente" clicável) |

Erros na mesma camada: o que houve + por que + próximo passo, no vocabulário do usuário ("Esse pagamento não pode passar do saldo de R$ 500. Registrar R$ 500 e o restante vira crédito?"), nunca no do domínio.

## 2. HOME POR PAPEL E MENU

| Papel | Home | Decide com | Age em |
| --- | --- | --- | --- |
| Admin / Financeiro | Painel executivo | 6 cards + saúde | alertas, aprovações, fila do dia |
| Gestor de contas | Minha carteira | ativos, críticos, inadimplência, renovações | avaliações, onboarding, renovação, cobrança |
| Closer | Painel de vendas | vendido x meta, pipeline, conversão | oportunidades paradas, contratos sem assinatura |
| SDR | Atividade diária | agendamentos x meta, reuniões, comparecimento | registro rápido, leads a retomar |
| Cobrança | Fila de cobrança | vencido, aging, recuperado | fila priorizada, promessas, mensagens |
| Contador | Contábil read-only | DRE, razão, fiscal por CNPJ | exportações |
| Auditor/Leitura | Consulta | escopo permitido | sem mutação |

Menu (RBAC governa visibilidade):

```
Home . Gestão do Mês
Carteira: Clientes . Contratos e Renovações . Termos/Histórico de preço . Avaliação mensal . Onboarding . Upsell
Financeiro: Receber e Inadimplência . Créditos/Adiantamentos . Pagar . Cartões . Fluxo de Caixa . Conciliação . Folha e Comissões . Reservas
Contábil: Plano de contas . Lançamentos/Razão . DRE . Fechamento . Documentos fiscais . Exportação
Comercial: Funil . Atividade diária . Indicações . Vendas . Metas
Histórico: Máquina do tempo . Fotografias . Comparativo
Análise: Painel Anual . Relatórios . Rentabilidade . Assistente IA
Sistema: Rotinas . Notificações e Aprovações . Importar . Regras de categoria e rateio . Usuários . Entidades e Agências . Configurações . Auditoria
```

Barra superior global: MonthNav + seletor de escopo (Todas | EntidadeLegal | Agência) + Busca global + atalho da paleta.

## 3. BUSCA GLOBAL, PALETA E PRIMEIRO USO

Busca global (/ ou campo na barra): clientes, contratos, cobranças (valor/descrição), despesas, leads, telas; agrupada por tipo, navegável por teclado, com ações rápidas no resultado. Carteira usa índice local (instantâneo); resto no servidor.

Paleta de comandos (Ctrl/Cmd+K): busca + ações + navegação ("registrar pagamento", "nova despesa", "ir para julho", "fechar competência", "comparar março x julho", "exportar DRE"). Respeita RBAC (ação sem permissão não aparece). Acelerador, nunca caminho único.

Atalhos globais: g m Gestão do Mês; g c Carteira; g r Receber; [ e ] mês anterior/seguinte; / busca; ? mapa de atalhos (gerado do registro real de comandos). Tabelas: setas navegam, Enter abre, espaço seleciona, p registra pagamento na linha, u desfaz.

Setup guiado (checklist na home até concluir, ~30 min, nada bloqueia, tudo tem "fazer depois"): 1 agência (cria EntidadeLegal espelhada); 2 time (convites e papéis); 3 clientes (planilha ou migração v1, prévia validada); 4 contas e cartões com saldo inicial (âncora do cutover); 5 despesas fixas; 6 pronto: Gestão do Mês abre populada. Estados vazios de todas as telas apontam para o passo correspondente. Dados de demonstração só em homologação.

## 4. MÓDULOS

### 4.1 Carteira

Lista governada pela competência; colunas configuráveis: cliente, agência, modalidade vigente, valor vigente, estabilidade, ads, risco, gestores, tenure, receita acumulada, saldo em aberto, renovação, upsell, origem; filtros salvos; agrupamento por gestor/agência/grupo com subtotais; célula Pagamento (mês) materializa a cobrança real (preencher é registrar). Cadastro deduplica no Client; vincular nova agência cria relação, não novo cliente. Ações: churn (motivo + decisão sobre parcelas), pausar, retomar, reativar.

Avaliação mensal em grade: linhas = meus ativos; colunas = estabilidade, ads, risco, upsell, obs; pré-preenchida com o mês anterior; confirmar tudo em 1 clique + ajustar exceções; navegação por teclado célula a célula (setas, Enter confirma linha); "confirmar todos os sem mudança". Custo alvo: 10 min/gestor/mês. Fechamento cobra só não avaliados e idênticos há 3+ meses.

Área do cliente (abas): Resumo; Relações por agência; Contratos; Cobranças/Pagamentos/Créditos; Histórico de preço/termos; Avaliações; Onboarding; Renovações/Upsell; Documentos; Linha do tempo unificada (3 trilhas intercaladas com ícone de origem).

### 4.2 Contratos, Renovações e Onboarding

Contrato formaliza, não bloqueia. Biblioteca de modelos DOCX com variáveis, pré-preenchimento do cliente e link público /f/[token]; aceite registra data/hora, IP, hash do documento e texto marcado. Renovação: fonte de domínio única; o fluxo encerra/encadeia contrato, cria termo com vigência, atualiza renewalStatus, gera cobranças, grava ClientRenewal, publica Outbox. Visões: vencendo 30/60/90, vencidos sem decisão, renovados/não renovados com motivo, mês extra (bônus sem receita), taxa por coorte. Onboarding existe desde a Fase 1 (cliente manual também inicia); board por cliente com checklist, prazos e responsável; painel do gestor mostra vencidas.

### 4.3 Receber, Inadimplência e Régua

Hub único de recebíveis: competência atual e histórica; aging 1-15/16-30/31-60/60+; saldo original, atual e no fechamento; pagamentos e aplicações; créditos não aplicados; promessa; negociação/reparcelamento; write-off (via aprovação); mensagens. Estado atual da dívida muda após fechamento; a fotografia não.

Fila priorizada por score (atraso, valor, key account, reincidência, promessa quebrada; alta/média/baixa com motivo legível) + gerador de mensagens em 7 tons (padrao, amigavel, formal, direto, urgente, ultima_tentativa, reativacao).

Régua: D-3, D0, D+3, D+7, D+15; nunca envia com promessa vigente, opt-out, silêncio ou bloqueio manual; respeita dias úteis e horário. Fase inicial gera tarefa com mensagem pronta (envio em 1 toque, Modo Fila); fase automática usa Outbox + AvanceCRM/WhatsApp e loga CollectionHistory.

### 4.4 Pagar, Cartões, Fluxo de Caixa, Conciliação, Folha, Reservas

Pagar: recognized/approved/paid distintos; recorrentes idempotentes com escopo de edição; conta gerencial obrigatória (% não classificado exposto); natureza Sócio fora do resultado; parceladas com saldo devedor. Cartões: compra é a despesa; fatura agrupa; importação PDF/CSV com dedupe por hash, parcelamento como metadado, herança de histórico, regras de categorização; tela de rateio da fatura de ads (regra por descrição de campanha + distribuição manual do resto; não alocado visível). Fluxo de caixa: por data de caixa, saldos por conta, projeções 30/60/90, alerta de liquidez projetada negativa. Conciliação: OFX/CSV -> BankStatementEntry -> matches sugeridos -> confirmação; discrepância vira proposta de ajuste; nada silencioso. Folha: prévia/provisão automática; comissões por regra versionada; adiantamentos abatidos; pró-labore por flag. Reservas: caixa total x reservado x liquidez disponível; reserva de imposto é transferência patrimonial, provisão é evento separado.

### 4.5 Contábil

Plano de contas com natureza; posting rules; ledger; DRE por competência/agência/EntidadeLegal; razão; documentos fiscais; exportação (CSV/XLSX + faturamento por CNPJ com NF). Filtros: realizado por competência; caixa; DRE gerencial; receita normalizada informativa; consolidado. Lançamento manual é exceção com permissão, justificativa e aprovação.

### 4.6 Rotinas (cadência de gestão)

Diária: cobranças do dia (fila por atraso), pagamentos do dia, contas vencendo, conciliações pendentes, checklist persistido (remover só oculta), sugestões da IA, tom por atraso. Semanal (segunda): críticos/observação, renovações 30d sem negociação, promessas da semana, pipeline parado 7+ dias, caixa projetado, rateios pendentes, fiscais faltantes, comparativo da semana anterior; gera as tarefas da semana. Mensal: dia 1 abre competência (recorrências, provisões, folha DRAFT) e inicia fechamento guiado do anterior; dias 1-5 checklist com dono e link; SOFT_CLOSED antes do definitivo; pós-fechamento, leitura executiva da fotografia com comparativo.

### 4.7 Notificações e Aprovações

Catálogo (evento -> destinatário padrão): cobrança vencida/promessa quebrada -> Cobrança + Gestor 1; contrato 30/15/7 -> Gestor 1 + Admin; pagar D-3/vencida -> Financeiro; liquidez projetada negativa -> Admin; venda sem contrato -> Closer + Admin; 2+ vencidas -> Gestor 1; onboarding vencido -> responsável + Gestor; avaliação pendente (a partir do dia 25) -> Gestor; conciliação abaixo do mínimo, rateio pendente, fiscal faltante -> Financeiro; aprovação solicitada -> aprovador elegível; snapshot NEEDS_REVALIDATION -> Admin + Financeiro; importação com erros -> importador; outbox em falha permanente -> Admin/Suporte.

Regras anti-fadiga: agrupamento por origem (n vencidas = 1 notificação com contagem); teto diário por usuário (padrão 15; estouro vai ao digest); silêncio fora do horário comercial exceto críticos; preferências por usuário (canal, tempo real x digest). Caixa de Aprovações: fila única com contexto, valor, impacto e histórico; decisão em 1 clique auditada; solicitante nunca vê o botão Aprovar da própria solicitação.

### 4.8 Demais

Painel Anual, Relatórios (registry com export respeitando filtros/colunas/ordenação; inclui DRE, razão, margem de contribuição, aging, créditos, reparcelamentos, fiscais, reconciliação, histórico de preços, NRR/coortes, comparativo por escopo, carteira no layout da planilha), Assistente IA (retrato injetado como única fonte, fato x projeção x sugestão, memória por usuário), Importar (prévia validada, lote reversível, 500 linhas), Regras de categoria e rateio, Usuários, Configurações, Auditoria.

## 5. PAINÉIS (COMPOSIÇÃO NORMATIVA)

### 5.1 Painel executivo

Decidir (6 cards, cada um com sparkline 12m e clique abrindo detalhe no contexto): Faturamento total; Despesas/saídas (conforme modo); Recebido em caixa; Em aberto (Vencido embutido); Resultado do mês; Liquidez disponível + projeção 30d. Cabeçalho explicita o modo temporal (competência | caixa | fotografia).

Entender (3 gráficos): Esperado x Recebido em caixa x Despesas (combinado); Resultado mensal (barras divergentes); Composição MRR/TCV/avulsos (donut). Adicionais em detalhe: despesas por conta, carteira, saúde. Saúde financeira expõe os fatores que penalizaram. Resumo determinístico colapsável (aberto por padrão só segunda-feira).

Agir: Atenção hoje: vencidos, contratos vencendo, pagar 7d, vendas sem contrato, aprovações, conciliação/rateio/fiscal críticos.

Secundários visíveis (8): MRR; TCV faturado; % recorrência; ativos; novos; churn; ticket médio; % folha. Nunca repetir Inadimplência e Margem (já estão nos cards). Link "todos os indicadores" abre o painel completo.

### 5.2 Gestão do Mês

Cinco seções intactas: resumo (6 cards), Clientes do Mês (status derivado, KPIs do ciclo clicáveis, edição inline com efeito no cadastro, ações por linha e em massa), Recebimentos (distingue da competência x recuperação; pagamentos posteriores de dívida histórica aparecem como recuperação sem tocar na fotografia), Pagar do mês, Folha (real ou prévia), Renovações. Card renomeado: Projeção do mês (= esperado - despesas; tooltip com a fórmula). SETUP/ONE_TIME/UPSELL entram no esperado de forma explícita. Coluna opcional estabilidade/risco. Estado do ClosingPeriod no cabeçalho com pendências.

### 5.3 Painel Anual

Linhas: Esperado, Recebido em caixa, Recuperação, Novos valor/qtde, Outras entradas, Despesas, Folha, Tráfego, Comissão, Resultado, Ativos, Churn qtde/valor, % Realização, Vencido acumulado. TCV rotulado faturado/vendido quando necessário. Meta anual desdobrada por Agência/EntidadeLegal. Fotografia usa fórmula/versão da época. Simulador de cenários (funções puras) mantido. Anotações de evento nos gráficos (reabertura, mudança de versão de métrica, campanha) com tooltip.

### 5.4 Painéis por papel

Gestor: ativos, críticos/observação, saldo vencido dos seus, renovações, evolução 6m, ações (avaliações pendentes, onboarding vencido, renovações sem negociação). Closer: vendas x meta, pipeline por estágio, conversão, tempo por etapa; ações. SDR: hoje x meta, semana, comparecimento, retomadas. Cobrança: vencido, aging, recuperado, promessas. Nenhum painel de papel mostra resultado, folha ou caixa sem permissão de campo.

### 5.5 Regras permanentes

Teto 6 cards / 3 gráficos / 2 listas por home; número nunca aparece duas vezes com rótulos diferentes; todo card abre detalhe já filtrado; todo gráfico responde uma pergunta escrita no título; dinheiro informa base temporal; histórico fechado lê snapshot; comparação entre versões de métrica avisa; esqueleto em até 200 ms e conteúdo dentro do orçamento (arquivo 03).

## 6. CUSTO DE PREENCHIMENTO (DONO, FREQUÊNCIA, ALVO)

| Dado | Dono | Freq | Alvo | Fricção reduzida por |
| --- | --- | --- | --- | --- |
| Pagamento recebido | Financeiro/Cobrança | diário | 1 gesto | conciliação sugere; aplicação automática em match seguro |
| Crédito/adiantamento | Financeiro | evento | <1 min | saldo não aplicado automático |
| Despesas | Financeiro | semanal | 15 min | recorrências, imports, regras |
| Fatura/cartão | Financeiro | mensal | 10 min/cartão | import + dedupe |
| Conciliação | Financeiro | semanal | 20 min | matching sugerido |
| Rateios | Financeiro/Gestor | mensal | 10 min | regras + exceções |
| Avaliação mensal | Gestor | mensal | 10 min | grade em lote |
| Venda | Closer | por venda | 2 min | herança da Opportunity |
| Alteração de preço/modalidade | Gestor/Financeiro | evento | 1 min | novo termo, nunca edita passado |
| Renovação | Gestor 1 | evento | 2 min | fluxo único |
| Reparcelamento | Cobrança/Financeiro | acordo | 3 min | wizard calcula parcelas |
| Desconto/write-off | Financeiro | exceção | 1-3 min | ajuste + aprovação automática |
| Folha | Financeiro | mensal | 15 min | provisão + comissão por regra |
| Onboarding | responsável | por cliente | distribuído | checklist |
| NF/fiscal | Financeiro | evento | 30s-1min | pendências listadas |
| Troca de gestor | Admin/líder | evento | <1 min | vigência automática |
| Atividade SDR | SDR | diário | 30 s | mobile 1 toque |
| Notas de cobrança | quem interagiu | contato | 30 s | dentro do diálogo |
| Fechamento | Financeiro | mensal | só exceções | checklist com links |
| Setup inicial | Admin | uma vez | 30 min | guiado |
| Comando/navegação | todos | contínuo | <2 s | paleta, atalhos, busca local |
| Processar fila de cobrança | Cobrança | diário | <20 s/item | Modo Fila |

Todo o resto é derivado (status, aging, MRR histórico, saldo, métricas, provisões sugeridas, riscos, alertas). Preencher a célula é registrar; gesto inline antes de formulário.

## 7. DESIGN SYSTEM

### 7.1 Direção: Precisão Editorial

Instrumento financeiro premium: calmo, denso sem parecer denso; tecnologia em velocidade e inteligência, não em enfeite. Réguas: Linear, Stripe Dashboard, Mercury. Dois territórios:

| Território | Onde | Linguagem |
| --- | --- | --- |
| Marca | Login, capas de PDF/fotografia, e-mails, boas-vindas | Identidade B2C plena: navy profundo, grão sutil, quadrados geométricos sobrepostos, marca d'água B2C translúcida, dourado em destaques |
| Produto | Telas de trabalho | Canvas claro/escuro neutro, um único acento azul, semântica de status, zero ornamento |

Dourado nunca entra nas telas de trabalho (lá, âmbar = atenção). Navy vive na navegação lateral e nos momentos de marca.

### 7.2 Fundações

Cor: escalas de 12 passos consumidas só por token semântico. brand/primary (azul B2C unificado): accent, accent-hover, accent-active, accent-subtle, accent-foreground, ring. neutral (base slate): canvas, surface, surface-raised, surface-sunken, border, border-soft, text, text-muted, text-faint. semantic: success, warning, danger, info, cada um com sólido, suave e foreground nos dois temas. brand-only: navy #0d1b2e, gold #F5C518, grão (exclusivos de marca e tema documento). Regras: um acento por tela além da semântica; fundo suave sempre com par dark (tintura clara / translúcida 10-12% no escuro); contraste AA; dataviz com paleta própria de 6 séries daltônico-segura começando pelo acento. Dark de primeira classe: canvas ~#0B1220 pela escala, elevação por clareamento + borda, tinturas translúcidas, grade de gráfico discreta; usuário escolhe claro/escuro/sistema.

Tipografia: Inter (interface), JetBrains Mono tabular (todo número financeiro). Escala tamanho/altura: 12/16 legendas; 13/18 tabela densa; 14/20 corpo; 16/24 ênfase; 20/28 título de seção; 24/32 título de página (peso 600, tracking -0.02em, nunca 700+); 32/38 e 44/48 só valores em card (mono, 500). Negativo: sinal de menos + cor semântica quando contexto semântico; nunca parênteses. Dinheiro sempre com badge de base temporal por perto (Competência | Caixa | Fotografia). Formatos: R$ 1.500,00; eixos R$ 12 mil; DD/MM/AAAA; Jan..Dez; exibição no timezone do workspace.

Espaço: grade 4px com ritmo de 8 (4, 8, 12, 16, 24, 32, 48, 64); conteúdo máx 1440px; leitura de documento máx 880px; colunas 4/8/12; cards de KPI em fileiras de 3 ou 6, nunca 4 ou 5.

Forma e elevação: raios pill (botões/badges), 8px células editáveis, 12px inputs, 16px cards, 24px modais. Elevação 4 níveis por borda + sombra mínima: 0 plano (tabelas); 1 card (borda + 1px); 2 flutuante (popover: média); 3 modal/drawer (ampla + scrim 40% com blur 8px, único uso de translucidez). Sem glassmorphism em superfície de trabalho.

Iconografia: Lucide, traço 1.5px, 16 inline / 20 navegação; ícone nunca sozinho em ação primária ou destrutiva. Ilustração só em estado vazio: traço fino monocromático + toque do acento.

### 7.3 Movimento

```
instant  80ms  ease-out    hover, foco, press
fast    140ms  ease-out    dropdown, tooltip, chip
base    200ms  standard    aba, expandir linha, drawer
slow    280ms  decelerate  modal, transição de tela, troca de mês
spring  leve, uma só       undo-toast entrando, item saindo de fila
```

Coreografia: stagger máx 20ms nos 8 primeiros itens; uma coisa se move por vez; troca de mês desliza 12px na direção do tempo (esquerda = passado) com fade.

Micro-interações canônicas: pagar em 1 clique = a linha assenta (check desenha 140ms, tintura verde acomoda, valor conta até o total em 300ms, undo-toast com spring); KPI conta do valor anterior em até 400ms uma vez por carga (nunca em update de fundo); linha de gráfico desenha 400ms na primeira carga, barras 240ms, depois troca seca; urgência é cor e posição, nunca pisca/pulsa; drag do kanban com fantasma inclinado 2 graus e sombra nível 2, solta assentando em 200ms; prefers-reduced-motion torna tudo troca instantânea.

### 7.4 Dataviz

Todo gráfico responde uma pergunta escrita no título. Linhas 2px sem pontos (ponto no hover com valor, variação e base temporal); grade horizontal discreta, sem vertical; máx 4 séries em linha (acima vira tabela ou pequenos múltiplos); série principal = acento; séries semânticas usam a cor semântica; barras divergentes para resultado; donut só composição com total no centro; proibidos pizza, 3D, gradiente em série, eixo truncado sem indicação. Sparklines nos cards: 12m, 1.5px, sem eixos, área 8%, ponto final marcado. Anotações de evento: marcador vertical fino com rótulo no hover. Estados: carregando = moldura + eixos com shimmer; sem dados = pergunta do título + caminho para gerar o dado. Cor nunca é o único canal (tracejado/marcador na legenda).

### 7.5 Gabaritos de tela (toda tela declara o seu)

1 Cockpit (homes/painéis): decidir, entender, agir; teto 6/3/2. 2 Planilha viva (Gestão do Mês, Carteira, Receber, Pagar): barra de contexto (MonthNav, escopo, busca, filtros salvos), KPIs do ciclo clicáveis, tabela densa com edição inline, totais no rodapé, ações em massa na seleção. 3 Fila (cobrança, aprovações, conciliação, revisão de importação): um item em foco + contexto ao lado, ações por tecla, progresso "12 de 38", pular sem culpa. 4 Documento (DRE, razão, relatório, fotografia): 880px, tipografia editorial, sumário lateral, pronto para exportar no tema 7.7. 5 Linha do tempo (cliente, auditoria): eventos cronológicos com ícone de trilha, agrupamento por dia, filtro por trilha.

Mobile: primeira classe para Atividade SDR, Fila de cobrança, aprovar/negar, registrar pagamento, consultar cliente (MobileCards); consulta confortável para painéis; Gestão do Mês completa e fechamento são desktop por decisão. Barra inferior com 4 itens por papel + gaveta; alvos 44px; sem scroll horizontal; puxar para atualizar nas filas.

### 7.6 Estados e feedback (5 estados obrigatórios por componente)

Carregando: esqueleto na geometria real em até 200ms; spinner só dentro de botão; nunca tela branca. Vazio: EmptyState com o que estaria aqui + por que + botão do próximo passo (no setup aponta o passo). Erro: o que houve + como resolver + tentar de novo; rede preserva o digitado; sem jargão de domínio. Parcial: badge de pendência clicável (não categorizado, não conciliado, migrado com baixa confiança). Conflito: "alguém alterou isto agora há pouco" com as duas versões e escolha explícita; nunca sobrescreve calado.

Feedback: toda mutação responde em até 100ms (otimista ou pendente); Desfazer 15 min em gesto financeiro; modal de confirmação só para o irreversível real (excluir cliente, fechar competência, reabrir), com a consequência escrita em uma frase.

### 7.7 Fluidez: otimismo, teclado, fila

| Gesto | Modo | Falha |
| --- | --- | --- |
| Pagar / A vencer / Devendo na linha | Otimista | linha reverte com motivo |
| Editar valor/vencimento/obs inline | Otimista | campo reverte, digitado preservado |
| Mover card de kanban | Otimista | volta com spring |
| Concluir item de rotina/fila | Otimista | retorna à fila |
| Registrar pagamento (formulário) | Confirmado (spinner no botão) | formulário preservado |
| Renovar, reparcelar, churn | Confirmado | diálogo preservado |
| Fechar/reabrir, aprovar | Confirmado com resumo prévio | nada muda |
| Importações | Progresso por etapa | lote reversível |

Percepção de velocidade: prefetch do mês anterior/seguinte em toda tela com MonthNav; busca da carteira local; filtros sem reload; operações longas mostram etapas (fechar competência exibe o checklist executando). Teclado de primeira classe: paleta, atalhos, grade e Modo Fila 100% sem mouse.

### 7.8 Identidade da Fotografia e tema documento

Fotografia: faixa superior fixa âmbar-suave com selo Fotografia + competência + versão + quem fechou; canvas com tintura de papel 2% mais quente; controles de edição ausentes (não desabilitados); badge temporal travado em Fotografia; comparativo em duas colunas com deltas na coluna central.

Tema documento (PDF/impressão de fotografia, DRE, relatórios): capa navy #0d1b2e com grão, quadrados sobrepostos, marca d'água B2C, título condensado, dourado #F5C518 só nos valores de destaque da capa; miolo claro no gabarito Documento; cabeçalho com competência e escopo; rodapé com página, versão do snapshot e checksum; zebra 3%. E-mails: cabeçalho navy com logo, corpo claro, um botão de acento, sem imagem decorativa.

### 7.9 Acessibilidade (AA, critério de pronto)

Contraste 4.5:1 texto e 3:1 componentes nos dois temas, verificado no build; foco visível (anel 2px do token ring), tab lógico, skip-link; tudo operável por teclado, nada exige hover/arrastar (kanban tem select); cor nunca canal único (rótulo/ícone/badge/marcador); leitor de tela: moeda + base temporal anunciadas, cabeçalhos de tabela associados, aria-live educado, foco preso em modal com retorno ao gatilho; reduced-motion integral; fonte do sistema até 125% sem quebra; rótulo sempre visível (placeholder nunca é rótulo), erro associado, autocomplete correto.

### 7.10 Governança

Tokens são a única fonte de cor, tipo, espaço, raio, sombra e movimento; classe crua de Tailwind na UI reprova no lint (exceção declarada: dataviz). Componente novo entra no catálogo (Storybook no CI) com os 5 estados documentados. Tela nova declara gabarito e pergunta de cabeçalho. Revisão de design usa esta seção como checklist; divergência exige alterar a seção antes do merge. Componentes canônicos a reutilizar: MonthNav + seletor de escopo, KPI único, metric-help, gráfico combinado com toggle Mensal/Acumulado, donut, tabela responsiva + MobileCards, EmptyState, PageHeader, skeletons, status-meta (língua única: verde Pago/Estável/Ativo; âmbar A vencer/Observação/Parcial/Pausado; vermelho Vencido/Crítico/Churn; cinza Cancelado/Inativo; azul Novo/Em negociação; semânticas nunca são fundo de CTA), undo-toast (host único), SavedView, kanban, diálogo único de renovação, grade de avaliação, central de notificações, fila de aprovações.

## 8. CENÁRIOS DE ACEITE (S1-S27)

S1 Home executiva: Admin, segunda 8h, em 5 min identifica liquidez, vencidos, aprovações, críticos, renovações e projeção; nenhum card mistura caixa e competência sem rótulo. S2 SDR mobile: atividade registrada em 30s com meta visível. S3 TCV 3.000 em 2x: venda cria Client/Relationship/Contract/Term e 2 cobranças; vendido = 3.000 no mês da venda; faturado = 1.500 por competência. S4 Recuperação: cobrança de agosto paga em setembro; snapshot de agosto continua vencido; saldo atual quitado; recuperação e caixa em setembro. S5 Renovação TCV -> MRR: novo termo com vigência; histórico preservado; NRR usa vigências. S6 Fechamento e correção: agosto fecha v1; erro econômico exige Approval, reversal, novo lançamento, agosto v2; v1 preservado. S7 Fatura e rateio: 62 transações, duplicadas barradas por constraint/hash, categorizadas por regra, tráfego rateado; pagar a fatura não duplica despesa. S8 Escopo: gestor vê só o permitido; cache nunca entrega dado de escopo superior. S9 Churn com dívida: lifecycle CHURNED; dívida continua vencida e cobrável. S10 Máquina do tempo: compara março x julho com layout/fórmulas das fotografias. S11 Cliente em duas agências: um Client, duas relações, dois contratos, relatórios separados e consolidados. S12 Reajuste histórico: MRR 1.000 até junho, 1.500 desde julho; maio segue 1.000; expansão de 500 em julho. S13 Excedente: Billing 1.500 recebe 1.600; 100 viram crédito; em aberto 0; caixa 1.600; sem faturamento extra. S14 Reparcelamento: 3.000 vira 3x1.000; original sai do aging como RENEGOTIATED; DRE não vai a 6.000. S15 Empréstimo: +10.000 caixa e passivo, resultado 0; paga 1.000 principal + 100 juros, resultado cai só 100. S16 Reserva de imposto: transfere 5.000; liquidez disponível cai conforme política; caixa total igual; DRE não muda. S17 Reabertura antiga: reabrir agosto marca setembro NEEDS_REVALIDATION. S18 Conciliação líquida: venda 1.000, taxa 30, banco 970; match relaciona receita + taxa sem inventar diferença. S19 Self-approval proibido. S20 Webhook duplicado: unique key aceita um único Payment/LedgerTransaction. S21 Arredondamento: 100 em 3 partes soma 100,00. S22 Métrica versionada: fórmula de CAC muda em 2027; snapshot de 2026 reporta a versão antiga. S23 Primeiro dia: setup em 30 min, Gestão do Mês populada, nenhum conceito de arquitetura exposto. S24 Teclado: paleta registra 3 pagamentos sem mouse; [ volta mês; u desfaz. S25 Fila de 38 vencidos: Modo Fila, mensagem no tom certo, enviar/promessa/pular por tecla, 38 itens em 12 min. S26 Acessibilidade: navegação completa por teclado, leitor anuncia status e base temporal, reduced-motion respeitado. S27 Fotografia apresentável: PDF com capa navy, resumo, carteira e DRE no tema documento, rodapé com versão e checksum.
