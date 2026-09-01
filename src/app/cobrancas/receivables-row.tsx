"use client";
import { memo, useCallback } from "react";
import { formatBRL } from "@/lib/format";
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
import { quickSettleBilling, undoQuickSettle } from "@/lib/actions/billings";
import { setClientModality } from "@/lib/actions/clients";
import { showUndoToast } from "@/components/undo-toast";
import type { ActionResult } from "@/lib/actions/clients";
import type { ReceivableRow as ReceivableRowType } from "./receivables-table";

const MODALITY_OPTIONS = [
  { value: "MRR", label: "MRR" },
  { value: "TCV", label: "TCV" },
];

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: `Todo dia ${String(i + 1).padStart(2, "0")}`,
}));

// Gesto da planilha: escolher "Pago" registra NA HORA (saldo do mês) e o
// toast oferece Desfazer — sem confirm(). Valor parcial/outra data/conta
// continuam no dialog $ da linha. Compartilhado entre a tabela (desktop) e
// os cards (mobile) — os dois gestos são o MESMO pagamento real.
export function useStatusChangeHandler() {
  return useCallback((r: ReceivableRowType) => async (v: string): Promise<ActionResult> => {
    if (!r.billingId)
      return { ok: false, error: `Cliente sem cobrança neste mês — use "Incluir cliente no mês".` };
    if (v === "PAID") {
      const res = await quickSettleBilling(r.billingId);
      if (res.ok) {
        const paymentId = res.id;
        showUndoToast({
          message: `${r.name}: pagamento de ${formatBRL(r.openAmount)} registrado.`,
          onUndo: paymentId ? () => undoQuickSettle(paymentId) : undefined,
        });
      }
      return res;
    }
    return setMonthChargeStatus(r.billingId, v as any);
  }, []);
}

/** Rótulos de tela da avaliação (01 §5.2: nome técnico não aparece). */
const SAUDE_LABEL: Record<string, string> = {
  estavel: "Estável",
  oscilando: "Oscilando",
  caindo: "Caindo",
};

function ReceivableRowInner({
  row,
  selected,
  onToggle,
  accounts,
  month,
  year,
  linhaProps,
  mostrarSaude,
}: {
  row: ReceivableRowType;
  selected: boolean;
  onToggle: () => void;
  accounts: { id: string; name: string }[];
  month: number;
  year: number;
  /** Props do foco rotativo (F3.12) — vêm do useTableKeyboard do painel. */
  linhaProps?: Record<string, unknown>;
  /** F1.15 — coluna opcional estabilidade/risco, ligada no painel. */
  mostrarSaude?: boolean;
}) {
  const onStatusChange = useStatusChangeHandler();

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      {...linhaProps}
    >
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
              ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30"
              : v === "TCV"
                ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30"
                : "bg-muted text-muted-foreground border-transparent"
          }
          action={(v) => setClientModality(row.clientId, v || null)}
        />
      </TableCell>
      <TableCell>
        {row.modality === "TCV" ? (
          // TCV: entra só no mês de adesão/fechamento/renovação — mostra a data
          // do evento, sem dia recorrente (§15). Não é editável como recorrência.
          <span className="text-sm tabular-nums" title="Data de entrada/fechamento/renovação (TCV não tem vencimento recorrente)">
            {row.dueDateBR ?? "—"}
          </span>
        ) : (
          <>
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
          </>
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
      {mostrarSaude ? (
        <TableCell>
          {row.saude ? (
            <span
              className="inline-flex items-center gap-1.5 text-dense"
              title={`Avaliação de ${row.saude.competence}`}
            >
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${
                  row.saude.risco === "alto"
                    ? "bg-destructive"
                    : row.saude.risco === "medio"
                      ? "bg-warning"
                      : "bg-success"
                }`}
              />
              {SAUDE_LABEL[row.saude.estabilidade ?? ""] ?? row.saude.estabilidade ?? "—"}
            </span>
          ) : (
            <span className="text-dense text-muted-foreground" title="Nenhuma avaliação mensal registrada para este cliente.">
              sem leitura
            </span>
          )}
        </TableCell>
      ) : null}
      <TableCell>
        <TermSelect row={row} />
      </TableCell>
      <TableCell className="text-right">
        <RowActions row={row} accounts={accounts} />
      </TableCell>
    </TableRow>
  );
}

export const ReceivableRow = memo(ReceivableRowInner);
