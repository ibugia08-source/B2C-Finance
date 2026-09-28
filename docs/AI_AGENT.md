---
rag: true
titulo: O Agente B2C Finance (WhatsApp)
categoria: agente
atualizado_em: 2026-09-28
dados_atuais: nao
---

# O Agente B2C Finance

O agente é o assistente financeiro da agência no **WhatsApp**. Ele responde perguntas sobre clientes, recebimentos, despesas, caixa, upsell, rotina e relatórios, e **prepara** ações de escrita que só acontecem com a confirmação de quem pediu.

## De onde vem cada resposta

O agente usa **duas fontes, com papéis diferentes**:

| Fonte | Para quê | Exemplos |
|---|---|---|
| **API do B2C Finance** (ferramentas de consulta) | **Dados atuais e verdade operacional.** É a única fonte de números, nomes, datas e situações. | Saldo e caixa, MRR do mês, clientes ativos hoje, recebimentos, despesas, status de um cliente, inadimplência, rotina do dia |
| **Base de conhecimento** (documentação indexada) | **Conceitos, regras e procedimentos.** Nunca traz número atual. | O que é MRR e TCV, como se calcula o resultado, o que significa "Vencido" × "Inadimplente", por que um mês fechado recusa lançamento, o que é cada conta do plano de contas |

Uma pergunta pode precisar das duas. Em "o MRR caiu?", o número vem da API e a explicação do que entra no MRR vem da base de conhecimento. Se a base de conhecimento citar um valor, ele é só exemplo e nunca deve ser usado como dado.

## Quem pode usar

- **Só números de WhatsApp vinculados** a um usuário ativo, pelo administrador, em Configurações → Integrações → WhatsApp. Número não vinculado recebe uma resposta genérica, sem dado nenhum.
- **O agente age com as permissões dessa pessoa** no B2C Finance. Quem não vê recebimentos no sistema também não vê pelo WhatsApp.
- **Usuários restritos a uma agência** ainda não são atendidos pelo WhatsApp.
- **O agente entende só mensagens de texto.**

## O que ele faz

**Consulta direto (READ):**
- buscar cliente pelo nome ou documento;
- detalhe e histórico de status do cliente;
- indicadores do mês (dashboard);
- recebimentos, despesas e caixa;
- oportunidades de upsell;
- rotina do dia;
- relatórios do dia e do mês.

**Prepara e pede confirmação (WRITE_CONFIRMATION):**
- **Clientes:** cadastrar, editar dados cadastrais, alterar status com data de vigência.
- **Recebimentos:** registrar pagamento recebido.
- **Despesas:** lançar, editar (em aberto), marcar como paga.
- **Upsell:** cadastrar e atualizar oportunidade em aberto.
- **Rotina:** concluir ação da rotina de hoje.

**Nunca faz (BLOCKED):**
- excluir cliente, recebimento, pagamento ou despesa;
- reabrir competência;
- alterar permissões ou gerenciar usuários;
- alterar o plano de contas.

## Como funciona uma ação de escrita

1. **A pessoa pede** (ex.: "registra o pagamento da Face Love").
2. **O agente identifica o cliente e a cobrança pela API.** Se houver dúvida (dois clientes parecidos, duas cobranças em aberto), ele pergunta.
3. **O B2C Finance monta uma prévia** com a situação atual:

   ```
   Encontrei:
   *Face Love Distribuidora*
   Recebimento em aberto: R$ 1.500,00
   Competência: Setembro/2026
   Data de pagamento: hoje
   Deseja registrar?
   Responda *SIM 4821* para confirmar ou *NÃO* para cancelar.
   ```

4. **A pessoa responde `SIM` seguido do código** da prévia. Um "sim" solto não confirma nada. `NÃO` cancela.
5. **O B2C Finance confere** se a confirmação é daquela ação, da mesma pessoa, dentro da validade (10 minutos) e com os dados iguais aos da prévia.
6. **Executa e responde com o resultado real** (ex.: "✅ Pagamento registrado — Face Love (R$ 1.500,00)"), ou explica por que não executou.

**Cada pessoa tem uma ação aguardando confirmação por vez.** Um pedido novo substitui o anterior. Se alguém alterar o registro no sistema entre a prévia e o SIM, nada é executado e é preciso pedir de novo.

Toda ação fica registrada em **Configurações → Integrações → Atividades da IA/API**, com o nome de quem confirmou.

## Respostas típicas

- **Sem permissão:** "Seu perfil não tem permissão para isso."
- **Não encontrou:** o agente diz que não encontrou e pede outro nome ou parte do CNPJ. Ele não adivinha.
- **Problema técnico:** "Tive um problema técnico agora; tente de novo em instantes." O agente não mostra detalhes técnicos.
- **Pergunta sobre regra que não está no sistema** (desconto, multa por atraso): o agente diz que isso não está registrado no B2C Finance.

## Limites conhecidos

- **A confirmação não passa pela IA.** Se a pessoa perguntar logo depois "registrou?", o agente consulta a API para responder.
- **Valores e situações sempre de novo:** o agente não guarda números de uma conversa para outra; consulta a API a cada pergunta.
