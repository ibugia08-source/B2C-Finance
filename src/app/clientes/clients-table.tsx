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
