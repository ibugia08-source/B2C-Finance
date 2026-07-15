"use client";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { InlineSelect } from "@/app/clientes/inline-select";
import {
  StatusCell,
  TermSelect,
  InlineMoney,
  RowActions,
} from "./receivables-actions";
import { setClientPaymentDay, setClientChargeAmount, setMonthChargeStatus } from "@/lib/actions/receivables-inline";
import { setClientModality } from "@/lib/actions/clients";
import type { ActionResult } from "@/lib/actions/clients";
import type { ReceivableRow } from "./receivables-table";

const MODALITY_OPTIONS = [
  { value: "MRR", label: "MRR" },
  { value: "TCV", label: "TCV" },
];

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: `Todo dia ${String(i + 1).padStart(2, "0")}`,
}));

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ReceivableRow({
  row,
  selected,
  onToggle,
  accounts,
  month,
  year,
}: {
  row: ReceivableRow;
  selected: boolean;
  onToggle: () => void;
  accounts: { id: string; name: string }[];
  month: number;
  year: number;
}) {
  const onStatusChange = (r: ReceivableRow) => async (v: string): Promise<ActionResult> => {
    if (!r.billingId)
      return { ok: false, error: `Cliente sem cobrança neste mês — use "Incluir cliente no mês".` };
    if (v === "PAID") {
      if (
        !confirm(
          `Registrar pagamento de ${fmtBRL(r.openAmount)} de ${r.name} com data de hoje?\n\nPara valor parcial ou outra data, use a ação "Registrar pagamento" ($).`
        )
      )
        return { ok: false, error: "Pagamento não registrado." };
    }
    return setMonthChargeStatus(r.billingId, v as any);
  };

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          aria-label={`Selecionar ${row.name}`}
          checked={selected}
          onChange={onToggle}
        />
      </TableCell>
      <TableCell className="max-w-[220px]">
        <span className="flex items-center gap-1.5">
          <Link href={`/clientes/${row.clientId}`} className="font-medium hover:underline truncate">
            {row.name}
          </Link>
          {(row.cycleStatus === "OVERDUE" ||
            row.cycleStatus === "DELINQUENT" ||
            row.cycleStatus === "PAID_LATE") && (
            <span title="Pagamento em atraso em relação à data de vencimento." className="cursor-help">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            </span>
          )}
        </span>
        {row.removedInfo && (
          <p className="text-[11px] text-muted-foreground">{row.removedInfo}</p>
        )}
      </TableCell>
      <TableCell>
        <InlineSelect
          ariaLabel={`Modalidade de ${row.name}`}
          value={row.modality ?? ""}
          options={MODALITY_OPTIONS}
          allowEmpty
          emptyLabel="— definir —"
          pillClass={(v) =>
            v === "MRR"
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : v === "TCV"
                ? "bg-violet-50 text-violet-700 border-violet-200"
                : "bg-muted text-muted-foreground border-transparent"
          }
          action={(v) => setClientModality(row.clientId, v || null)}
        />
      </TableCell>
      <TableCell>
        <InlineSelect
          ariaLabel={`Vencimento recorrente de ${row.name}`}
          value={row.paymentDay != null ? String(row.paymentDay) : ""}
          options={DAY_OPTIONS}
          allowEmpty
          emptyLabel="— definir —"
          action={(v) =>
            setClientPaymentDay(row.clientId, parseInt(v, 10), month, year)
          }
        />
        {row.dueDateBR && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            neste mês: {row.dueDateBR}
          </p>
        )}
      </TableCell>
      <TableCell className="text-right">
        <InlineMoney
          ariaLabel={`Valor devido de ${row.name}`}
          value={row.amountDue}
          onSave={(raw) => setClientChargeAmount(row.clientId, raw, month, year)}
        />
      </TableCell>
      <TableCell>
        <StatusCell row={row} onStatusChange={onStatusChange} />
      </TableCell>
      <TableCell>
        <TermSelect row={row} />
      </TableCell>
      <TableCell className="text-right">
        <RowActions row={row} accounts={accounts} />
      </TableCell>
    </TableRow>
  );
}
