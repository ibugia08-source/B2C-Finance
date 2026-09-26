/**
 * STATUS DE CLIENTE — a definição de "quem fatura" (fonte única).
 *
 * É a constante mais sensível do produto: entra no MRR, no ciclo de
 * cobrança, nos relatórios e no Painel Anual. Antes desta fonte única ela
 * estava copiada em 8 arquivos — bastava um lado ganhar um status novo
 * para o MRR do Dashboard divergir do relatório.
 */

/** Gera receita no mês corrente (cobrança nova nasce para estes). */
export const REVENUE_ACTIVE_STATUSES = ["ACTIVE", "RENEWAL", "DELINQUENT"] as const;

/** Carteira "viva" para renovação: os acima + pausados (voltam a faturar). */
export const PORTFOLIO_ACTIVE_STATUSES = [...REVENUE_ACTIVE_STATUSES, "PAUSED"] as const;

export type RevenueActiveStatus = (typeof REVENUE_ACTIVE_STATUSES)[number];

/** O status gera receita (entra na base do MRR, nas cobranças do mês)? */
export function isRevenueActiveStatus(status: string | null | undefined): boolean {
  return !!status && (REVENUE_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/*
 * "O cliente fatura no mês X?" deixou de morar aqui (26/09/2026). Antes era
 * `clientActiveInMonth`: datas de entrada/saída para o passado e o status de
 * HOJE para o mês corrente e futuros — o que fazia uma mudança de status em
 * outubro reescrever setembro. A resposta agora vem da linha do tempo de
 * status: `getActiveClientsByCompetences` (src/lib/clients/status-history.ts).
 */
