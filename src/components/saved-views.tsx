import { listViews } from "@/lib/actions/saved-views";
import { SavedViewsBar } from "./saved-views-bar";

/**
 * Visões salvas de um módulo — wrapper server: busca as visões visíveis
 * e renderiza a barra client. Uso: <SavedViews module="cobrancas" />.
 * As visões guardam a querystring atual, então funcionam com os filtros
 * (searchParams) que cada módulo já possui.
 */
export async function SavedViews({ module }: { module: string }) {
  const views = await listViews(module);
  return <SavedViewsBar module={module} views={views} />;
}
