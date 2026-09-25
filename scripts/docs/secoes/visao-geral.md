O B2C Finance é o ERP financeiro, contábil, comercial e de carteira da agência
**B2C Gestão** e das agências irmãs. Ele foi construído no modelo da planilha
mensal que o dono já usava, e essa origem explica a forma do produto: a tela
âncora é a **Gestão do Mês**, que é a aba do mês da planilha, e o **Painel
Anual** é o indicador × JAN–DEZ com meta e simulador.

A entrega operacional dos clientes não vive aqui — ela fica no AvanceCRM.
Este sistema cuida do dinheiro, do contrato e da carteira. A prospecção
também não: o funil comercial (Funil, Leads, Atividade do dia, Painel do
closer, Métricas e Metas comerciais) foi removido em 24/09/2026 e todo
cliente nasce direto na Carteira. Os dados antigos do funil continuam no
banco, sem tela.

Os espaços de trabalho são Hoje, Clientes, Financeiro, Comercial
(upsell, renovações, contratos, serviços e planos), **Relatórios** — espaço
próprio desde 24/09/2026 — e Sistema.

## O fluxo que o sistema modela

```
Cliente → Contrato → Cobrança (competência) → Pagamento → Caixa → Razão → DRE
Despesa · Folha · Comissão · Cartões                                    → Resultado
```

Tudo por agência, tudo por competência, tudo fotografável no fechamento.

## As cinco ideias que organizam o resto

**1. Competência e caixa coexistem.** O DRE lê competência — o mês a que o
resultado pertence. O fluxo de caixa lê caixa — o dia em que o dinheiro se
moveu. Os dois estão certos e quase nunca dão o mesmo número. Toda métrica
declara qual das duas bases usa, e é isso que resolve a maior parte das
discussões sobre "qual é o faturamento de verdade".

**2. Reconhecimento não é pagamento.** Uma cobrança é um direito de receber;
um pagamento é um evento de caixa. Pagar uma dívida já reconhecida não cria
despesa nova — move um passivo. Confundir os dois dobra o resultado.

**3. Status é derivado, nunca gravado.** "Vencido" não é um campo: é o que a
data de vencimento e o valor pago dizem hoje. Gravar o status cria a
possibilidade de ele discordar dos fatos que o geraram.

**4. Correção deixa rastro.** A interface oferece *Desfazer* por 15 minutos,
mas nada é apagado no razão: um lançamento postado é revertido por um evento
compensatório. O histórico é somente-acréscimo.

**5. Métrica é contrato versionado.** Cada número tem fórmula, fontes, grão e
base temporal registrados. Quando a fórmula muda, nasce uma versão nova e a
antiga fica — é o que permite ao passado continuar reportando a fórmula que
usou. O capítulo 4 é esse contrato, por extenso.

## Quatro camadas de tempo

O sistema guarda o tempo em quatro camadas que convivem sem se sobrescrever:

| Camada | O que é | Para que serve |
|---|---|---|
| Estado operacional | as tabelas vivas | o que é verdade agora |
| Razão (ledger) | fatos postados, com competência e caixa | a contabilidade |
| Trilha de auditoria | quem fez o quê, quando | a responsabilidade |
| Fotografia (snapshot) | o que era verdade no fechamento | o histórico imutável |

É por isso que "no fechamento de agosto o cliente X estava vencido" e "hoje
essa dívida foi paga em setembro" podem ser as duas verdadeiras ao mesmo
tempo. Um pagamento posterior a um período fechado **não** altera a
fotografia: ele cria um pagamento no mês do caixa e aplica ao direito
histórico.
