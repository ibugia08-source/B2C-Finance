---
rag: true
titulo: Políticas e regras operacionais do B2C Finance
categoria: politicas
atualizado_em: 2026-09-28
dados_atuais: nao
---

# Políticas e regras operacionais do B2C Finance

Regras que o **próprio sistema aplica**: a tela, a API e o agente seguem as mesmas. Servem para explicar por que algo foi recusado e qual é o caminho certo.

Este documento não traz dados. Qual competência está fechada, quanto um cliente deve ou se uma despesa foi paga, consulte na API.

> **O que não está aqui não é política definida.** Descontos, multa e juros por atraso, prazos de cobrança da agência e condições comerciais **não** estão definidos no B2C Finance. Se perguntarem, diga que isso não está registrado no sistema e que quem decide é o responsável da agência. Não invente uma regra.

## 1. Competência (fechamento do mês)

- **Estados de uma competência:** Aberto, Em fechamento, Fechado ou Reaberto.
- **Fechado congela o resultado do mês.** Não se lança nem se altera nada que mude o resultado daquela competência: receita, despesa reconhecida, ajuste de cobrança, status de cliente naquele mês.
- **Pagamento de cobrança antiga com o mês fechado:** registra-se no mês em que o dinheiro entrou. A cobrança antiga é quitada do mesmo jeito; a fotografia do mês fechado continua como fechou.
- **Em fechamento:** só as pendências do próprio fechamento podem ser lançadas.
- **Reabrir uma competência** exige justificativa e é feito na tela, por quem tem permissão. **Nunca pelo agente.**
- **Tarefas operacionais** (avaliação de cliente, onboarding, contato de cobrança) não dependem do fechamento.

## 2. Status do cliente

- **O status tem vigência:** vale a partir de uma data, e o histórico fica preservado. Veja `STATUS_TEMPORAL_CLIENTES.md`.
- **Mudança a partir de hoje** vale na hora. **Data futura** fica programada e é aplicada automaticamente no dia.
- **Data num mês que já passou** (retroativa) reescreve a carteira daquele mês. Só com confirmação explícita, e só se a competência não estiver fechada.
- **Status nunca muda por edição de cadastro:** é sempre uma mudança de status com data.
- **Perda (churn)** registra a data de saída e, quando é renovação frustrada, o mês da renovação.

## 3. Pagamentos de clientes

- **A data do pagamento não pode ser futura.** Sem data, vale hoje.
- **Valor acima do saldo em aberto** só com decisão explícita. O excedente vira crédito do cliente.
- **Pagamento igual** (mesmo valor, mesma data, mesma cobrança) é tratado como possível duplicidade e recusado, salvo confirmação.
- **Cobrança removida do mês** (cancelada) não recebe pagamento.
- **Cobrança renegociada** recebe o pagamento nas parcelas do acordo.
- **Cobrança já quitada** não recebe novo pagamento.
- **Pagamento em mês posterior ao da cobrança** entra como recuperação no mês do caixa (ver `REGRAS_MRR_TCV.md`).

## 4. Situação das cobranças

| Situação | Significado |
|---|---|
| A vencer | Ainda não venceu. |
| Pago | Pago até o vencimento. |
| Pago com atraso | Pago depois do vencimento, dentro do mês. |
| Recebido em outro mês | Pago em mês posterior ao da competência. |
| Vencido | Passou do vencimento sem pagamento. É **automático**. |
| Inadimplente | **Marcação manual** da equipe de cobrança, que pode acontecer até antes do vencimento. |
| Parcial | Parte paga, parte em aberto. |
| Removido do mês | Cobrança cancelada naquela competência. |

As datas seguem o calendário da Bahia (America/Bahia). O que vence hoje só fica vencido amanhã.

## 5. Despesas (contas a pagar)

- **Toda despesa nasce a pagar.** Marcar como paga é um gesto próprio, que passa pela regra de fechamento.
- **Edição pelo agente** só vale para despesa em aberto, e só naquela ocorrência (não reescreve a série da recorrência). Despesa paga ou cancelada se ajusta na tela.
- **Despesa de cartão de crédito** (fatura) é tratada na tela, não pelo agente.
- **A compra no cartão é a despesa;** pagar a fatura não gera despesa nova.

## 6. Upsell

- **O funil tem as etapas** Oportunidade, Negociação, Pausada, Vendido e Recusado.
- **Vender** lança uma cobrança na competência escolhida, e **desfazer** a venda cancela essa cobrança. Por isso **marcar como vendido ou recusado é feito na tela**, nunca pelo agente.
- **Oportunidade já decidida** não é editada pelo agente.

## 7. Receita extra

- **Receita extra é sempre lançada à mão,** por quem tem permissão. O sistema nunca cria receita extra automaticamente.

## 8. Cadastro de clientes

- **Nome ou documento (CNPJ/CPF) igual a um cliente existente** gera aviso de duplicidade. Cadastrar mesmo assim é decisão explícita.
- **MRR exige** valor mensal e dia de pagamento. **TCV exige** valor total, prazo e data de entrada (ver `REGRAS_MRR_TCV.md`).

## 9. O que nunca é feito pelo agente do WhatsApp

- **Excluir** cliente, recebimento, pagamento ou despesa.
- **Reabrir competência.**
- **Alterar permissões** ou **gerenciar usuários.**
- **Alterar o plano de contas.**
- **Qualquer escrita sem a confirmação** do próprio usuário (`SIM <código>`).

Essas ações são feitas no B2C Finance, por quem tem a permissão, com o próprio login.

## 10. Permissões por papel

Cada pessoa tem um papel, com permissões padrão que o administrador pode ajustar por pessoa. As permissões de **quem está falando** são sempre verificadas pelo B2C Finance em cada pedido, e o agente não as altera.

| Papel | Em resumo |
|---|---|
| Administrador | Acesso total a todos os módulos e configurações. |
| Gestor | Acesso amplo de operação, sem exclusões nem gestão de usuários. |
| Financeiro | Recebimentos, despesas, caixa (ver) e relatórios. |
| Administrativo | Cadastro de clientes, acompanhamento e rotina diária. |
| Comercial | Clientes, contratos, upsell e catálogo de serviços. |
| Cobrança / Atendimento | Cobrança do dia a dia: recebimentos, mensagens e rotina. |
| Closer | Clientes, contratos, upsell e catálogo. Não vê financeiro nem folha. |
| SDR | Painel e rotina do dia, sem valores. |
| Suporte / Automação | Onboarding e rotina operacional do cliente. Não vê valores. |
| Contador | Só leitura do contábil e dos relatórios, para exportação. Não opera nada. |
| Leitura | Só olha: dashboard e carteira, sem nenhum valor sensível. |

## 11. Privacidade

- **O WhatsApp só atende números vinculados** a um usuário ativo pelo administrador (Configurações → Integrações → WhatsApp).
- **Documentos (CNPJ/CPF) aparecem mascarados.** Não se repassam dados de um cliente a quem não perguntou por ele.
- **Nenhuma mensagem mostra** token, chave, senha, id interno ou detalhe técnico de erro.
