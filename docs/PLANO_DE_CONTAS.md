---
rag: true
titulo: Plano de contas do B2C Finance
categoria: contabilidade
atualizado_em: 2026-09-28
dados_atuais: nao
---

# Plano de contas do B2C Finance

Este documento explica **como as contas são organizadas e o que cada uma significa**. Ele não traz saldos nem valores: saldo, resultado e totais de qualquer conta vêm sempre da API do B2C Finance.

A fonte técnica é `prisma/chart-of-accounts.ts` (contas) e `src/lib/accounting/posting-rules.ts` (regras de lançamento). Substitui a proposta antiga em `PLANO_DE_CONTAS_GERENCIAL.md`, que é só histórico.

## Natureza das contas

Cada conta tem um **tipo**, e o tipo decide o resto:

| Tipo | Saldo normal | Entra na DRE (resultado)? |
|---|---|---|
| Ativo | Devedor | Não — é patrimônio |
| Passivo | Credor | Não — é patrimônio |
| Patrimônio e sócios | Credor | Não — é patrimônio |
| Receita | Credor | Sim |
| Despesa | Devedor | Sim |

Consequências práticas:

- **Caixa, reservas, cartões, empréstimos e impostos a pagar nunca entram no resultado.** São contas de patrimônio.
- **Principal de empréstimo é passivo; só o juro é despesa.**
- **Transferências e reservas** ficam no grupo 15, fora do resultado.
- **Retiradas e despesas pessoais do dono** vão para "Distribuições e retiradas" (3.2), fora do resultado operacional.

## Grupos e contas

**1 · Ativos**
- 1.1 Caixa e bancos
- 1.2 Reservas
- 1.3 Contas a receber
- 1.4 Adiantamentos e créditos de clientes
- 1.5 Outros ativos

**2 · Passivos**
- 2.1 Contas a pagar
- 2.2 Cartões a pagar
- 2.3 Impostos a pagar
- 2.4 Folha e comissões a pagar
- 2.5 Empréstimos e parcelamentos
- 2.6 Outros passivos

**3 · Patrimônio e sócios**
- 3.1 Capital e ajustes
- 3.2 Distribuições e retiradas

**4 · Receitas operacionais**
- 4.1 MRR (mensalidade recorrente)
- 4.2 TCV (contrato de valor fechado)
- 4.3 Setup
- 4.4 Avulso (one-time)
- 4.5 Upsell
- 4.6 Recuperação — classificação **analítica**: a receita já foi reconhecida na competência original; a recuperação não a duplica.

**5 · Receitas extras**
- 5.1 Reembolso recebido
- 5.2 Ajuste positivo
- 5.3 Outras receitas extras

**6 · Custos diretos**
- 6.1 Tráfego repassado
- 6.2 Criativos e freelancers
- 6.3 Comissão comercial
- 6.4 Comissão de renovação e upsell

**7 · Folha e pessoas**
- 7.1 Salários · 7.2 Benefícios · 7.3 Encargos · 7.4 Bonificações · 7.5 Pró-labore

**8 · Ferramentas e softwares**

**9 · Marketing e vendas da agência**

**10 · Administrativas**
- 10.1 Aluguel e escritório · 10.2 Água, luz e internet · 10.3 Transporte · 10.4 Outras administrativas

**11 · Impostos e contabilidade**
- 11.1 Impostos sobre faturamento · 11.2 Honorários contábeis

**12 · Financeiras**
- 12.1 Juros · 12.2 Tarifas bancárias · 12.3 Antecipações · 12.4 Multas

**13 · Investimentos (capex gerencial)** — ativo, não despesa.

**14 · Ajustes, contra-receita e perdas**
- 14.1 Contra-receita (reembolso a cliente) · 14.2 Perda com crédito (write-off) · 14.3 Chargebacks e estornos

**15 · Transferência e controle** — fora do resultado.
- 15.1 Transferência entre contas · 15.2 Movimentação de reservas

**99 · Não classificado** — conta temporária. Lançamento sem conta definida fica aqui e aparece como pendência de classificação; o sistema nunca adivinha a conta.

## Como os fatos viram lançamentos

Regra de ouro: **reconhecer não é pagar.** Pagar uma dívida já reconhecida só move ativo e passivo; não cria despesa nova. É isso que impede empréstimo, fatura de cartão e transferência de aparecerem duas vezes no resultado.

| Fato | Débito | Crédito | Afeta o resultado? |
|---|---|---|---|
| Receita reconhecida na competência | 1.3 Contas a receber | 4.x Receita (conforme a modalidade) | Sim |
| Cliente paga | 1.1 Caixa e bancos | 1.3 Contas a receber | Não (a receita já foi reconhecida) |
| Receita extra (sem cobrança) | 1.1 Caixa e bancos | 5.3 Outras receitas extras | Sim |
| Despesa a prazo reconhecida | Conta de despesa | 2.1 Contas a pagar | Sim |
| Despesa paga à vista | Conta de despesa | 1.1 Caixa e bancos | Sim |
| Pagamento de conta já reconhecida | 2.1 Contas a pagar | 1.1 Caixa e bancos | Não |
| Compra no cartão | Conta de despesa | 2.2 Cartões a pagar | Sim (a compra é a despesa) |
| Pagamento da fatura do cartão | 2.2 Cartões a pagar | 1.1 Caixa e bancos | Não |
| Entrada de empréstimo | 1.1 Caixa e bancos | 2.5 Empréstimos | Não (não é receita) |
| Amortização do principal | 2.5 Empréstimos | 1.1 Caixa e bancos | Não |
| Juros | 12.1 Juros | 1.1 Caixa e bancos | Sim |
| Transferência entre contas ou reservas | 15.1 Transferência | 1.1 Caixa e bancos | Não |
| Imposto provisionado | 11.1 Impostos | 2.3 Impostos a pagar | Sim |
| Imposto pago | 2.3 Impostos a pagar | 1.1 Caixa e bancos | Não |
| Reembolso ao cliente | 14.1 Contra-receita | 1.1 Caixa e bancos | Sim |
| Write-off de recebível | 14.2 Perda com crédito | 1.3 Contas a receber | Sim |
| Estorno | Inverso do lançamento original | — | Anula o original |

Algumas regras da matriz só passam a ser usadas quando a funcionalidade correspondente existe na tela. A existência da regra não significa que o fato já é registrado pelo sistema.

## Categorias antigas → contas

As categorias do sistema antigo foram mapeadas assim:

| Categoria antiga | Conta |
|---|---|
| Tráfego Pago | 6.1 Tráfego repassado |
| Folha de Pagamento | 7.1 Salários |
| Ferramentas | 8 Ferramentas e softwares |
| Aluguel / Escritório | 10.1 |
| Luz/Água | 10.2 |
| Transporte | 10.3 |
| Alimentação, Empresa | 10.4 |
| Impostos | 11.1 |
| Investimentos | 13 |
| Reserva de Emergência | 15.2 |
| Dívida a Receber | 1.3 |
| Reembolsável | 1.4 |
| Terceiros | 6.2 |
| Pessoal, Família, Lazer, Carro, Cabelo/Estética | 3.2 Distribuições e retiradas (fora do resultado) |

O que não casar fica sem conta e aparece no alerta de "não classificado".

## Quem altera o plano de contas

Alterar o plano de contas (criar, renomear, desativar ou reclassificar contas) é uma ação administrativa. **O agente do WhatsApp nunca faz isso**: é uma operação bloqueada para ele.
