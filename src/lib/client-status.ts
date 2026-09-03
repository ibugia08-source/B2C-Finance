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

/**
 * Cliente MRR fatura no mês (year, month 1-12)?
 * A regra que define a BASE DO MRR — Dashboard mensal e série anual usam
 * esta função; antes eram duas cópias que podiam divergir.
 */
export function clientActiveInMonth(
  c: { startedAt: Date | null; createdAt: Date; churnedAt: Date | null; status: string },
  year: number,
  month: number,
  now: Date = new Date()
): boolean {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const entered = c.startedAt ?? c.createdAt;
  if (entered && entered >= monthEnd) return false; // ainda não era cliente
  if (c.churnedAt && c.churnedAt < monthStart) return false; // já tinha saído
  // Mês corrente/futuro: o status atual manda (Pausado/Perdido não faturam).
  const key = year * 12 + (month - 1);
  const currentKey = now.getFullYear() * 12 + now.getMonth();
  if (key >= currentKey && !(REVENUE_ACTIVE_STATUSES as readonly string[]).includes(c.status))
    return false;
  return true;
}
