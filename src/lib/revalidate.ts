import { revalidatePath, revalidateTag } from "next/cache";
import { CACHE_TAGS } from "./cache-tags";
import { bustBillingCycleThrottle } from "./services/receivables-cycle";

/**
 * Invalidação de cache por DOMÍNIO — fonte única.
 *
 * Antes, cada server action listava seus revalidatePath na mão (206
 * chamadas espalhadas), e esquecer um caminho gerava telas defasadas
 * (ver commits "fix: cache invalidation sync"). Aqui cada mutação chama
 * UM helper do seu domínio, que revalida o superconjunto de rotas e tags
 * afetadas. Revalidar uma rota a mais é barato; esquecer uma é bug.
 */

function paths(ps: readonly string[]) {
  for (const p of ps) revalidatePath(p);
}

/** Métricas agregadas que praticamente toda mutação financeira afeta. */
function metricsTags() {
  revalidateTag(CACHE_TAGS.DASHBOARD);
  revalidateTag(CACHE_TAGS.DASHBOARD_METRICS);
  revalidateTag(CACHE_TAGS.REVENUE_METRICS);
}

/**
 * Finanças (transações, cartões/faturas, caixinhas, pessoas/recebíveis,
 * importações, regras de categorização).
 */
export function revalidateFinance(
  opts: { cardId?: string | null; personId?: string | null } = {}
) {
  paths([
    "/",
    "/dashboard",
    "/rotina",
    "/transacoes",
    "/cartoes",
    "/despesas",
    "/receitas",
    "/caixa",
    "/pessoas",
    "/pagamentos",
    "/projecoes",
    "/importacoes",
    "/regras",
  ]);
  if (opts.cardId) revalidatePath(`/cartoes/${opts.cardId}`);
  if (opts.personId) revalidatePath(`/pessoas/${opts.personId}`);
  metricsTags();
}

/**
 * ERP da agência (clientes, contratos, cobranças, pagamentos,
 * inadimplência, acordos, rotina).
 */
export function revalidateAgency(
  opts: { clientId?: string | null; contractId?: string | null } = {}
) {
  paths([
    "/",
    "/dashboard",
    "/rotina",
    "/clientes",
    "/contratos",
    "/cobrancas",
    "/inadimplencia",
    "/acordos",
    "/pagamentos",
  ]);
  if (opts.clientId) {
    revalidatePath(`/clientes/${opts.clientId}`);
    revalidateTag(CACHE_TAGS.CLIENT_ID(opts.clientId));
    revalidateTag(CACHE_TAGS.CLIENT_BILLINGS(opts.clientId));
  }
  if (opts.contractId) revalidatePath(`/contratos/${opts.contractId}`);
  // Garante que cliente MRR recém-cadastrado gere a mensalidade na próxima
  // carga de /cobrancas, sem esperar o throttle de 1h do ensureMonthlyBillings.
  bustBillingCycleThrottle();
  revalidateTag(CACHE_TAGS.CLIENTS);
  revalidateTag(CACHE_TAGS.BILLINGS);
  revalidateTag(CACHE_TAGS.BILLING_CYCLE);
  revalidateTag(CACHE_TAGS.CONTRACTS);
  metricsTags();
}

/** Catálogo comercial (serviços, ofertas, upsells). */
export function revalidateCatalog() {
  paths(["/dashboard", "/servicos", "/ofertas", "/upsell", "/clientes"]);
  metricsTags();
}

/** Folha e comissões. */
export function revalidatePayroll() {
  paths(["/dashboard", "/folha", "/rotina"]);
  metricsTags();
}

/** Administração (usuários, configurações). */
export function revalidateAdmin() {
  paths(["/usuarios", "/configuracoes"]);
}

/** Assistente de IA. */
export function revalidateAssistant() {
  paths(["/assistente"]);
}
