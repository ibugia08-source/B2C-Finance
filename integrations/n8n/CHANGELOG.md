# Changelog — integrações n8n

Formato: data · arquivo · mudança. Mudança **incompatível** da API gera `vN+1` do workflow, que convive com o anterior até a troca.

## 2026-09-28

- `schemas/agent-tools.json` **1.0.0**: 11 ferramentas **somente leitura** (buscar_clientes, consultar_cliente, consultar_status_cliente, consultar_dashboard, consultar_recebimentos, consultar_despesas, consultar_caixa, consultar_upsells, consultar_rotina, gerar_relatorio_diario, gerar_relatorio_mensal).
- `workflows/agente-whatsapp.consulta.v1.json`: webhook do WhatsApp (Meta) com validação de assinatura, lista de números autorizados, AI Agent com as 11 ferramentas, memória por número e resposta no WhatsApp. Sem escrita.
- `workflows/sistema.teste-conexao.v1.json`: `/health`, `/me` e conferência dos scopes.
