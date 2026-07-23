"use client";
import { useMemo, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Pencil, Trash2 } from "lucide-react";
import { formatBRL, formatDateBR } from "@/lib/format";
import { cancelBilling, cancelBillingsBulk } from "@/lib/actions/billings";
import { BillingDialog } from "@/app/cobrancas/billing-dialog";
import { FloatingActionBar } from "@/components/ui/floating-action-bar";
import {
  BILLING_STATUS_LABEL,
  billingStatusVariant,
  COLLECTION_STATUS_LABEL,
} from "@/app/cobrancas/_meta";

export type ReceivableTabRow = {
  id: string;
  description: string;
  competenceMonth: number;
  competenceYear: number;
  dueDate: string;
  amount: number;
  paidTotal: number;
  status: string;
  collectionStatus: string;
  revenueType: string;
  contractId: string | null;
  serviceId: string | null;
  collector: string | null;
  notes: string | null;
};

export function ReceivablesTab({
  clientId,
  clientName,
  rows,
  contracts,
  services,
  canEdit = true,
  canDelete = true,
}: {
  clientId: string;
  clientName: string;
  rows: ReceivableTabRow[];
  contracts: { id: string; title: string; clientId: string }[];
  services: { id: string; name: string }[];
  /** Sem recebimentos.editar → some o Editar da barra de seleção. */
  canEdit?: boolean;
  /** Sem recebimentos.excluir → some o Excluir da barra de seleção. */
  canDelete?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected]
  );
  const single = selectedRows.length === 1 ? selectedRows[0] : null;

  const clients = useMemo(
    () => [{ id: clientId, name: clientName }],
    [clientId, clientName]
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
        ? "Tem certeza que deseja excluir este recebimento?\n\nEssa ação atualizará os indicadores financeiros relacionados a este cliente."
        : `Tem certeza que deseja excluir os ${count} recebimentos selecionados?\n\nEssa ação atualizará os indicadores financeiros relacionados.`;
    if (!confirm(message)) return;
    start(async () => {
      const res =
        count === 1
          ? await cancelBilling(selectedRows[0].id, "Excluído pela aba Recebimentos do cliente.")
          : await cancelBillingsBulk(
              selectedRows.map((r) => r.id),
              "Excluído (em massa) pela aba Recebimentos do cliente."
            );
      if (!res.ok) {
        alert(res.error);
        return;
      }
      if (res.warning) alert(res.warning);
      clearSelection();
    });
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <div className="py-12 px-6 text-center text-sm text-muted-foreground">
            Nenhuma cobrança registrada para este cliente.
          </div>
        </CardContent>
      </Card>
    );
  }

  const selectable = canEdit || canDelete;
  const allChecked = selected.size === rows.length && rows.length > 0;
  const someChecked = selected.size > 0 && selected.size < rows.length;

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {selectable && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Selecionar todas as cobranças"
                      checked={allChecked}
                      indeterminate={someChecked}
                      onChange={toggleAll}
                    />
                  </TableHead>
                )}
                <TableHead>Descrição</TableHead>
                <TableHead>Competência</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cobrança</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const checked = selected.has(b.id);
                return (
                  <TableRow key={b.id} data-state={checked ? "selected" : undefined}>
                    {selectable && (
                      <TableCell>
                        <Checkbox
                          aria-label={`Selecionar cobrança ${b.description}`}
                          checked={checked}
                          onChange={() => toggle(b.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium max-w-xs truncate">
                      {b.description}
                    </TableCell>
                    <TableCell>
                      {String(b.competenceMonth).padStart(2, "0")}/{b.competenceYear}
                    </TableCell>
                    <TableCell>{formatDateBR(b.dueDate)}</TableCell>
                    <TableCell className="text-right">{formatBRL(b.amount)}</TableCell>
                    <TableCell className="text-right">{formatBRL(b.paidTotal)}</TableCell>
                    <TableCell>
                      <Badge variant={billingStatusVariant(b.status)}>
                        {BILLING_STATUS_LABEL[b.status] ?? b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {COLLECTION_STATUS_LABEL[b.collectionStatus] ?? b.collectionStatus}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectable && selectedRows.length > 0 && (
        <FloatingActionBar>
          <div className="pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
            <span className="text-sm font-medium">
              {selectedRows.length} selecionado{selectedRows.length === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {canEdit && single && (
                <BillingDialog
                  clients={clients}
                  contracts={contracts}
                  services={services}
                  initial={{ ...single, clientId }}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Pencil className="h-4 w-4 mr-1" /> Editar
                    </Button>
                  }
                />
              )}
              {canDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={pending}
                  onClick={deleteSelected}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  {selectedRows.length === 1 ? "Excluir" : "Excluir selecionados"}
                </Button>
              )}
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
