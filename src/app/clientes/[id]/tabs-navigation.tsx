"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface TabsCount {
  contratos?: number;
  recebimentos?: number;
  pagamentos?: number;
  documentos?: number;
  notas?: number;
  historico?: number;
}

const TABS = [
  { id: "dados-principais", label: "Dados Principais" },
  { id: "contratos", label: "Contratos", countKey: "contratos" },
  { id: "recebimentos", label: "Recebimentos", countKey: "recebimentos" },
  { id: "pagamentos", label: "Pagamentos", countKey: "pagamentos" },
  { id: "documentos", label: "Documentos", countKey: "documentos" },
  { id: "notas", label: "Notas", countKey: "notas" },
  { id: "dados-fiscais", label: "Dados Fiscais" },
  { id: "historico", label: "Histórico", countKey: "historico" },
];

export function TabsNavigation({
  clientId,
  counts = {},
}: {
  clientId: string;
  counts?: TabsCount;
}) {
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "dados-principais";

  return (
    <Tabs value={activeTab} asChild>
      <div className="overflow-x-auto pb-1">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} asChild>
              <Link href={`/clientes/${clientId}?tab=${tab.id}`}>
                {tab.label}
                {tab.countKey && counts[tab.countKey as keyof TabsCount]! > 0 && (
                  <span className="ml-1.5 text-xs opacity-75">
                    ({counts[tab.countKey as keyof TabsCount]})
                  </span>
                )}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}
