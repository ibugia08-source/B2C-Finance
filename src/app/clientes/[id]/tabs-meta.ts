/**
 * Abas da ÁREA DO CLIENTE — fonte única para a barra (tabs-navigation, client)
 * e para o conteúdo (page.tsx, server). Sem "use client" e sem imports de
 * servidor: usável dos dois lados.
 */

export const CLIENT_TABS = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "contratos", label: "Contratos", countKey: "contratos" },
  { id: "documentos", label: "Documentos", countKey: "documentos" },
  { id: "cobrancas", label: "Cobranças", countKey: "cobrancas" },
  { id: "pagamentos", label: "Pagamentos", countKey: "pagamentos" },
  { id: "servicos", label: "Serviços" },
  { id: "termos", label: "Preço e termos" },
  { id: "onboarding", label: "Onboarding", countKey: "onboarding" },
  { id: "historico", label: "Histórico", countKey: "historico" },
  { id: "linha-do-tempo", label: "Linha do tempo" },
  { id: "contexto", label: "Contexto", countKey: "contexto" },
] as const;

// Aliases de links antigos (?tab=recebimentos etc.) — mantêm a aba certa ativa.
export const CLIENT_TAB_ALIAS: Record<string, string> = {
  "dados-principais": "visao-geral",
  "dados-fiscais": "visao-geral",
  recebimentos: "cobrancas",
  notas: "contexto",
};

/** Resolve o ?tab= da URL para uma aba válida (com aliases antigos). */
export function resolveClientTab(raw: string | null | undefined): string {
  const tab = raw || "visao-geral";
  return CLIENT_TABS.some((t) => t.id === tab)
    ? tab
    : CLIENT_TAB_ALIAS[tab] ?? "visao-geral";
}
