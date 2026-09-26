"use client";
import { ClientsPanel } from "./clients-panel";
import type { DelinquencyValue } from "./_meta";

export type ClientRow = {
  id: string;
  name: string;
  segment: string | null;
  /** Status NA COMPETÊNCIA em exibição (linha do tempo). Nulo = sem registro. */
  status: string | null;
  /** Próxima alteração programada (depois de hoje). */
  scheduled: { status: string; from: string } | null;
  modality: string | null;
  salesOwner: string | null;
  /** Expectativa de renovação, "YYYY-MM" (null = sem expectativa). */
  renewalCompetence: string | null;
  /** Prazo indeterminado: sem expectativa automática (só agendada). */
  contractIndefinite: boolean;
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
  // ===== Colunas estilo planilha (F5) =====
  services: string[]; // serviços ativos (via contratos)
  risk: { level: string; label: string } | null; // risco de inadimplência
  notes: string | null; // observação livre (Client.notes)
};

/** Competência em exibição + "hoje" do servidor, para o diálogo de status. */
export type StatusContext = { competence: string; today: string };

export function ClientsTable({
  clients,
  allFilteredIds,
  canDelete,
  statusContext,
}: {
  clients: ClientRow[];
  allFilteredIds: string[];
  canDelete: boolean;
  statusContext: StatusContext;
}) {
  return (
    <ClientsPanel
      clients={clients}
      allFilteredIds={allFilteredIds}
      canDelete={canDelete}
      statusContext={statusContext}
    />
  );
}
