O banco é a fonte de verdade, e o schema carrega regra — não só estrutura.
Esta seção explica as convenções que valem para todas as tabelas; a lista
completa vem logo abaixo.

## Convenções de todas as tabelas

| Convenção | Regra | Por quê |
|---|---|---|
| Dinheiro | `Decimal(14,2)`, nunca `Float` | ponto flutuante perde centavo em soma longa, e isso vira divergência de conciliação |
| Taxas | `Decimal(9,6)` | margem e percentual precisam de casas que o dinheiro não tem |
| Tempo | `Timestamptz`, sempre UTC | exibição usa o fuso do workspace; guardar em fuso local torna o dado dependente de onde o servidor roda |
| Competência | coluna explícita `YYYY-MM` | jamais derivada de `createdAt`: uma cobrança lançada em outubro pode ser de setembro |
| Isolamento | `ownerId` / `workspaceId` em todo modelo privado | injetado automaticamente pela extensão do Prisma, com falha fechada |
| Identidade | referência por ID, nunca por nome | nome muda; vínculo por texto vira dado órfão |

## Data civil × instante de evento

O sistema guarda dois tipos de data no mesmo tipo `DateTime`, e confundir os
dois causa erro de um dia:

- **Data civil** — vencimento, renovação, competência, início de contrato. É um
  dia do calendário, sem hora, ancorado em **meia-noite UTC**. Formatar no fuso
  do leitor volta um dia.
- **Instante de evento** — criação, geração, marcação. É um momento no tempo, e
  o fuso do workspace é o certo para ele.

Na dúvida entre as duas, a pergunta é: *se eu mudar de fuso, esse dia muda?*
Vencimento não muda. Horário de gravação muda.

Isso não é teórico: até 11/09/2026 a mesma renovação aparecia como 29/09 na
ficha do cliente e 30/09 no contrato, porque os componentes de servidor
rodavam em UTC e os de navegador no fuso de São Paulo.

## O que não são sinônimos

Um vocabulário preciso é o que impede dois números de carregarem o mesmo nome:

| Termo | O que é |
|---|---|
| **Cobrança** (`Billing`) | o direito de receber, por competência |
| **Pagamento** (`Payment`) | o evento de caixa |
| **Aplicação** (`PaymentApplication`) | a parcela de um pagamento aplicada a uma cobrança — é N:N |
| **Receita extra** | fato manual, sem cobrança a cliente |
| **Razão** (`Ledger`) | a dupla entrada que os fatos geram |
| **Fatura de cartão** | passivo agrupador, não despesa nova |

## Estados do período

| Estado | O que permite | Na interface |
|---|---|---|
| `OPEN` | operação normal | Aberto |
| `SOFT_CLOSED` | mutações comuns bloqueadas; pendências autorizadas seguem | Em fechamento |
| `CLOSED` | fotografia congelada; posting econômico bloqueado | Fechado |
| `REOPENED` | exige papel autorizado, justificativa e aprovação | Reaberto |

Reabrir agosto depois de setembro e outubro fechados preserva a versão 1 de
agosto, cria a versão 2 e marca os meses seguintes como
`NEEDS_REVALIDATION` — nunca os apaga.
