# Auditoria do módulo de relatórios — B2C Finance

**Teste realizado em 10/09/2026, horário de Brasília/Bahia.** Foram abertos os 18 tipos de relatório do catálogo, gerados os 18 PDFs pelo botão nativo “Imprimir / PDF” e inspecionadas visualmente suas 42 páginas. Os arquivos originais estão na pasta `pdfs-originais`, com numeração correspondente à análise abaixo.

## Parecer

O catálogo cobre boa parte dos assuntos necessários à operação de uma agência: carteira, recebimentos, despesas, folha, caixa, recorrência, contratos, retenção e margens. A cobertura de assuntos é boa; a entrega analítica e a confiabilidade entre relatórios ainda são insuficientes para usá-los como um pacote gerencial de fechamento.

Hoje, a maioria funciona como **uma listagem exportada, precedida de um ranking genérico**, e não como um relatório desenhado para responder à pergunta de gestão de cada assunto. Há padronização superficial de cabeçalho e tabela, mas faltam definições consistentes, conciliações, contexto temporal, qualidade de dados e um layout de impressão que preserve todas as colunas.

**Prioridade: corrigir integridade da exportação e coerência dos indicadores antes de ampliar gráficos ou investir apenas na estética.** Um PDF bonito com valores incomparáveis pode aumentar a confiança em uma conclusão errada.

## Escopo e limites

- Exportação testada no Chrome, em A4 retrato, com as colunas padrão e os controles de totais/gráfico disponíveis. O Financeiro Mensal foi testado na visão anual; os demais, nas condições iniciais apresentadas, geralmente “Este mês”.
- Teste real do arquivo final: os problemas abaixo não se baseiam apenas em capturas da tela. Foram renderizadas e conferidas todas as páginas dos PDFs.
- Conferência adicional da Folha na origem: setembro está “Não gerada”; agosto está “Paga”, total de R$ 27.700, paga em 04/09/2026.
- Não houve alteração de clientes, cobranças, despesas, contratos ou folha. Foram usados apenas navegação, filtros e exportação.
- Não foram auditados código, banco, permissões entre perfis, XLSX/CSV nem todas as combinações possíveis de filtros. Folha e Upsell foram exportados vazios no período inicial; a estrutura com dados de Upsell não pôde ser avaliada.
- As diferenças numéricas são evidências da interface e dos arquivos naquele momento. Quando a causa depende da implementação, ela está identificada como hipótese, não como erro de código comprovado.
- Esta é uma análise de produto e consistência gerencial, não uma validação contábil dos lançamentos.

## 1. Problemas prioritários, com evidência

### P0 — PDFs perdem conteúdo financeiro

Em vários arquivos, a tabela ultrapassa a área imprimível e o lado direito é cortado. Exemplos:

| PDF | Perda visível |
|---|---|
| 02 — Clientes | As informações financeiras à direita, como receita total, aberto e vencido, não chegam integralmente ao documento. A listagem ocupa nove páginas mesmo assim. |
| 03 — Inadimplência | A coluna de retorno fica cortada. A terceira página contém essencialmente o rodapé. |
| 04 — Acordos | Datas de vigência/renovação à direita ficam incompletas; há quebra de registro entre páginas. |
| 05 — Despesas | A coluna Valor desaparece da listagem; vencimento também fica parcial. O ranking não substitui os valores de cada lançamento. |
| 09 — Margem alocada | O percentual final não fica integralmente visível; a quarta página é praticamente apenas o rodapé. |
| 10 — Recebimentos | Situação, responsável e valor à direita deixam de ser integralmente apresentados. |
| 11 — Receita Extra | Campos finais e valor não ficam integralmente disponíveis na tabela; aparece barra de rolagem impressa. |
| 12 — MRR | Anualizado e campos finais ficam cortados. |
| 13 — TCV | Valores finais cortados e barra de rolagem impressa. |

**Correção:** criar composição própria para PDF, com orientação e colunas adequadas. O usuário não deve precisar adivinhar escala, desmarcar campos essenciais ou reduzir a fonte até ficar ilegível. O botão deve produzir um documento íntegro em sua configuração padrão. Usar paisagem quando necessário e separar resumo de anexo detalhado.

### P0 — Executivo contradiz o relatório de inadimplência

- Executivo: **0 clientes inadimplentes**.
- Inadimplência: **22 clientes, 24 cobranças, R$ 26.840 vencidos**.

O Executivo não explicita um recorte que explique essa diferença. Isso compromete diretamente a decisão de cobrança e risco.

**Correção:** um único cálculo de inadimplência, com data de corte explícita, saldo residual de pagamentos parciais e regras documentadas de cancelamento/renegociação. O indicador executivo deve abrir exatamente a listagem que o compõe. Se houver recortes diferentes, nomeá-los e apresentar a ponte entre eles.

### P0 — Resultado mensal não fecha com as colunas apresentadas

No Financeiro Mensal:

| Competência | Receitas | Despesas | Folha | “Lucro/prejuízo” exibido |
|---|---:|---:|---:|---:|
| Julho | R$ 33.440,00 | R$ 0,00 | R$ 28.557,00 | R$ 33.440,00 |
| Agosto | R$ 46.730,17 | R$ 67.558,00 | R$ 27.700,00 | -R$ 6.027,83 |
| Setembro | R$ 19.100,00 | R$ 85.287,53 | R$ 0,00 | -R$ 11.933,00 |

O usuário não consegue reproduzir o resultado pelas colunas. Em setembro, os R$ 11.933 negativos coincidem com o caixa: R$ 19.100 recebidos menos R$ 31.033 pagos. A despesa exibida de R$ 85.287,53 inclui outros lançamentos. **Há evidência de bases diferentes ou apresentação inadequada; a fórmula interna não foi inspecionada.**

Janeiro a junho aparecem com margem de 100% e despesas/folha zeradas. Isso pode significar ausência de histórico de custos, e não rentabilidade efetiva de 100%. Outubro a dezembro mostram despesas de R$ 30.318 mensais, receita zero e resultado zero, sem distinguir previsão de realizado.

**Correção:** separar resultado por competência de movimento de caixa; distinguir realizado, previsto e período ainda incompleto; identificar se folha está incluída em despesas. Exibir fórmula e ponte de conciliação. Margem consolidada deve resultar dos totais compatíveis, não da média simples de percentuais mensais.

### P0 — Receita Extra não aparece no caixa exportado

Receita Extra contém **R$ 840 recebidos em 08/09/2026**, descrição “RECEBIMENTO EXTRA - CARLOS GEILSON”, origem manual. O Fluxo de Caixa lista 15 movimentos, com entradas de R$ 19.100 e saídas de R$ 31.033, sem esse lançamento.

**Se o lançamento representa efetiva entrada em conta no mesmo escopo**, o movimento líquido deveria ser R$ 19.940 − R$ 31.033 = **-R$ 11.093**, e não -R$ 11.933. A ausência na listagem é confirmada; a causa e eventual regra de exclusão precisam ser verificadas na implementação.

**Correção:** integrar todas as fontes ao livro de movimentos, com identificador de origem e prevenção de duplicidade. Se uma entrada manual não movimenta caixa, o formulário e o relatório devem informar isso expressamente.

### P0 — Bases comerciais e financeiras não são conciliáveis

| Visão | Valor encontrado | O que aparenta medir |
|---|---:|---|
| Clientes/Acordos | R$ 9.200 mensais; 6 contratos ativos | Contratos formalizados na base de acordos |
| MRR | R$ 44.756; 38 clientes | Base recorrente dos clientes ativos |
| Executivo | R$ 50.756 de “faturamento total” | R$ 44.756 de MRR + R$ 6.000 de TCV |
| Margem por cliente | R$ 50.606 de receita | Receita reconhecida do período |
| Recebimentos | R$ 19.100 | Pagamentos recebidos |

Esses números **não precisam ser iguais**, pois podem medir coisas diferentes. O problema é usar nomes próximos sem explicar fonte, regime, cobertura e reconciliação. “Faturamento MRR” não deve ser tratado automaticamente como faturamento efetivo do mês. Anualizar MRR também não é provar receita contratada ou garantida por doze meses.

**Correção:** estabelecer conceitos separados de base recorrente, venda contratada, cobrança emitida, receita reconhecida e recebimento. Mostrar ajustes e diferenças; indicar contratos ausentes ou cadastro legado quando aplicável.

### P0 — Margens podem induzir conclusões sem base suficiente

- Contribuição: 39 clientes; receita R$ 50.606; custos diretos e rateados R$ 0; todos os percentuais em 100%.
- Margem alocada: a mesma receita/contribuição, overhead de **R$ 95.258**, resultado **-R$ 44.652**.

A contribuição já informa corretamente que não é lucro e que exclui estrutura, folha e impostos. Esse esclarecimento é positivo. Falta indicar a cobertura do cadastro de custos.

O overhead de R$ 95.258 coincide exatamente com R$ 67.558 + R$ 27.700 apresentados para agosto no relatório mensal, embora o relatório alocado se apresente como “Este mês” em setembro. **Isso é um indício para investigar competência e possível sobreposição de fontes, não prova de duplicidade.** Não é possível validar o overhead sem memória de cálculo.

**Correção:** detalhar despesas integrantes, competência, exclusões, tratamento de folha, impostos e custos já atribuídos. Exibir critério, denominador e percentual de rateio. Distinguir custo zero de custo não informado. Rateio proporcional à receita dá a mesma taxa de overhead para todos; não deve ser interpretado sozinho como eficiência relativa de cada cliente.

### P1 — Datas e filtros não deixam claro o que foi apurado

- Cabeçalho nativo do navegador: 10/09/2026 por volta de 21h. Texto do relatório: “gerado em 11/09/2026”. Indício de conversão de fuso inconsistente.
- Financeiro anual: visão “Este ano”, enquanto o seletor mostrou “Este mês: 1 a 10 de setembro”.
- Despesas: seletor de 1 a 10 de setembro, com lançamentos datados de 15 de setembro na listagem.
- Renovações: título “Este mês”, mas escopo declarado do mês atual até cinco meses à frente.
- PDFs não registram claramente todos os filtros e datas de corte.
- No teste adicional, preencher competência `2026-08` na Folha não trouxe os registros de agosto, embora existam na origem. O comportamento/formato aceito do filtro precisa de validação; não foi possível comprovar seleção histórica funcional nesse teste.

**Correção:** explicitar o campo filtrado — pagamento, vencimento, competência, assinatura, cancelamento ou posição em uma data. Usar intervalo absoluto no PDF, fuso da organização e uma única representação aplicada à tela e a todas as exportações. Reservar “mês até hoje” e “mês completo” para opções diferentes.

### P1 — Rankings genéricos não cumprem a função dos gráficos

Nos PDFs, os blocos chamados de gráfico resultam predominantemente em listas de rótulos, valores e percentuais, sem codificação visual suficientemente perceptível. Falta uma escolha de gráfico específica para cada objetivo.

- Financeiro Mensal ordena os oito maiores meses por receita, em vez de mostrar a evolução cronológica. Setembro fica fora do ranking apesar de ser o mês atual.
- Inadimplência mostra R$ 2.000 como 16%. Esse percentual corresponde aproximadamente aos oito itens destacados, não ao total de R$ 26.840: sobre o total seria **7,45%**. Sem denominador explícito, a concentração fica superestimada.
- Caixa mostra saída de R$ 27.700 com valor positivo no ranking, sem a distinção de sinal que existe na tabela.
- Receita Extra com um registro e TCV com dois registros ganham blocos extensos de ranking, com pouco valor analítico.

**Correção:** séries temporais cronológicas; composição com total e “Outros”; entradas e saídas separadas; ranking explicitamente nomeado “Top 8” e percentual sobre base identificada. Quando não houver dados suficientes, priorizar um resumo textual objetivo.

### P1 — Lacunas de cadastro ficam parecendo resultados definitivos

- 65 dos 71 clientes ativos estão sem responsável: **91,5% da carteira ativa**. Isso representa R$ 35.456, aproximadamente 79,2% do MRR.
- Nas nove despesas exportadas, categoria aparece como “—”. A promessa de análise por categoria fica limitada na origem.
- Setembro não tem folha gerada; o PDF comunica apenas “Nenhum registro com os filtros aplicados”.
- Upsell vazio aparece no Executivo como conversão 0%, sem distinguir ausência de oportunidades de desempenho efetivamente nulo.

**Correção:** avisos de cobertura, contagem de pendências e acesso à origem. Usar “Não calculável” para denominador zero e “Não informado/Não gerado” quando não há dado. Não substituir automaticamente ausência por zero.

## 2. Avaliação e especificação de cada relatório

### 01 — Financeiro Mensal · 2 páginas

**Objetivo:** entender evolução de receitas, gastos e resultado. **Entrega atual:** doze meses, seis colunas e totais; há conteúdo para acompanhamento, mas as bases não permitem interpretar o resultado com segurança.

**Completar com:** resumo do período, competência/caixa claramente separados, orçamento versus realizado, comparação com período equivalente, composição de despesas, folha sem duplicidade, receita recorrente/TCV/extra, resultado operacional e alertas de cobertura histórica. Usar gráfico cronológico de receitas e despesas e uma série de resultado. Mostrar variação em R$ e %, tratando base anterior zero. Detalhamento mensal deve reconciliar com os relatórios de origem. Não chamar essa tabela de DRE completa sem definir contas e regime.

### 02 — Clientes · 9 páginas

**Objetivo:** conhecer carteira e exposição financeira por cliente. **Entrega atual:** 120 linhas e dez colunas na tela; a exportação perde justamente parte importante do conteúdo financeiro.

**Completar com:** indicadores de ativos, pausados e perdidos, MRR, recebíveis abertos e vencidos; segmentação por modalidade, responsável e segmento; concentração dos maiores clientes; lista de cadastros sem contrato/responsável. No detalhe: código, cliente, status, modalidade, base mensal, receita reconhecida, recebido, saldo a receber, vencido e tempo de relacionamento. Separar data de cadastro de início do relacionamento; não assumir que são equivalentes. Usar resumo em retrato e anexo financeiro em paisagem.

### 03 — Inadimplência · 3 páginas

**Objetivo:** priorizar cobrança e medir risco. **Entrega atual:** valor vencido por cliente, quantidade, dias, faixa e contato. É um começo útil de relatório operacional, prejudicado por corte e ausência de consolidação por faixa.

**Completar com:** data de corte, estoque vencido, clientes/títulos, atraso médio ponderado, faixas sem sobreposição (por exemplo 1–15, 16–30, 31–60, 61–90, >90 dias), evolução e valores recuperados. Detalhe por título com vencimento, principal, pago, saldo, negociação, promessa de pagamento, último contato, próxima ação e responsável. O aging deve classificar cada título, não atribuir toda a dívida de um cliente à faixa do título mais antigo sem avisar. Não misturar perda comercial com extinção automática da dívida.

### 04 — Acordos Comerciais · 2 páginas

**Objetivo:** controlar compromissos contratuais. **Entrega atual:** seis contratos, valores, modalidade/status e datas; campos de vigência/renovação se perdem na impressão.

**Completar com:** contrato/versão, assinatura, início, fim, prazo, renovação, responsável, valor recorrente, valor total do contrato, condições de reajuste, cancelamento e situação de faturamento. Separar vigente de início futuro: há contrato ativo com início em 18/09, posterior à data do teste. “Valor total (TCV)” aparece também em linhas MRR; esclarecer que total contratual e modalidade comercial são conceitos diferentes. Resumo de vigentes, futuros, expirando e sem documento; vencimentos em 30/60/90 dias e vínculo com cobranças.

### 05 — Despesas · 2 páginas

**Objetivo:** entender em que, quando e quanto a empresa gasta. **Entrega atual:** nove despesas, R$ 85.287,53; todas sem categoria; valores das linhas cortados no PDF.

**Completar com:** total por competência, pago, a pagar e vencido; fornecedor, categoria/subcategoria, centro de custo, recorrência, competência, vencimento, pagamento, conta, documento e valor. Permitir visão por categoria e tendência, com “Sem categoria” visível. Separar operacional, investimento e financiamento; pagamento de principal de empréstimo não deve ser confundido com despesa operacional na interpretação gerencial. Detalhar juros e principal quando disponíveis. Evitar contar compras de cartão e pagamento da mesma fatura duas vezes.

### 06 — Folha de Pagamento · 1 página, vazia

**Objetivo:** demonstrar custo de equipe por competência e colaborador. **Entrega atual:** documento vazio para setembro. A origem informa “Não gerada”, informação que o PDF perde. Agosto contém nove itens e R$ 27.700 na origem, pagos em setembro.

**Completar com:** competência, status, geração/aprovação/pagamento, fixos, comissões, adicionais, descontos e demais componentes efetivamente cadastrados. Total por colaborador e função/centro de custo, comparação mensal, participação na receita com regime compatível e ponte com Contas a Pagar. Separar competência de pagamento. Não inventar encargos ou valores inexistentes; explicitar o que o sistema não controla. Corrigir/validar seleção histórica e mostrar “Folha ainda não gerada para 09/2026” em vez de uma mensagem genérica.

### 07 — Fluxo de Caixa · 2 páginas

**Objetivo:** explicar disponibilidade e necessidade de dinheiro. **Entrega atual:** 15 movimentos, saldo líquido -R$ 11.933. É um extrato parcial de movimentos, sem saldo inicial, saldo acumulado nem conciliação por conta.

**Completar com:** saldo inicial conciliado + entradas − saídas = saldo final; conta e data efetiva; ordem cronológica e saldo após cada movimento; todas as fontes, inclusive Receita Extra; transferências internas identificadas e neutras no consolidado; estornos e conciliação. Separar realizado de previsão de 30/60/90 dias. Gráfico de saldo diário e entradas/saídas com sinais claros. Sem saldo inicial, nomear “movimento líquido do período”, não disponibilidade de caixa.

### 08 — Margem de Contribuição por Cliente · 3 páginas

**Objetivo:** medir quanto cada cliente contribui antes de estrutura. **Entrega atual:** 39 clientes, receita R$ 50.606, nenhum custo atribuído e margem de 100% para todos. O texto de exclusão de folha/estrutura/impostos é uma boa base conceitual.

**Completar com:** origem da receita reconhecida e critérios de custos diretos/rateados, detalhamento de lançamentos, horas ou serviços quando registrados, cobertura de custos e comparação histórica. Ranking por contribuição absoluta e percentual, com limiar de baixa cobertura e receita zero tratada. Não atribuir falsa precisão a margens de clientes sem custos cadastrados. Mostrar custos compartilhados apenas uma vez na cadeia de cálculo.

### 09 — Margem Totalmente Alocada · 4 páginas

**Objetivo:** analisar resultado após absorção de estrutura. **Entrega atual:** receita/contribuição de R$ 50.606; overhead R$ 95.258; resultado -R$ 44.652; não há memória suficiente para validar a composição.

**Completar com:** quadro de reconciliação da contribuição ao resultado final; componentes do overhead e competência; direcionador escolhido e justificativa; denominador total antes de filtros; percentual/cota por cliente; exclusões e despesas sem alocação. Se o usuário filtrar um cliente, preservar sua cota original por padrão — não redistribuir toda a estrutura para ele silenciosamente. Cenários de rateio por receita, horas ou outro direcionador só quando houver dados. Mostrar sensibilidade e limites do método. O PDF precisa incluir o percentual final e eliminar a página órfã.

### 10 — Recebimentos do Período · 3 páginas

**Objetivo:** explicar o que entrou e a pontualidade de recebimento. **Entrega atual:** 13 pagamentos, R$ 19.100, com competência/vencimento; a impressão perde campos críticos.

**Completar com:** resumo de recebido da competência, recebido de competências anteriores, antecipado, parcial e em atraso; total por meio/conta, modalidade e responsável; quantidade de pagamentos e títulos distintos. Detalhar ID do pagamento e cobrança, data, vencimento, competência, valor bruto/líquido, taxas se cadastradas, classificação e saldo residual. Definir classificação de forma verificável e separar dimensões: um pagamento pode ser de outro mês e estar atrasado ao mesmo tempo. Gráfico diário e composição temporal; conciliar com entradas do Caixa sem duplicar pagamentos parciais.

### 11 — Receita Extra · 1 página

**Objetivo:** rastrear entradas fora do fluxo principal. **Entrega atual:** um lançamento manual de R$ 840, com cliente “—”, embora haja nome na descrição. O ranking “por cliente” é pouco útil nessa condição.

**Completar com:** natureza da entrada, vínculo real com cliente quando houver, competência, recebimento, conta, responsável pelo registro, documento e ID de origem. Diferenciar receita operacional extra de aporte, empréstimo recebido e outras entradas que não são receita operacional. Mostrar total e composição por natureza, sem gráfico ornamental para um registro. Conciliar com Caixa e com o resultado conforme a natureza; descrição livre não substitui vínculo estruturado.

### 12 — MRR / Recorrência · 3 páginas

**Objetivo:** acompanhar receita recorrente e sua evolução. **Entrega atual:** fotografia de 38 clientes, R$ 44.756 mensais, R$ 537.072 anualizados; a parte anualizada fica cortada.

**Completar com:** data-base, MRR inicial + novos + expansão + reativação − redução − cancelamento = MRR final. Distinguir status comercial, vigência contratual e inadimplência. Mostrar concentração, ticket médio e tendência; calcular retenção de receita somente com base comparável e histórico de eventos. Identificar anualizado como projeção da base atual, não receita garantida. Conciliar MRR de cadastro com contratos e explicar diferenças, inclusive início futuro, descontos e mudanças de valor.

### 13 — TCV / Contratos Fechados · 1 página

**Objetivo anunciado:** demonstrar contratos fechados. **Entrega atual declarada:** cobranças TCV do período, pelo valor cheio no mês de adesão/renovação; duas linhas, R$ 6.000 cobrados e recebidos. Cobrança não comprova, sozinha, contratação na mesma data.

**Completar com:** separar “Vendas contratadas — TCV” de “Cobranças de contratos TCV”. No primeiro, assinatura, vigência, valor total, novo/renovação e responsável; no segundo, parcelas, faturado, recebido e saldo. Usar indicadores distintos de vendido, cobrado, reconhecido e recebido. Impedir somar valor total de contrato e receita mensal como se fossem medidas equivalentes. Gráfico de vendas ao longo do tempo e cronograma financeiro, quando houver volume.

### 14 — Renovações · 1 página

**Objetivo:** antecipar retenção e receita futura. **Entrega atual:** um cliente em dezembro, valor esperado de R$ 3.000; horizonte descrito de seis meses, com rótulo genérico “Este mês”.

**Completar com:** data exata, dias até vencimento, contrato, responsável, valor atual/proposto, etapa de negociação, risco e próxima ação. Resumo por mês e 30/60/90 dias; distinguir previsto bruto de previsão ponderada por probabilidade, sem inventar probabilidades. Incluir fila de contratos/clientes sem data de renovação. Mostrar meses sem eventos com zero explícito dentro do horizonte e identificar se o universo vem de contratos ou cadastro de clientes.

### 15 — Perdas de Clientes · 1 página

**Objetivo:** entender cancelamentos e impacto. **Entrega atual:** dois eventos em 10/09, R$ 2.850, com cliente, modalidade, motivo e responsável. É uma listagem relativamente coerente, mas falta contexto.

**Completar com:** base no início do período, churn de clientes e MRR perdido, data solicitada/efetiva, motivo padronizado + comentário, tempo de relacionamento, segmento, responsável e possibilidade de recuperação. Separar estoque de 49 clientes perdidos de fluxo de duas perdas no mês. Valor mensal perdido, valor contratual remanescente e dívida vencida são medidas diferentes. Tendência e distribuição de motivos com denominadores explícitos; comparar apenas coortes/períodos equivalentes.

### 16 — Clientes por Responsável · 1 página

**Objetivo:** gerir distribuição de carteira e resultado por responsável. **Entrega atual:** cinco grupos, 71 ativos, 38 MRR, 33 TCV e 49 perdidos históricos; 65 ativos sem responsável.

**Completar com:** cobertura de atribuição antes de qualquer ranking de performance; carteira atual, MRR, receita reconhecida, vencido, renovações, perdas no período, contribuição e volume operacional quando disponível. Diferenciar dono atual da carteira do responsável no evento de venda/perda. Não penalizar quem recebeu carteira antiga ou maior. Incluir relação dos clientes por grupo e filtro temporal coerente; “perdidos total” e “perdas 3m” precisam de contexto separado.

### 17 — Upsell · 1 página, vazia

**Objetivo:** acompanhar expansão comercial da base. **Entrega atual:** nenhuma oportunidade no recorte; não foi possível validar o relatório preenchido sem criar dados.

**Completar com:** oportunidades abertas, etapas, valores, previsão, responsável, cliente, produto, próxima ação e idade; ganhos/perdas no período, incremento de MRR separado de receita pontual, ciclo de venda e conversão com denominador definido. Visual de funil e tabela acionável. Tratar “sem oportunidades” como ausência de base para conversão, não automaticamente 0% de eficiência. No desenvolvimento, testar registros sintéticos em ambiente de testes, incluindo ganho, perda, reabertura e mudança de etapa.

### 18 — Executivo da Agência · 2 páginas

**Objetivo:** orientar decisões rápidas. **Entrega atual:** tabela Grupo/Indicador/Valor com carteira, faturamento, despesas, perdas, renovações e upsell. Não oferece uma síntese gerencial visual; informa zero inadimplentes apesar do relatório específico.

**Completar com:** primeira página com seis a oito indicadores prioritários e comparações, dois gráficos e três alertas acionáveis. Separar caixa, resultado por competência e base comercial. Mostrar recebido, movimento/saldo de caixa, obrigações próximas, vencido, resultado validado, MRR e retenção. Cada indicador deve apontar para sua memória de cálculo. “Resultado bruto (fat. − desp.)” precisa ser renomeado ou recalculado conforme a classificação das despesas; o rótulo atual não demonstra uma apuração de margem bruta. Conversão sem oportunidades deve ser “Não calculável”. Anexo com definições e indicadores complementares.

## 3. Adequação à realidade atual da plataforma

A base observada combina 71 clientes ativos, modalidades MRR/TCV, histórico de perdas, recebimentos parciais, entradas manuais, pagamentos de folha em mês posterior à competência, dívidas/cartões e atribuição incompleta de responsáveis. Por isso, relatórios baseados apenas em uma tabela genérica não bastam.

Os 18 assuntos existentes são suficientes como ponto de partida. Eu priorizaria consolidá-los e preencher as seguintes necessidades, aproveitando módulos que já aparecem no menu, em vez de multiplicar relatórios desconectados:

| Necessidade | Entrega recomendada |
|---|---|
| Fechar o mês com confiança | Pacote de fechamento: resultado por competência, caixa conciliado, recebíveis, obrigações, folha, diferenças e pendências. Integrar Fechamento/Fotografia do mês existentes. |
| Saber se haverá dinheiro | Projeção de caixa 30/60/90 dias, com saldo inicial, recebimentos esperados, vencimentos e cenários identificados como projeção. |
| Entender desempenho econômico | DRE gerencial com plano de contas e ponte para origem. Integrar o módulo Resultado (DRE), sem presumir que ele já atende a essa especificação. |
| Cobrar e pagar no prazo | Recebíveis e obrigações a vencer/vencidos, aging e agenda de ações. |
| Entender crescimento/retensão | Ponte de MRR, novos clientes, expansão, redução, cancelamento e renovações. |
| Interpretar margem por cliente | Custos atribuíveis, cobertura, critérios de rateio e memória de cálculo. |
| Confiar no cadastro | Painel de qualidade: sem responsável, sem categoria, contrato ausente, datas faltantes, fonte sem conciliação e folha não gerada. |

## 4. Padrão visual e editorial proposto

### Estrutura comum, conteúdo específico

1. **Cabeçalho:** logo proporcional, organização, nome do relatório, período absoluto, regime/data-base e emissão com fuso.
2. **Resumo:** indicadores relevantes ao objetivo, com comparativo, unidade e notas de cobertura.
3. **Análise:** gráficos adequados e comentários derivados de regras verificáveis. Exemplo: “65 de 71 clientes ativos sem responsável”. Evitar explicações causais que os dados não provam.
4. **Detalhamento:** tabela completa, ordenação justificada, subtotais e total conciliável.
5. **Metodologia:** fontes, filtros, fórmulas, inclusões/exclusões, data de atualização e limitações.
6. **Rodapé:** nome abreviado, período, página X/Y e identificação/versionamento da exportação.

Em relatórios operacionais curtos, condensar tudo em uma página. Em relatórios longos, colocar a síntese na primeira página e o detalhe em anexo. A regra é ajudar a decidir, não adicionar páginas por obrigação.

### Direção de design

- A4 retrato para sínteses; paisagem para tabelas largas. Não adotar retrato universal.
- Ponto de partida de projeto: margens de 12–16 mm; corpo de 10–11 pt; tabelas preferencialmente de 9–10 pt; títulos de 18–22 pt. Validar com impressão em tamanho real, sem reduzir tudo para caber.
- Logo vetorial, proporção original, largura sugerida de 28–36 mm, sem esticar. Marca presente em cabeçalho/rodapé, sem marca d’água atrás dos números.
- Fundo branco, textos escuros, cinzas leves para agrupamento e uma cor institucional para destaques. Negativos devem manter sinal e rótulo, além de eventual cor.
- Valores alinhados à direita, separadores brasileiros, casas decimais consistentes, percentuais com base identificada. Nome/descrição com quebra de linha legível.
- Cabeçalho de tabela repetido nas páginas, total junto da tabela, linhas sem quebra quando couberem, e nenhuma página criada apenas pelo rodapé.
- Gráficos legíveis em escala de cinza, com título que diga métrica, unidade e período. Fontes/legendas não podem desaparecer ao imprimir.
- Sem barras de rolagem, URL técnica do navegador ou controles de filtro impressos. Os filtros devem virar metadados textuais.
- Nome automático: `b2c-finance_inadimplencia_posicao-2026-09-10.pdf`, por exemplo. No teste, o fluxo depende do diálogo de impressão e de nome genérico da página.

### Tela mobile e desktop

O conteúdo do PDF deve ser independente da largura da tela que iniciou a exportação. No mobile, apresentar indicadores em sequência, filtros em painel e detalhe por registro; no desktop, comparações e tabela ampla. Oferecer prévia do documento e opções “Resumo”/“Completo”, deixando claro quais dados cada uma inclui. Não transformar a largura estreita do mobile em um PDF com colunas ocultas.

### Implementação de impressão

Usar template próprio com estilos de impressão, área de página definida e regras de quebra. CSS oferece `@media print`, `@page` e `break-inside`; seu comportamento deve ser validado no motor real de geração. Não aplicar indiscriminadamente “não quebrar” a uma tabela inteira de nove páginas. Referências técnicas: [MDN — Printing](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing), [MDN — @page](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40page), [MDN — break-inside](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/break-inside).

Gráficos devem funcionar mesmo quando o navegador não imprime fundos; ajustes de cor não eliminam a necessidade de contraste, sinais e rótulos. [MDN — print-color-adjust](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/print-color-adjust).

## 5. Padronização de dados e experiência

### Contrato único de cada indicador

Cada métrica precisa de nome, finalidade, unidade, fórmula, fonte, campo de data, fuso, regime, tratamento de cancelamentos/estornos/parciais, filtros e regra de agregação. Tela, PDF, CSV e XLSX devem consumir a mesma definição, com a mesma versão dos dados.

### Controles do módulo

- Organizar catálogo em Visão gerencial; Caixa e obrigações; Carteira e receita; Comercial e retenção; Custos e equipe.
- Em cada cartão, informar a pergunta respondida, regime, frequência sugerida e última atualização.
- Separar posição em uma data, intervalo de movimentos e competência. Não mostrar controles temporais que não afetam o resultado.
- Oferecer “Aplicar”/“Limpar” e resumo dos filtros, com quantidade de registros e tratamento explícito de campos inválidos.
- Visões salvas devem preservar filtros, colunas, agrupamento e ordenação; indicar se o período é relativo ou fixo.
- Colunas essenciais não devem desaparecer silenciosamente de um relatório financeiro. Se a seleção exigir anexo/paisagem, ajustar o documento e informar na prévia.
- Agrupamento precisa recalcular subtotais corretamente. Percentuais, saldos, contagens distintas e MRR não podem ser somados indiscriminadamente.
- Estado vazio deve explicar se não há registros, se filtros excluíram tudo, se a fonte não foi gerada ou se há falha de carregamento. Nenhum erro de consulta deve se transformar em “R$ 0”.
- Adotar fotografia/versionamento de fechamento, distinguindo relatório em atualização de mês fechado. Correções posteriores precisam de nova versão e rastreabilidade.

## 6. Backlog de desenvolvimento em ordem recomendada

| Etapa | Entrega | Critério de conclusão |
|---|---|---|
| P0.1 — Integridade do PDF | Template próprio, largura, paginação e valores preservados | Todos os 18 tipos exportam todas as colunas/linhas previstas, sem cortes ou páginas de rodapé isolado. |
| P0.2 — Definições e conciliação | Dicionário de métricas e fontes compartilhadas | Executivo e relatórios específicos reconciliam sob o mesmo recorte; diferenças de regime são explicadas. |
| P0.3 — Resultado e caixa | Separar competência/caixa; integrar extra; tratar folha e duplicidades | Cada resultado fecha com sua memória de cálculo e os IDs de origem. |
| P0.4 — Margens e qualidade | Composição do overhead e cobertura de custos | Rateio auditável; ausência não aparece como margem definitiva; soma das cotas reconcilia. |
| P1.1 — Filtros e datas | Período absoluto, campo de data e fuso únicos | Tela e todos os formatos usam exatamente o mesmo recorte. |
| P1.2 — Conteúdo por objetivo | Resumo, gráfico adequado, detalhe e metodologia | Cada relatório responde à pergunta descrita no catálogo. |
| P1.3 — Identidade visual | Componentes, tipografia, cores, logo e template | Leitura clara em tela, impressão e escala de cinza, com identidade consistente. |
| P2 — Gestão contínua | Fechamento versionado, projeções, alertas, histórico de métricas | Gestão consegue acompanhar evolução e reproduzir números anteriores. |

Dependências: o rebranding pode avançar junto da definição do template, mas os novos indicadores dependem da reconciliação das fontes. Não atribuo prazos sem conhecer arquitetura, equipe e cobertura do banco.

## 7. Testes de aceite para a nova versão

### Dados e cálculos

1. Com a mesma data de corte, quantidade e saldo de inadimplentes do Executivo coincidem com a listagem detalhada.
2. Recebimentos + outras entradas efetivas reconciliam com entradas do Caixa, sem duplicar IDs. Usar o caso de R$ 840 como cenário de regressão após validar sua natureza.
3. Saldo inicial + entradas − saídas = saldo final. Transferências internas têm efeito líquido zero no consolidado.
4. Folha de agosto paga em setembro aparece uma vez no resultado de agosto e uma vez no caixa de setembro, em seus regimes, sem ser descontada duas vezes na mesma apuração.
5. Resultado mensal pode ser refeito a partir de suas parcelas; receita zero não produz percentual enganoso ou divisão inválida.
6. Total de overhead é igual à soma das despesas elegíveis; soma de alocações coincide com overhead, com ajuste documentado de arredondamento.
7. Filtrar um cliente preserva sua cota de rateio definida sobre o universo original, salvo cenário explicitamente escolhido.
8. Contrato futuro, cancelamento, reativação, pagamento parcial, estorno e renegociação têm resultados esperados documentados.
9. MRR inicial e movimentos reconciliam com MRR final. TCV contratado não é confundido com recebimento nem reconhecido integralmente sem regra definida.
10. Percentuais de ranking identificam denominador; total geral e “Outros” reconciliam. Percentual consolidado usa base ponderada apropriada.
11. Ausência de categoria/responsável/custo e folha não gerada geram avisos, sem inventar valores. Conversão sem base é não calculável.

### Exportação e interação

12. Dataset com 0, 1, 8, 9 e 120+ registros; nomes longos, acentos, valores negativos e descrições extensas. Nenhuma linha desaparece por paginação/rolagem.
13. Todas as colunas essenciais estão legíveis, inclusive a última; cabeçalhos se repetem; totais não são cortados; não há barra de rolagem ou página só com rodapé.
14. Gerar em desktop e mobile produz o mesmo conteúdo do PDF para o mesmo recorte. Conferir retrato/paisagem e impressão em tamanho real.
15. Alterar datas, competência, colunas, agrupamento e ordem reflete-se no arquivo e nos metadados. Visão salva reproduz o recorte esperado.
16. Comparar tela, PDF, CSV e XLSX: mesmos valores, registros e filtros; diferenças de apresentação não alteram cálculo.
17. Emissão próxima da meia-noite UTC mantém a data local correta. Um relatório do mês até hoje não inclui futuro sem explicação.
18. Falha de carregamento/exportação mostra erro recuperável, não documento vazio ou zerado. Botão só habilita quando o conjunto está pronto.
19. Visual em escala de cinza mantém distinção entre entradas/saídas e positivos/negativos. Gráficos mantêm eixos, unidades, legendas e rótulos.
20. Reabrir uma fotografia de mês fechado preserva a versão; atualização posterior gera versão identificável.

## Evidências entregues

- `pdfs-originais/`: 18 arquivos gerados pelo sistema, sem correção do conteúdo, 42 páginas.
- `evidencias-visuais/`: sete pranchas de conferência contendo todas as páginas, para localizar rapidamente cortes, páginas órfãs e padrões repetidos. Para ler números pequenos, abrir o PDF original.
- Este documento: diagnóstico, especificação dos 18 relatórios, padrão visual, backlog e testes de aceite.

**Decisão recomendada:** manter os assuntos do catálogo, reconstruir a camada comum de métricas/exportação e desenhar cada relatório em torno de sua decisão de negócio. O resultado esperado é um pacote que permita saber o que aconteceu, por que o número é aquele, quais dados faltam e qual ação tomar.
