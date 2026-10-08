# Mapa de funções do B2C Finance Bot (08/10/2026)

Fonte: catálogo de leitura (`integrations/n8n/schemas/agent-tools.json`), catálogo de escrita (`agent-write-tools.json`), scopes da API (`src/lib/api/scopes.ts`), permissões da interface (`src/lib/permissions.ts`) e plano da API (`docs/API_IMPLEMENTATION_PLAN.md`). A existência de um botão na interface não significa que o agente já tenha uma rota segura ou que a credencial n8n possua o scope.

## Disponível no código do agente completo

- Consultas: clientes, status/histórico, dashboard, cobranças/recebimentos, inadimplência, despesas, caixa, upsells, rotina, relatórios diário e mensal, base de conhecimento.
- Escritas com prévia e confirmação: cliente (criar/editar/status), pagamento, despesa (criar/editar/pagar), upsell (criar/editar), conclusão de ação da rotina.
- **Nova ação:** remover **uma cobrança não paga** do ciclo de um mês. Exige ID da cobrança, motivo, competência aberta, scope específico `receivables.remove_from_month` e permissão humana `recebimentos.excluir`. Mantém cliente, contrato e histórico; recusa pagamento confirmado, parcial, quitada, renegociada e já removida. Nunca é exclusão física nem remoção em massa.

## Ainda indisponível ao bot

| Área | Pedido que continua sem execução | O que falta para liberar com segurança |
|---|---|---|
| Cobranças (`recebimentos.*`) | Gerar/editar cobrança, alterar vencimento, restaurar uma cancelada, remover várias, renegociar, gerar mensagem | Uma rota por operação, validação de competência e contrato, prévia do impacto e testes de concorrência. A nova remoção é **apenas individual e sem pagamento**. |
| Pagamentos e créditos (`recebimentos.*`, `creditos.*`) | Estornar, apagar ou desfazer liquidação; ver/aplicar/ajustar/estornar crédito | Motor de estorno com reflexos em caixa, crédito, receita e auditoria; confirmação própria. Não confundir com remover cobrança não paga. |
| Clientes e contratos (`clientes.*`, `contratos.*`) | Excluir cliente; criar/editar/renovar/encerrar/excluir contrato, gerar/baixar documento, anexar arquivos; operações em massa | Rotas de domínio e efeitos dependentes, escolha do alvo e testes de integridade. Exclusão profunda continua bloqueada. |
| Despesas e receita extra (`despesas.*`, `receitas.*`) | Excluir despesa, encerrar série recorrente, operar despesa de cartão; consultar/criar/editar/excluir receita extra | Rotas próprias, tratamento de recorrência/cartão e guarda de competência. |
| Comercial (`upsell.*`, `servicos.*`, `ofertas.*`, `termos.*`) | Marcar upsell como vendido/perdido, excluir oportunidade; criar/editar serviços e ofertas; ver/abrir novo termo de preço | Fluxo completo do funil e efeitos em contrato/cobrança, com confirmação. |
| Cobrança ativa e onboarding (`rotina.*`, `onboarding.*`) | Registrar contato/promessa, disparar mensagem, gerar link de pagamento, concluir onboarding | Rotas e confirmação de destinatário/conteúdo; envio real é ação externa separada. |
| Operação financeira (`caixa.*`, `folha.*`, `projecoes.*`) | Criar/editar contas bancárias e transferências, folha/comissões, consultar projeções fora dos relatórios atuais | APIs com RBAC, prévia e reconciliação; dados de folha exigem concessão explícita. |
| Contabilidade e fiscal (`contabil.*`, `fechamento.*`, `fiscal.*`, `motor.*`) | Consultar/lançar/exportar razão e DRE; fechar/reabrir competência e fotografar; registrar/cancelar nota; alterar regras contábeis e métricas | Fluxos contábeis próprios, revisão do impacto e validação em banco isolado. Reabrir competência e alterar o motor continuam bloqueados no catálogo atual. |
| Gestão e administração (`avaliacao.*`, `organizacao.*`, `regras.*`, `importacoes.*`, `integracoes.*`, `usuarios.*`, `configuracoes.*`, `auditoria.*`) | Avaliações mensais, entidades/agências, regras de categoria, importações, chaves/API, usuários/permissões, configurações e consulta da trilha de auditoria | Uma API e política por área. Gestão de usuários, permissões e chaves fica fora da conta de serviço do bot até desenho explícito de governança; nenhum prompt sozinho concede esses poderes. |

## Sequência de liberação

1. Para cada ação, identificar um único objeto e distinguir escrita, estorno e exclusão. Nunca inferir o alvo quando houver duas cobranças do mesmo cliente/mês.
2. Implementar rota com scope mínimo, RBAC, guarda de período, idempotência, auditoria e teste em banco isolado.
3. Adicionar prévia determinística e confirmação vinculada ao usuário, com estado revalidado na execução.
4. Gerar workflow desativado, validar em n8n e só então trocar o webhook, preservando o fallback. A credencial atual não adquire scopes novos automaticamente: é necessária uma integração de escrita nova com o scope específico.

Este mapa registra cobertura técnica, não autoriza sozinho publicar nem ampliar a credencial existente.
