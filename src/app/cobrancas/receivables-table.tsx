"use client";
import type { BillingMessageInput } from "@/lib/billing-message";
import { ReceivablesPanel } from "./receivables-panel";

/**
 * Lista mensal de Recebimentos — uma linha por cliente ativo do mês.
 * Colunas editáveis inline sincronizam com o cadastro na Gestão de Carteira
 * (modalidade, vencimento recorrente, valor, prazo); o Status é do
 * recebimento do mês. Apenas 3 ações por linha: Registrar pagamento,
 * Gerar texto de cobrança e Alterar data de cobrança do mês.
 */

export type ReceivableRow = {
  key: string;
  clientId: string;
  billingId: string | null;
  name: string;
  phone: string | null;
  modality: string | null;
  paymentDay: number | null;
  contractMonths: number | null;
  amountDue: number;
  openAmount: number;
  description: string | null;
  cycleStatus: string;
  statusLabel: string;
  daysLate: number;
  paidAtBR: string | null;
  dueDateBR: string | null;
  responsible: string | null;
  removedInfo: string | null;
  msg: BillingMessageInput;
};

export function ReceivablesTable({
  rows,
  accounts,
  month,
  year,
}: {
  rows: ReceivableRow[];
  accounts: { id: string; name: string }[];
  month: number;
  year: number;
}) {
  return (
    <ReceivablesPanel
      rows={rows}
      accounts={accounts}
      month={month}
      year={year}
    />
  );
}
