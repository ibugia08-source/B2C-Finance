# Changelog — integrações n8n

Formato: data · arquivo · mudança. Mudança **incompatível** da API gera `vN+1` do workflow, que convive com o anterior até a troca.

## 2026-09-28 (2)

- `workflows/b2c-finance-ai-agent-readonly.json` **substitui** `agente-whatsapp.consulta.v1.json`. O fluxo completo é:
  1. webhook;
  2. assinatura (Meta);
  3. normalizar payload;
  4. identificar número e descartar repetidas;
  5. resolver usuário e permissões (diretório `B2C_WHATSAPP_USERS` + perfis);
  6. agente, com contexto do usuário, data e ferramentas liberadas;
  7. interpretar resposta;
  8. responder no WhatsApp.

  Além do fluxo: notas explicativas, e cada ferramenta travada pelo perfil também na URL.
- `schemas/user-profiles.json` **1.0.0**: perfis `admin`, `financeiro`, `comercial` e `leitura`.
- `examples/system-prompt.md`: novas regras.
  - A API é a única fonte.
  - Não inventar dados nem ids.
  - Buscar antes de usar id.
  - Perguntar na ambiguidade (caso "Alpha").
  - Somente leitura; respeitar 403.
- `ENV.example`: `WHATSAPP_ALLOWED_NUMBERS` → `B2C_WHATSAPP_USERS` (número → nome e perfil).
- Credenciais com placeholders distintos (`CONFIGURAR_B2C_FINANCE_API`, `CONFIGURAR_WHATSAPP_API`, `CONFIGURAR_OPENAI`).
- `scripts/validate-with-n8n.cjs`: valida os nós contra uma instalação real do n8n.

## 2026-09-28

- `schemas/agent-tools.json` **1.0.0**: 11 ferramentas **somente leitura** (buscar_clientes, consultar_cliente, consultar_status_cliente, consultar_dashboard, consultar_recebimentos, consultar_despesas, consultar_caixa, consultar_upsells, consultar_rotina, gerar_relatorio_diario, gerar_relatorio_mensal).
- `workflows/agente-whatsapp.consulta.v1.json`: webhook do WhatsApp (Meta) com validação de assinatura, lista de números autorizados, AI Agent com as 11 ferramentas, memória por número e resposta no WhatsApp. Sem escrita.
- `workflows/sistema.teste-conexao.v1.json`: `/health`, `/me` e conferência dos scopes.
