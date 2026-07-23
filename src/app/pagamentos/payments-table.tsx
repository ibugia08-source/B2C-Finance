"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { Trash2 } from "lucide-react";
import { formatBRL, formatDateBR } from "@/lib/format";
import {
  deleteBillingPayment,
  deleteBillingPaymentsBulk,
} from "@/lib/actions/billings";
import { PAYMENT_METHOD_LABEL } from "@/app/cobrancas/_meta";
import { FloatingActionBar } from "@/components/ui/floating-action-bar";

export type PaymentRow = {
  id: string;
  paidAt: string;
  amount: number;
  method: string;
  clientId: string;
  clientName: string;
  description: string;
  accountName: string | null;
};

export function PaymentsTable({ rows }: { rows: PaymentRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))
    );
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function deleteSelected() {
    const count = selectedRows.length;
    const message =
      count === 1
        ? "Excluir este pagamento?\n\nO saldo e o status da cobrança serão revertidos e os indicadores financeiros serão atualizados em toda a plataforma."
        : `Excluir os ${count} pagamentos selecionados?\n\nO saldo e o status de cada cobrança serão revertidos e os indicadores financeiros serão atualizados em toda a plataforma.`;
    if (!confirm(message)) return;
    start(async () => {
      const res =
        count === 1
          ? await deleteBillingPayment(selectedRows[0].id)
          : await deleteBillingPaymentsBulk(selectedRows.map((r) => r.id));
      if (!res.ok) {
        alert(res.error);
        return;
      }
      clearSelection();
    });
  }

  const allChecked = selected.size === rows.length && rows.length > 0;
  const someChecked = selected.size > 0 && selected.size < rows.length;

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Selecionar todos os pagamentos"
                  checked={allChecked}
                  indeterminate={someChecked}
                  onChange={toggleAll}
                  disabled={rows.length === 0}
                />
              </TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Referente a</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-12"
                >
                  Nenhum pagamento neste período.
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => {
              const checked = selected.has(p.id);
              return (
                <TableRow
                  key={p.id}
                  data-state={checked ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`Selecionar pagamento de ${p.clientName}`}
                      checked={checked}
                      onChange={() => toggle(p.id)}
                    />
                  </TableCell>
                  <TableCell>{formatDateBR(p.paidAt)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/clientes/${p.clientId}`}
                      className="hover:underline"
                    >
                      {p.clientName}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {p.description}
                  </TableCell>
                  <TableCell>
                    {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                  </TableCell>
                  <TableCell>{p.accountName ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium text-emerald-600">
                    +{formatBRL(p.amount)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <MobileCards>
        {rows.length === 0 ? (
          <MobileEmpty>Nenhum pagamento neste período.</MobileEmpty>
        ) : (
          rows.map((p) => {
            const checked = selected.has(p.id);
            return (
              <MobileCard
                key={p.id}
                className={checked ? "ring-2 ring-primary" : undefined}
              >
                <MobileCardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <Checkbox
                        aria-label={`Selecionar pagamento de ${p.clientName}`}
                        checked={checked}
                        onChange={() => toggle(p.id)}
                      />
                      {p.clientName}
                    </span>
                  }
                  aside={
                    <span className="font-semibold text-emerald-600">
                      +{formatBRL(p.amount)}
                    </span>
                  }
                />
                <div className="space-y-1.5">
                  <Field label="Data">{formatDateBR(p.paidAt)}</Field>
                  <Field label="Referente a">{p.description}</Field>
                  <Field label="Forma">
                    {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                  </Field>
                </div>
              </MobileCard>
            );
          })
        )}
      </MobileCards>

      {selectedRows.length > 0 && (
        <FloatingActionBar>
          <div className="pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
            <span className="text-sm font-medium">
              {selectedRows.length} selecionado
              {selectedRows.length === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={pending}
                onClick={deleteSelected}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {selectedRows.length === 1
                  ? "Excluir"
                  : "Excluir selecionados"}
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Cancelar
              </Button>
            </div>
          </div>
        </FloatingActionBar>
      )}
    </>
  );
}
