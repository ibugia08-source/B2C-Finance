---
rag: true
titulo: Regras de MRR, TCV, faturamento e renovação
categoria: regras-de-receita
atualizado_em: 2026-09-28
dados_atuais: nao
---

# Regras de MRR, TCV, faturamento e renovação

Este documento explica **como o B2C Finance classifica e conta a receita**. Não traz números: MRR atual, faturamento do mês, clientes ativos e renovações do mês vêm sempre da API (`consultar_dashboard`, `consultar_cliente`, `gerar_relatorio_mensal`).

## Modalidades de cliente

Todo cliente com contrato tem uma de duas modalidades.

### MRR — receita recorrente mensal

- **Cadastro exige** o valor mensal (maior que zero) e o dia de pagamento (1 a 31). Em meses mais curtos, o dia vira o último dia do mês.
- **Prazo** em meses ou **indeterminado**. O indeterminado vale só para MRR.
- **Cobrança:** uma mensalidade por mês, a partir da data de entrada, vencendo no dia de pagamento. Pelo prazo do contrato ou, se indeterminado, em aberto.
- **MRR de um mês** = soma das mensalidades dos clientes MRR que geram receita **no encerramento daquela competência**: Ativo, Em renovação e Inadimplente.
  - No mês em curso vale o status de hoje.
  - Nos meses futuros vale a projeção, com as alterações de status já programadas.
  - O MRR previsto não depende de a cobrança existir: é calculado pelo cadastro.
- **Limitação conhecida:** o valor usado nos meses passados ainda é a mensalidade **atual** do cliente. Um reajuste muda o MRR histórico daquele cliente.

### TCV — contrato de valor fechado

- **Cadastro exige** o valor total do contrato (maior que zero), o prazo em meses e a data de entrada ou fechamento. TCV não aceita prazo indeterminado.
- **Cobrança:** uma única cobrança com o valor **cheio**, no mês da entrada, vencendo no dia da entrada.
- **Nunca é rateado** pelos meses do contrato, e **nunca** aparece como recorrência mensal.
- **TCV de um mês** = soma das cobranças TCV daquela competência.

## Outros tipos de receita

| Tipo | O que é |
|---|---|
| Setup | Implantação cobrada à parte. |
| Avulso (one-time) | Serviço pontual. Upsell vendido gera uma cobrança avulsa na competência escolhida. |
| Upsell | Venda adicional a um cliente existente. Enquanto está no funil (oportunidade, negociação, pausada) é só previsão; só vira receita quando vendido, com a cobrança lançada. |
| Receita extra | **Somente manual.** Entrada sem cobrança a cliente (reembolso recebido, ajuste, outra entrada). O sistema nunca cria receita extra sozinho. |
| Recuperação | Pagamento, em outro mês, de uma cobrança de mês anterior. É uma classificação **analítica**, não uma receita nova. |

## Como os totais do mês se formam

- **Faturamento total** = MRR + TCV da competência + receita extra manual do mês.
- **Recebido** = pagamentos que casam com a competência (pagos no mês) + adiantamentos + receita extra manual.
  - **Adiantamento** (pagar antes do mês da cobrança) conta no mês em que foi pago.
- **Em aberto** = faturamento total − recebido. Nunca é negativo: se o adiantamento fizer o recebido passar do previsto, o em aberto fica zero.
- **Vencido** é a parte do em aberto cujo vencimento já passou.
- **Resultado do mês** = recebido − despesas do mês.
- **Margem operacional** = resultado ÷ recebido. É zero se nada foi recebido.
- **Pagamento atrasado de mês anterior** conta como recuperação no mês em que o dinheiro entrou. A competência original continua mostrando o valor em aberto no fechamento, porque foi assim que ela fechou.

## Carteira do mês

- **Clientes ativos no mês:** clientes com status que gera receita no encerramento da competência, pela linha do tempo de status (ver `STATUS_TEMPORAL_CLIENTES.md`).
- **Novos no mês:** data de entrada no mês. Reativação não é cliente novo.
- **Perdidos no mês (churn):** perdas registradas no mês, com a data da saída. Não é "quem hoje está Perdido".
- **Ticket médio:** faturamento total ÷ clientes ativos.
- **% Recorrência:** MRR ÷ faturamento total.

## Renovação

- **Data de expectativa de renovação** = data de entrada + prazo do contrato, recalculada a cada ciclo. É a fonte única de "quando renova".
- **Agendamento manual** de uma renovação substitui o cálculo. Editar o cadastro só recalcula se a entrada ou o prazo mudarem.
- **MRR com prazo indeterminado** não tem expectativa automática. Só entra em Renovações se for agendado à mão, e segue ativo até ser dado como perdido.
- **O desfecho conta no mês da expectativa,** com o valor esperado congelado naquele momento. O desfecho é renovou, não renovou ou pendente.
- **"Renovações esperadas"** soma MRR + TCV.
- **"Faturamento total esperado"** = faturamento total + renovações esperadas **só de TCV**, para não contar a mensalidade MRR duas vezes.

## Para responder bem

- **"Qual é o MRR?"** → consulte a API (`consultar_dashboard`). Este documento só explica o que o número significa.
- **"Por que o TCV de março está tão alto?"** → o TCV entra cheio no mês da entrada, sem rateio. Confira na API quais cobranças TCV existem naquela competência.
- **"O cliente pagou em outubro a mensalidade de agosto; agosto melhora?"** → não. O dinheiro conta em outubro como recuperação, e agosto continua com o valor em aberto no fechamento.
