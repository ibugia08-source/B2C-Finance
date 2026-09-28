/**
 * CATÁLOGO DE AÇÕES DA API (28/09/2026) — sem dependência de servidor (a
 * tela de Atividades importa daqui). Cada rota declara a ação em
 * `defineEndpoint({ action })`; as de ESCRITA declaram também a operação de
 * idempotência. docs/API_AUDIT_IDEMPOTENCY.md.
 */

export type WriteOperation = {
  /** Scope que a rota de escrita vai exigir. */
  scope: string;
  label: string;
  entityType: string;
};

/**
 * Escritas previstas (casos prioritários). A infraestrutura — Idempotency-Key
 * obrigatória, replay, trilha — já vale para elas; as rotas públicas entram
 * na fase de escrita, cada uma apontando para uma operação daqui.
 */
export const API_WRITE_OPERATIONS = {
  "payments.register": { scope: "receivables.register_payment", label: "Pagamento registrado", entityType: "Billing" },
  "clients.create": { scope: "clients.create", label: "Cliente cadastrado", entityType: "Client" },
  "expenses.create": { scope: "expenses.create", label: "Despesa lançada", entityType: "Transaction" },
  "expenses.pay": { scope: "expenses.pay", label: "Despesa marcada como paga", entityType: "Transaction" },
  "upsells.create": { scope: "upsells.create", label: "Upsell cadastrado", entityType: "Upsell" },
  "client_status.change": { scope: "client_status.write", label: "Status do cliente alterado", entityType: "Client" },
  "clients.update": { scope: "clients.update", label: "Cliente atualizado", entityType: "Client" },
  "expenses.update": { scope: "expenses.update", label: "Despesa atualizada", entityType: "Transaction" },
  "upsells.update": { scope: "upsells.update", label: "Upsell atualizado", entityType: "Upsell" },
  "routine.complete": { scope: "routine.write", label: "Ação da rotina concluída", entityType: "RoutineAction" },
} as const satisfies Record<string, WriteOperation>;

export type WriteOperationKey = keyof typeof API_WRITE_OPERATIONS;

export const API_READ_ACTIONS: Record<string, string> = {
  me: "Conferiu a credencial",
  "identities.resolve": "Identificou quem fala (WhatsApp)",
  "agent_actions.propose": "Agente propôs uma ação (aguarda confirmação)",
  "agent_actions.list": "Consultou ações pendentes do agente",
  "agent_actions.confirm": "Usuário confirmou ação do agente",
  "agent_actions.cancel": "Usuário cancelou ação do agente",
  health: "Verificou a API",
  search: "Buscou clientes",
  "dashboard.summary": "Consultou indicadores",
  "clients.list": "Consultou clientes",
  "clients.get": "Consultou cliente",
  "clients.status_history": "Consultou histórico de status",
  "receivables.list": "Consultou recebimentos",
  "receivables.get": "Consultou recebimento",
  "expenses.list": "Consultou despesas",
  "expenses.get": "Consultou despesa",
  "cash.summary": "Consultou o caixa",
  "upsells.list": "Consultou upsells",
  "upsells.get": "Consultou upsell",
  "routine.daily": "Consultou a rotina do dia",
  "reports.daily": "Gerou relatório do dia",
  "reports.monthly": "Gerou relatório do mês",
};

export function actionLabel(action: string): string {
  return (API_WRITE_OPERATIONS as Record<string, WriteOperation>)[action]?.label ?? API_READ_ACTIONS[action] ?? action;
}

export const SOURCE_LABEL: Record<string, string> = {
  WEB: "Web",
  API: "API",
  N8N: "n8n",
  WHATSAPP: "WhatsApp",
  SYSTEM: "Sistema",
};

export const RESULT_LABEL: Record<string, string> = {
  SUCCESS: "Sucesso",
  ERROR: "Erro",
  DENIED: "Negado",
  REPLAYED: "Repetição (idempotente)",
};

/** Retenção (dias). Leitura é volumosa e vale pouco depois; escrita é fato. */
export const RETENCAO_DIAS = { READ: 30, WRITE: 400 } as const;
export const IDEMPOTENCY_TTL_DIAS = 30;
