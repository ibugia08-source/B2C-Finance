"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CLIENT_TABS as TABS, resolveClientTab } from "./tabs-meta";

export interface TabsCount {
  contratos?: number;
  cobrancas?: number;
  pagamentos?: number;
  documentos?: number;
  contexto?: number;
  historico?: number;
  /** Tarefas de onboarding PENDENTES — o número que interessa é o que falta. */
  onboarding?: number;
}

export function TabsNavigation({
  clientId,
  counts = {},
}: {
  clientId: string;
  counts?: TabsCount;
}) {
  const searchParams = useSearchParams();
  const activeTab = resolveClientTab(searchParams.get("tab"));

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
