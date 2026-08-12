"use client";
import type { ReactNode } from "react";
import { InlineSelect } from "./inline-select";
import { InlineMoney } from "./inline-money";
import { DelinquencyCell, NotesCell } from "./clients-actions";
import { Badge } from "@/components/ui/badge";
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
  | "services"
  | "risk"
  | "notes"
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
    key: "services",
    header: "Serviços ativos",
    tdClass: "max-w-[240px]",
    render: (c) =>
      c.services.length === 0 ? (
        muted("—")
      ) : (
        <span className="flex flex-wrap gap-1">
          {c.services.slice(0, 3).map((s) => (
            <Badge key={s} variant="outline" className="text-[10px] font-medium">
              {s}
            </Badge>
          ))}
          {c.services.length > 3 && (
            <Badge
              variant="secondary"
              className="text-[10px]"
              title={c.services.join(", ")}
            >
              +{c.services.length - 3}
            </Badge>
          )}
        </span>
      ),
  },
  {
    key: "risk",
    header: "Risco",
    render: (c) =>
      !c.risk || c.risk.level === "sem_historico" ? (
        muted("—")
      ) : (
        <Badge
          variant={
            c.risk.level === "alto"
              ? "destructive"
              : c.risk.level === "medio"
                ? "warning"
                : "success"
          }
        >
          {c.risk.label}
        </Badge>
      ),
  },
  {
    key: "notes",
    header: "Obs",
    interactive: true,
    render: (c) => <NotesCell client={c} />,
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

/** Colunas visíveis por padrão — a linha da planilha do dono. */
export const DEFAULT_VISIBLE: ClientColKey[] = [
  "modality",
  "monthlyValue",
  "totalContractValue",
  "dueDay",
  "paymentStatus",
  "services",
  "renewalMonth",
  "notes",
  "salesOwner",
];

// v2: colunas novas (Serviços/Risco/Obs) entram no padrão — troca de chave
// zera a preferência salva UMA vez para todo mundo enxergar as novidades.
export const STORAGE_KEY = "clientes:columns:v2";
