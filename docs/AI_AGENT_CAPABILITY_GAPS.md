# Mapa de funções do B2C Finance Bot (08/10/2026)

Fonte: catálogo de leitura (`integrations/n8n/schemas/agent-tools.json`), catálogo de escrita (`agent-write-tools.json`), scopes da API (`src/lib/api/scopes.ts`), permissões da interface (`src/lib/permissions.ts`) e plano da API (`docs/API_IMPLEMENTATION_PLAN.md`). A existência de um botão na interface não significa que o agente já tenha uma rota segura ou que a credencial n8n possua o scope.

## Disponível no código do agente completo

- Consultas: clientes, status/histórico, dashboard, cobranças/recebimentos, inadimplência, despesas, caixa, upsells, rotina, relatórios diário e mensal, base de conhecimento.
- Escritas com prévia e confirmação: cliente (criar/editar/status), pagamento, despesa (criar/editar/pagar), upsell (criar/editar), conclusão de ação da rotina.
- **Nova ação:** remover **uma cobrança não paga** do ciclo de um mês. Exige ID da cobrança, motivo, competência aberta, scope específico `receivables.remove_from_month` e permissão humana `recebimentos.excluir`. Mantém cliente, contrato e histórico; recusa pagamento confirmado, parcial, quitada, renegociada e já removida. Nunca é exclusão física nem remoção em massa.

## Ainda indisponível ao bot

| Área | Pedido que continua sem execução | O que falta para liberar com segurança |
|---|---|---|
| Cobranças | Criar/editar cobrança, mudar vencimento, restaurar cobrança, remover várias, renegociar | Rota específica por caso, validação de competência/contrato, prévia que indique impacto e testes de concorrência. |
| Pagamentos | Estornar, apagar ou desfazer liquidação; aplicar crédito | Motor de estorno e reflexos em caixa, crédito, receita e auditoria; confirmação própria. Não confundir com remover cobrança não paga. |
| Clientes/contratos | Excluir cliente; renovar/encerrar contrato; operações em massa; contatos, documentos e notas | Rotas de domínio e efeitos dependentes, escolha do alvo e testes de integridade. Exclusão profunda continua bloqueada. |
| Despesas/receitas | Excluir despesa, encerrar série recorrente, despesa de cartão, receita extra | Rotas próprias, tratamento de recorrência/cartão e guarda de competência. |
| Comercial | Marcar upsell como vendido/perdido, excluir oportunidade | Fluxo completo do funil e efeitos em contrato/cobrança, com confirmação. |
| Cobrança ativa | Registrar contato/promessa, disparar mensagem, gerar link de pagamento | Rotas e confirmação de destinatário/conteúdo; envio real é ação externa separada. |
| Financeiro/contabilidade | Fechar/reabrir competência, folha, contas/transferências, plano de contas | Permissões e fluxos contábeis próprios, revisão de impacto e reconciliação. Reabertura continua bloqueada. |
| Administração | Usuários/permissões, chaves/API, integrações, importações, limpeza de dados | Mantidas fora da conta de serviço do bot; requerem governança de acesso e operação na interface. |

## Sequência de liberação

1. Para cada ação, identificar um único objeto e distinguir escrita, estorno e exclusão. Nunca inferir o alvo quando houver duas cobranças do mesmo cliente/mês.
2. Implementar rota com scope mínimo, RBAC, guarda de período, idempotência, auditoria e teste em banco isolado.
3. Adicionar prévia determinística e confirmação vinculada ao usuário, com estado revalidado na execução.
4. Gerar workflow desativado, validar em n8n e só então trocar o webhook, preservando o fallback. A credencial atual não adquire scopes novos automaticamente: é necessária uma integração de escrita nova com o scope específico.

Este mapa registra cobertura técnica, não autoriza sozinho publicar nem ampliar a credencial existente.
