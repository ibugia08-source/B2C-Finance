"use client";
import type { ReactNode } from "react";
import { InlineSelect } from "./inline-select";
import { InlineMoney } from "./inline-money";
import { DelinquencyCell } from "./clients-actions";
import { formatBRL } from "@/lib/format";
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABEL,
  CLIENT_MODALITIES,
  CLIENT_MODALITY_LABEL,
  MONTHS,
  clientStatusPill,
  modalityPill,
} from "./_meta";
import {
  setClientStatus,
  setClientModality,
  setClientRenewalMonth,
  setClientMonthlyValue,
} from "@/lib/actions/clients";
import type { ClientRow } from "./clients-table";

const STATUS_OPTIONS = CLIENT_STATUSES.filter((s) => s !== "LEAD").map((s) => ({
  value: s,
  label: CLIENT_STATUS_LABEL[s],
}));
const MODALITY_OPTIONS = CLIENT_MODALITIES.map((m) => ({
  value: m,
  label: CLIENT_MODALITY_LABEL[m],
}));
const MONTH_OPTIONS = MONTHS.map((m) => ({ value: String(m.value), label: m.label }));

export type ClientColKey =
  | "status"
  | "modality"
  | "monthlyValue"
  | "totalContractValue"
  | "dueDay"
  | "paymentStatus"
  | "renewalMonth"
  | "monthsActive"
  | "salesOwner"
  | "segment";

export type ColumnCtx = {
  onStatusDone: (c: ClientRow) => (value: string) => void;
};

export type ClientColumn = {
  key: ClientColKey;
  header: string;
  thClass?: string;
  tdClass?: string;
  /** Célula interativa: clique não abre a área do cliente. */
  interactive?: boolean;
  render: (c: ClientRow, ctx: ColumnCtx) => ReactNode;
};

const muted = (v: ReactNode) => <span className="text-muted-foreground">{v}</span>;

export const ALL_COLUMNS: ClientColumn[] = [
  {
    key: "status",
    header: "Status",
    interactive: true,
    render: (c, ctx) => (
      <InlineSelect
        ariaLabel={`Status de ${c.name}`}
        value={c.status}
        options={STATUS_OPTIONS}
        pillClass={clientStatusPill}
        action={(v) => setClientStatus(c.id, v)}
        onDone={ctx.onStatusDone(c)}
      />
    ),
  },
  {
    key: "modality",
    header: "Modalidade",
    interactive: true,
    render: (c) => (
      <InlineSelect
        ariaLabel={`Modalidade de ${c.name}`}
        value={c.modality ?? ""}
        options={MODALITY_OPTIONS}
        pillClass={modalityPill}
        allowEmpty
        emptyLabel="— definir —"
        action={(v) => setClientModality(c.id, v || null)}
      />
    ),
  },
  {
    key: "monthlyValue",
    header: "Valor mensal",
    thClass: "text-right",
    tdClass: "text-right",
    interactive: true,
    render: (c) => (
      <InlineMoney
        ariaLabel={`Valor mensal de ${c.name}`}
        value={c.monthlyValue}
        suffix="/mês"
        onSave={(raw) => setClientMonthlyValue(c.id, raw)}
      />
    ),
  },
  {
    key: "totalContractValue",
    header: "Valor total (TCV)",
    thClass: "text-right",
    tdClass: "text-right tabular-nums whitespace-nowrap",
    render: (c) =>
      c.totalContractValue != null && c.totalContractValue > 0
        ? formatBRL(c.totalContractValue)
        : muted("—"),
  },
  {
    key: "dueDay",
    header: "Vencimento",
    tdClass: "text-sm whitespace-nowrap",
    render: (c) =>
      c.modality === "TCV"
        ? muted("no ato")
        : c.dueDay != null
          ? `dia ${c.dueDay}`
          : muted("—"),
  },
  {
    key: "paymentStatus",
    header: "Pagamento (mês)",
    interactive: true,
    render: (c) => <DelinquencyCell client={c} />,
  },
  {
    key: "renewalMonth",
    header: "Renovação",
    interactive: true,
    render: (c) => (
      <InlineSelect
        ariaLabel={`Mês de renovação de ${c.name}`}
        value={c.renewalMonth != null ? String(c.renewalMonth) : ""}
        options={MONTH_OPTIONS}
        allowEmpty
        emptyLabel="— definir —"
        action={(v) => setClientRenewalMonth(c.id, v ? parseInt(v, 10) : null)}
      />
    ),
  },
  {
    key: "monthsActive",
    header: "Meses ativo",
    thClass: "text-center",
    tdClass: "text-center text-sm tabular-nums",
    render: (c) => (c.monthsActive != null ? c.monthsActive : muted("—")),
  },
  {
    key: "salesOwner",
    header: "Responsável",
    tdClass: "text-sm whitespace-nowrap",
    render: (c) => c.salesOwner ?? muted("—"),
  },
  {
    key: "segment",
    header: "Segmento",
    tdClass: "text-sm whitespace-nowrap",
    render: (c) => c.segment ?? muted("—"),
  },
];

export const COLUMN_LABEL: Record<ClientColKey, string> = ALL_COLUMNS.reduce(
  (acc, c) => ((acc[c.key] = c.header), acc),
  {} as Record<ClientColKey, string>
);

/** Colunas visíveis por padrão (as escolhidas pelo cliente + essenciais). */
export const DEFAULT_VISIBLE: ClientColKey[] = [
  "modality",
  "monthlyValue",
  "totalContractValue",
  "dueDay",
  "paymentStatus",
  "renewalMonth",
  "salesOwner",
];

export const STORAGE_KEY = "clientes:columns:v1";
