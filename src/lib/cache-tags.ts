/**
 * Cache Tags para Data Revalidation (Next.js)
 *
 * Define tags de cache para `revalidateTag()` com TTL implícito.
 * Uso em server actions:
 *   revalidateTag(CACHE_TAGS.CLIENTS);
 *   revalidateTag(CACHE_TAGS.CLIENT_ID(id));
 *
 * TTL sugerido: 5 min (default) a 1 hora (métricas agregadas)
 */

export const CACHE_TAGS = {
  // Clients
  CLIENTS: "cache:clients",
  CLIENT_ID: (id: string) => `cache:client:${id}`,
  CLIENT_CONTRACTS: (id: string) => `cache:client:${id}:contracts`,
  CLIENT_BILLINGS: (id: string) => `cache:client:${id}:billings`,

  // Billing Cycle (Recebimentos)
  BILLING_CYCLE: "cache:billing-cycle",
  BILLING_CYCLE_MONTH: (month: number, year: number) =>
    `cache:billing-cycle:${year}-${String(month).padStart(2, "0")}`,
  BILLINGS: "cache:billings",

  // Contracts (Carteira)
  CONTRACTS: "cache:contracts",
  CONTRACT_ID: (id: string) => `cache:contract:${id}`,

  // Delinquencies
  DELINQUENCIES: "cache:delinquencies",
  DELINQUENCIES_MONTH: (month: number, year: number) =>
    `cache:delinquencies:${year}-${String(month).padStart(2, "0")}`,

  // Dashboard & Metrics
  DASHBOARD: "cache:dashboard",
  DASHBOARD_METRICS: (month: number, year: number) =>
    `cache:dashboard:${year}-${String(month).padStart(2, "0")}`,
  EXECUTIVE_SUMMARY: (month: number, year: number) =>
    `cache:executive:${year}-${String(month).padStart(2, "0")}`,

  // Relatórios
  REPORTS: "cache:reports",
  REPORT_CLIENTS: "cache:report:clients",
  REPORT_CARTEIRA: "cache:report:carteira",
  REPORT_DELINQUENCIES: "cache:report:delinquencies",

  // Rotina & IA
  ROUTINE: "cache:routine",
  AI_SUGGESTIONS: "cache:ai:suggestions",

  // Global invalidation
  ALL: "cache:*",
} as const;

/**
 * Returns a set of tags to invalidate for client updates.
 * Use in server actions with revalidateTag().
 */
export function getClientUpdateTags(clientId: string) {
  return [
    CACHE_TAGS.CLIENT_ID(clientId),
    CACHE_TAGS.CLIENTS,
    CACHE_TAGS.CLIENT_BILLINGS(clientId),
    CACHE_TAGS.BILLING_CYCLE,
    CACHE_TAGS.DASHBOARD,
    CACHE_TAGS.CONTRACTS,
  ];
}

/**
 * Returns a set of tags to invalidate for billing updates.
 * Use in server actions with revalidateTag().
 */
export function getBillingUpdateTags(clientId?: string) {
  const tags = [
    CACHE_TAGS.BILLINGS,
    CACHE_TAGS.BILLING_CYCLE,
    CACHE_TAGS.DASHBOARD,
  ];
  if (clientId) {
    tags.push(CACHE_TAGS.CLIENT_BILLINGS(clientId));
    tags.push(CACHE_TAGS.CLIENT_ID(clientId));
  }
  return tags;
}
