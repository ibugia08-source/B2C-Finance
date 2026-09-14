Este é o capítulo que resolve a pergunta mais comum sobre o sistema: *por que
esta tela mostra um valor e aquela mostra outro?*

Quase sempre a resposta é que são **métricas diferentes com nomes parecidos**,
e as duas estão certas. "Faturamento total" e "Faturamento esperado" não são o
mesmo número: o primeiro é o que a competência reconhece como receita; o
segundo é o que a Gestão do Mês espera receber. Somar coisas diferentes dá
resultados diferentes — o defeito não é a divergência, é a interface não
explicar a divergência.

## O contrato de cada métrica

Toda métrica registra:

| Campo | O que declara |
|---|---|
| **Fórmula** | como o número é somado, em português |
| **Base temporal** | competência, caixa, estado atual ou fotografia |
| **Grão** | competência, período livre, momento ou cliente |
| **Origem** | de quais tabelas o número sai |
| **Inclui / exclui** | o que entra e, principalmente, o que fica de fora |
| **Arredondamento** | política determinística, sem sobra |
| **Política de nulo** | o que fazer quando não dá para calcular |
| **Versão** | e até quando a versão anterior valeu |

Na interface, esse contrato fica a um clique: o ícone de informação ao lado de
cada indicador abre a composição, lida do registro.

## As quatro bases temporais

| Base | Significa | Pergunta que responde |
|---|---|---|
| `COMPETENCE` | o mês a que o resultado pertence | "quanto setembro rendeu?" |
| `CASH` | o dia em que o dinheiro se moveu | "quanto entrou em setembro?" |
| `CURRENT_STATE` | o que vale agora | "quanto tem em caixa hoje?" |
| `SNAPSHOT` | o valor congelado no fechamento | "o que era verdade quando fechamos?" |

Uma cobrança de setembro paga em outubro entra na competência de setembro e no
caixa de outubro. Os dois números estão certos e são diferentes.

## Zero real e dado ausente

Zero é uma medida. "Não disponível" não é.

Quando o razão está desligado, a folha não foi gerada ou não há conta
cadastrada, o sistema **não** mostra `R$ 0,00`: mostra o estado, com a causa e
a próxima ação. Zero numa tela financeira lê como "está tudo certo, não há
nada a pagar", que é o oposto do que costuma estar acontecendo.

## Período parcial

"Este mês" e "este ano" incluem dias que ainda não aconteceram. Comparar
setembro em curso com agosto inteiro faz o mês parecer pior do que está. Por
isso o período em andamento se declara: o rótulo vira *"Este ano · parcial até
11/09"*, e período fechado não recebe ressalva.
