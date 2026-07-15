"use client";
import { useMemo, useState } from "react";
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
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { ClientRowDesktop } from "./clients-row";
import { DelinquencyCell, LossReasonDialog, BulkActionBar } from "./clients-actions";
import { ClientActions } from "./row-actions";
import { InlineSelect } from "./inline-select";
import {
  CLIENT_MODALITIES,
  CLIENT_MODALITY_LABEL,
  MONTHS,
  modalityPill,
} from "./_meta";
import { setClientModality, setClientRenewalMonth } from "@/lib/actions/clients";
import type { ClientRow } from "./clients-table";

const MODALITY_OPTIONS = CLIENT_MODALITIES.map((m) => ({
  value: m,
  label: CLIENT_MODALITY_LABEL[m],
}));
const MONTH_OPTIONS = MONTHS.map((m) => ({ value: String(m.value), label: m.label }));

export function ClientsPanel({
  clients,
  allFilteredIds,
}: {
  clients: ClientRow[];
  allFilteredIds: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lossClient, setLossClient] = useState<{ id: string; name: string } | null>(null);

  const onStatusDone = (c: ClientRow) => (value: string) => {
    if (value === "CHURNED") setLossClient({ id: c.id, name: c.name });
  };

  const allIds = allFilteredIds;
  const allSelected = allIds.length > 0 && selected.size === allIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

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
              <TableHead>Status</TableHead>
              <TableHead>Modalidade</TableHead>
              <TableHead>Inadimplência (mês)</TableHead>
              <TableHead>Renovação</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                  Nenhum cliente encontrado com esses filtros.
                  <br />
                  Ajuste a busca ou cadastre um novo cliente.
                </TableCell>
              </TableRow>
            )}
            {clients.map((c) => (
              <ClientRowDesktop
                key={c.id}
                client={c}
                selected={selected.has(c.id)}
                onToggle={() => toggleOne(c.id)}
                onStatusDone={onStatusDone}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <MobileCards>
        {clients.length === 0 ? (
          <MobileEmpty>
            Nenhum cliente encontrado com esses filtros. Ajuste a busca ou cadastre um novo cliente.
          </MobileEmpty>
        ) : (
          clients.map((c) => (
            <MobileCard key={c.id}>
              <MobileCardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Checkbox
                      aria-label={`Selecionar ${c.name}`}
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                    />
                    <Link href={`/clientes/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </span>
                }
                aside={
                  <InlineSelect
                    ariaLabel={`Status de ${c.name}`}
                    value={c.status}
                    options={[
                      { value: "ACTIVE", label: "Ativo" },
                      { value: "INACTIVE", label: "Inativo" },
                      { value: "CHURNED", label: "Perdido" },
                    ]}
                    pillClass={() => ""}
                    action={(v) => {
                      if (v === "CHURNED") setLossClient({ id: c.id, name: c.name });
                      return Promise.resolve({ ok: true });
                    }}
                  />
                }
              />
              <div className="space-y-1.5">
                <Field label="Modalidade">
                  <InlineSelect
                    ariaLabel={`Modalidade de ${c.name}`}
                    value={c.modality ?? ""}
                    options={MODALITY_OPTIONS}
                    pillClass={modalityPill}
                    allowEmpty
                    emptyLabel="— definir —"
                    action={(v) => setClientModality(c.id, v || null)}
                  />
                </Field>
                <Field label="Inadimplência (mês)">
                  <DelinquencyCell client={c} />
                </Field>
                <Field label="Renovação">
                  <InlineSelect
                    ariaLabel={`Mês de renovação de ${c.name}`}
                    value={c.renewalMonth != null ? String(c.renewalMonth) : ""}
                    options={MONTH_OPTIONS}
                    allowEmpty
                    emptyLabel="— definir —"
                    action={(v) => setClientRenewalMonth(c.id, v ? parseInt(v, 10) : null)}
                  />
                </Field>
                <Field label="Responsável">{c.salesOwner ?? "—"}</Field>
              </div>
              <MobileCardActions>
                <ClientActions client={c} />
              </MobileCardActions>
            </MobileCard>
          ))
        )}
      </MobileCards>

      {selectedIds.length > 0 && (
        <BulkActionBar
          ids={selectedIds}
          count={selectedIds.length}
          onClear={clearSelection}
        />
      )}

      {lossClient && (
        <LossReasonDialog client={lossClient} onClose={() => setLossClient(null)} />
      )}
    </>
  );
}
