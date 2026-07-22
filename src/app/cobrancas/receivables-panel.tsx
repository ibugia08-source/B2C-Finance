"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { Badge } from "@/components/ui/badge";
import { ReceivableRow } from "./receivables-row";
import {
  StatusCell,
  TermSelect,
  InlineMoney,
  RowActions,
  BulkBar,
} from "./receivables-actions";
import { setClientChargeAmount } from "@/lib/actions/receivables-inline";
import type { ReceivableRow as ReceivableRowType } from "./receivables-table";

export function ReceivablesPanel({
  rows,
  accounts,
  month,
  year,
}: {
  rows: ReceivableRowType[];
  accounts: { id: string; name: string }[];
  month: number;
  year: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allKeys = rows.map((r) => r.key);
  const allSelected = allKeys.length > 0 && selected.size === allKeys.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = useCallback(() => setSelected(allSelected ? new Set() : new Set(allKeys)), [allSelected, allKeys]);
  const toggleOne = useCallback((k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    }), []);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.key)),
    [rows, selected]
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Selecionar todos"
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                />
              </TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Modalidade</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor devido</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Prazo do contrato</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                  Nenhum cliente encontrado no ciclo de recebimentos deste mês.{" "}
                  <Link href="/clientes" className="underline">
                    Abrir Gestão de Carteira
                  </Link>
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <ReceivableRow
                key={r.key}
                row={r}
                selected={selected.has(r.key)}
                onToggle={() => toggleOne(r.key)}
                accounts={accounts}
                month={month}
                year={year}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <MobileCards>
        {rows.length === 0 ? (
          <MobileEmpty>
            Nenhum cliente encontrado no ciclo de recebimentos deste mês. Você pode
            adicionar clientes manualmente ou revisar a Gestão de Carteira.
          </MobileEmpty>
        ) : (
          rows.map((r) => (
            <MobileCard key={r.key}>
              <MobileCardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Checkbox
                      aria-label={`Selecionar ${r.name}`}
                      checked={selected.has(r.key)}
                      onChange={() => toggleOne(r.key)}
                    />
                    <Link href={`/clientes/${r.clientId}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </span>
                }
                aside={<Badge variant="outline">{r.statusLabel}</Badge>}
              />
              <div className="space-y-1.5">
                <Field label="Valor devido">
                  <InlineMoney
                    ariaLabel={`Valor devido de ${r.name}`}
                    value={r.amountDue}
                    onSave={(raw) => setClientChargeAmount(r.clientId, raw, month, year)}
                  />
                </Field>
                <Field label="Status">
                  <StatusCell row={r} onStatusChange={() => async () => ({ ok: false, error: "" })} />
                </Field>
                <Field label="Vencimento">
                  {r.dueDateBR ?? (r.paymentDay ? `todo dia ${r.paymentDay}` : "—")}
                </Field>
                {r.daysLate > 0 && (
                  <Field label="Atraso">
                    <span className="text-destructive font-medium">
                      ! {r.daysLate} dia{r.daysLate === 1 ? "" : "s"}
                    </span>
                  </Field>
                )}
                <Field label="Responsável">{r.responsible ?? "—"}</Field>
              </div>
              <MobileCardActions>
                <RowActions row={r} accounts={accounts} primary />
              </MobileCardActions>
            </MobileCard>
          ))
        )}
      </MobileCards>

      {selectedRows.length > 0 && (
        <BulkBar
          rows={selectedRows}
          month={month}
          year={year}
          onClear={() => setSelected(new Set())}
        />
      )}
    </>
  );
}
