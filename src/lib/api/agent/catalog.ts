import type { WriteOperationKey } from "../activity-meta";

/**
 * CLASSIFICAÇÃO DE RISCO DAS AÇÕES DO AGENTE (28/09/2026) — fonte única,
 * sem dependência de servidor (o teste do n8n compara o workflow com isto).
 * docs/N8N_AGENT_WRITE_ACTIONS.md.
 *
 *  · READ               — consulta: o agente executa direto (ferramentas GET).
 *  · WRITE_CONFIRMATION — escrita: o agente só PROPÕE; a API monta o preview a
 *                         partir do estado atual, guarda a PendingAction e só
 *                         executa com a confirmação do próprio usuário.
 *  · BLOCKED            — nunca pelo agente. A API recusa mesmo que o pedido
 *                         chegue (403 operation_blocked).
 */

export type RiscoDoAgente = "READ" | "WRITE_CONFIRMATION" | "BLOCKED";

/** Tipo de entidade que a operação altera (define o `targetId`). */
export type AlvoDaOperacao = "client" | "receivable" | "expense" | "upsell" | "routine_action";

export type OperacaoDeEscrita = {
  risk: "WRITE_CONFIRMATION";
  /** Nome da ferramenta no workflow do n8n. */
  tool: string;
  /** Scope da rota de escrita (a mesma que executa). */
  scope: string;
  method: "POST" | "PATCH";
  /** Caminho da rota em /api/v1 ({id} = targetId). */
  path: string;
  /** null = cria; senão, o tipo do `targetId` exigido. */
  target: AlvoDaOperacao | null;
  /** Pergunta final do preview ("Deseja registrar?"). */
  pergunta: string;
  /** Resposta depois de executar ("Pagamento registrado"). */
  feito: string;
};

export const OPERACOES_DE_ESCRITA = {
  "clients.create": {
    risk: "WRITE_CONFIRMATION", tool: "cadastrar_cliente", scope: "clients.create",
    method: "POST", path: "/clients", target: null,
    pergunta: "Deseja cadastrar?", feito: "Cliente cadastrado",
  },
  "clients.update": {
    risk: "WRITE_CONFIRMATION", tool: "editar_cliente", scope: "clients.update",
    method: "PATCH", path: "/clients/{id}", target: "client",
    pergunta: "Deseja salvar as alterações?", feito: "Cliente atualizado",
  },
  "client_status.change": {
    risk: "WRITE_CONFIRMATION", tool: "alterar_status_cliente", scope: "client_status.write",
    method: "POST", path: "/clients/{id}/status-changes", target: "client",
    pergunta: "Deseja alterar o status?", feito: "Status alterado",
  },
  "payments.register": {
    risk: "WRITE_CONFIRMATION", tool: "registrar_pagamento", scope: "receivables.register_payment",
    method: "POST", path: "/receivables/{id}/payments", target: "receivable",
    pergunta: "Deseja registrar?", feito: "Pagamento registrado",
  },
  "expenses.create": {
    risk: "WRITE_CONFIRMATION", tool: "criar_despesa", scope: "expenses.create",
    method: "POST", path: "/expenses", target: null,
    pergunta: "Deseja lançar a despesa?", feito: "Despesa lançada",
  },
  "expenses.update": {
    risk: "WRITE_CONFIRMATION", tool: "editar_despesa", scope: "expenses.update",
    method: "PATCH", path: "/expenses/{id}", target: "expense",
    pergunta: "Deseja salvar as alterações?", feito: "Despesa atualizada",
  },
  "expenses.pay": {
    risk: "WRITE_CONFIRMATION", tool: "marcar_despesa_paga", scope: "expenses.pay",
    method: "POST", path: "/expenses/{id}/pay", target: "expense",
    pergunta: "Deseja marcar como paga?", feito: "Despesa marcada como paga",
  },
  "upsells.create": {
    risk: "WRITE_CONFIRMATION", tool: "criar_upsell", scope: "upsells.create",
    method: "POST", path: "/upsells", target: null,
    pergunta: "Deseja cadastrar a oportunidade?", feito: "Oportunidade cadastrada",
  },
  "upsells.update": {
    risk: "WRITE_CONFIRMATION", tool: "atualizar_upsell", scope: "upsells.update",
    method: "PATCH", path: "/upsells/{id}", target: "upsell",
    pergunta: "Deseja salvar as alterações?", feito: "Oportunidade atualizada",
  },
  "routine.complete": {
    risk: "WRITE_CONFIRMATION", tool: "concluir_acao_rotina", scope: "routine.write",
    method: "POST", path: "/routine/actions/{id}/complete", target: "routine_action",
    pergunta: "Deseja marcar como concluída?", feito: "Ação da rotina concluída",
  },
} as const satisfies Record<WriteOperationKey, OperacaoDeEscrita>;

export type OperacaoDoAgente = keyof typeof OPERACOES_DE_ESCRITA;

/**
 * BLOQUEADAS: o agente nunca executa (nem com confirmação). Não existe rota
 * pública para nenhuma delas; ficam listadas para a API responder com clareza
 * e para o prompt e o teste terem a mesma lista.
 */
export const OPERACOES_BLOQUEADAS = {
  "clients.delete": "excluir cliente",
  "receivables.delete": "excluir recebimento",
  "payments.delete": "excluir pagamento",
  "expenses.delete": "excluir despesa",
  "competences.reopen": "reabrir competência",
  "permissions.manage": "alterar permissões",
  "users.manage": "gerenciar usuário",
  "chart_of_accounts.manage": "alterar plano de contas",
} as const;

export type OperacaoBloqueada = keyof typeof OPERACOES_BLOQUEADAS;

/** Ferramentas de consulta do agente (schemas/agent-tools.json). */
export const FERRAMENTAS_DE_LEITURA = [
  "buscar_clientes", "consultar_cliente", "consultar_status_cliente", "consultar_dashboard",
  "consultar_recebimentos", "consultar_despesas", "consultar_caixa", "consultar_upsells",
  "consultar_rotina", "gerar_relatorio_diario", "gerar_relatorio_mensal",
] as const;

/** Risco de uma operação (chave da API) ou ferramenta (nome no n8n). null = desconhecida. */
export function classificarRisco(nome: string): RiscoDoAgente | null {
  if (nome in OPERACOES_BLOQUEADAS) return "BLOCKED";
  if (nome in OPERACOES_DE_ESCRITA) return "WRITE_CONFIRMATION";
  if (Object.values(OPERACOES_DE_ESCRITA).some((o) => o.tool === nome)) return "WRITE_CONFIRMATION";
  if ((FERRAMENTAS_DE_LEITURA as readonly string[]).includes(nome)) return "READ";
  return null;
}

export const ehOperacaoDoAgente = (op: string): op is OperacaoDoAgente => op in OPERACOES_DE_ESCRITA;
export const ehOperacaoBloqueada = (op: string): op is OperacaoBloqueada => op in OPERACOES_BLOQUEADAS;

/** Validade padrão de uma ação pendente (minutos). B2C_PENDING_ACTION_TTL_MINUTES ajusta (1 a 60). */
export const TTL_PADRAO_MINUTOS = 10;
/**
 * Limite por usuário (por minuto) nas rotas do agente: propor e decidir.
 * Folgado para o uso normal (uma pessoa não confirma 30 ações por minuto),
 * curto o bastante para cortar laço de automação ou abuso.
 */
export const LIMITE_POR_USUARIO = {
  propor: { max: 20, janelaSegundos: 60 },
  decidir: { max: 30, janelaSegundos: 60 },
} as const;

/** Códigos errados antes de a ação ser cancelada. */
export const MAX_TENTATIVAS_DE_CODIGO = 5;

/**
 * Idempotency-Key da execução: a mensagem/update que confirmou + id da ação.
 *  · WHATSAPP → `wa:<id da mensagem>:<ação>` (o id da Meta, "wamid.HBg…=",
 *    pode ter caracteres fora do formato aceito — viram "_");
 *  · TELEGRAM → `telegram:<update_id do callback>:<ação>`.
 * O mesmo update reenviado gera a MESMA chave (replay, sem duplicar); outro
 * toque é outro update — e aí quem barra é o status da ação (já executada).
 */
export function chaveDaConfirmacao(messageId: string, actionId: string, canal: "WHATSAPP" | "TELEGRAM" = "WHATSAPP"): string {
  const prefixo = canal === "TELEGRAM" ? "telegram" : "wa";
  return `${prefixo}:${messageId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200)}:${actionId}`;
}
