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
  // Competência selecionada no módulo (?mes=) — o ajuste de inadimplência
  // é gravado NESTE mês/ano (histórico por competência).
  refMonth: number;
  refYear: number;
};

export function ClientsTable({
  clients,
  allFilteredIds,
  canDelete,
}: {
  clients: ClientRow[];
  allFilteredIds: string[];
  canDelete: boolean;
}) {
  return (
    <ClientsPanel
      clients={clients}
      allFilteredIds={allFilteredIds}
      canDelete={canDelete}
    />
  );
}
