"use client";
import { ClientsPanel } from "./clients-panel";
import type { DelinquencyValue } from "./_meta";

export type ClientRow = {
  id: string;
  name: string;
  segment: string | null;
  status: string;
  modality: string | null;
  salesOwner: string | null;
  renewalMonth: number | null;
  // ===== Financeiro na linha (Fase A) =====
  monthlyValue: number | null; // mensal (MRR)
  totalContractValue: number | null; // total do contrato (TCV)
  refValue: number | null; // valor de referência exibido (MRR=mensal, TCV=total)
  paymentDay: number | null; // dia recorrente (MRR)
  contractMonths: number | null; // prazo do contrato
  dueDay: number | null; // dia de vencimento no mês corrente (MRR)
  monthsActive: number | null; // meses ativo na base
  delinquency: {
    value: DelinquencyValue | "SEM_COBRANCA";
    manual: boolean;
    by: string | null;
  };
};

export function ClientsTable({
  clients,
  allFilteredIds,
}: {
  clients: ClientRow[];
  allFilteredIds: string[];
}) {
  return (
    <ClientsPanel
      clients={clients}
      allFilteredIds={allFilteredIds}
    />
  );
}
