"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface TabsCount {
  contratos?: number;
  cobrancas?: number;
  pagamentos?: number;
  documentos?: number;
  contexto?: number;
  historico?: number;
}

// Abas da ÁREA DO CLIENTE — mesmos ids dos TabsContent de page.tsx.
const TABS = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "contratos", label: "Contratos", countKey: "contratos" },
  { id: "documentos", label: "Documentos", countKey: "documentos" },
  { id: "cobrancas", label: "Cobranças", countKey: "cobrancas" },
  { id: "pagamentos", label: "Pagamentos", countKey: "pagamentos" },
  { id: "servicos", label: "Serviços" },
  { id: "historico", label: "Histórico", countKey: "historico" },
  { id: "contexto", label: "Contexto", countKey: "contexto" },
] as const;

// Aliases de links antigos (?tab=recebimentos etc.) — mantêm a aba certa ativa.
const ALIAS: Record<string, string> = {
  "dados-principais": "visao-geral",
  "dados-fiscais": "visao-geral",
  recebimentos: "cobrancas",
  notas: "contexto",
};

export function TabsNavigation({
  clientId,
  counts = {},
}: {
  clientId: string;
  counts?: TabsCount;
}) {
  const searchParams = useSearchParams();
  const raw = searchParams.get("tab") || "visao-geral";
  const activeTab = TABS.some((t) => t.id === raw) ? raw : ALIAS[raw] ?? "visao-geral";

  return (
    <Tabs value={activeTab} asChild>
      <div className="overflow-x-auto pb-1 mb-4">
        <TabsList>
          {TABS.map((tab) => {
            const count =
              "countKey" in tab && tab.countKey
                ? counts[tab.countKey as keyof TabsCount]
                : undefined;
            return (
              <TabsTrigger key={tab.id} value={tab.id} asChild>
                <Link href={`/clientes/${clientId}?tab=${tab.id}`}>
                  {tab.label}
                  {count != null && count > 0 && (
                    <span className="ml-1.5 text-xs opacity-75">({count})</span>
                  )}
                </Link>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
    </Tabs>
  );
}
