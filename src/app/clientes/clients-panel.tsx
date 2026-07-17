"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
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
import { formatBRL } from "@/lib/format";
import {
  ALL_COLUMNS,
  DEFAULT_VISIBLE,
  STORAGE_KEY,
  type ClientColKey,
} from "./columns";
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

  // ===== Colunas customizáveis (persistidas no navegador) =====
  const [visible, setVisible] = useState<ClientColKey[]>(DEFAULT_VISIBLE);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const valid = arr.filter((k) => ALL_COLUMNS.some((c) => c.key === k));
          setVisible(valid as ClientColKey[]);
        }
      }
    } catch {
      /* ignora localStorage indisponível */
    }
  }, []);
  function toggleColumn(key: ClientColKey) {
    setVisible((prev) => {
      const next = prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignora */
      }
      return next;
    });
  }
  // Mantém a ordem canônica de ALL_COLUMNS.
  const cols = useMemo(
    () => ALL_COLUMNS.filter((c) => visible.includes(c.key)),
    [visible]
  );

  const onStatusDone = (c: ClientRow) => (value: string) => {
    if (value === "CHURNED") setLossClient({ id: c.id, name: c.name });
  };
  const ctx = { onStatusDone };

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
      {/* Barra de ferramentas: seletor de colunas (desktop) */}
      <div className="hidden md:flex justify-end mb-2">
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setColMenuOpen((o) => !o)}>
            <SlidersHorizontal className="h-4 w-4 mr-1" /> Colunas
          </Button>
          {colMenuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setColMenuOpen(false)} />
              <div className="absolute right-0 z-30 mt-1 w-60 rounded-md border bg-card p-2 shadow-lg">
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Mostrar colunas
                </p>
                {ALL_COLUMNS.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={visible.includes(c.key)}
                      onChange={() => toggleColumn(c.key)}
                    />
                    {c.header}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Desktop — rolagem horizontal CONTÍNUA (barra na base da caixa, sempre
          visível) e cabeçalho fixo ao rolar verticalmente. */}
      <div className="hidden md:block relative max-h-[70vh] overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
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
              {cols.map((c) => (
                <TableHead key={c.key} className={c.thClass}>
                  {c.header}
                </TableHead>
              ))}
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={cols.length + 3} className="p-0">
                  <EmptyState
                    icon={Users}
                    title="Nenhum cliente encontrado"
                    description="Ajuste a busca ou os filtros — ou cadastre um novo cliente pelo botão acima."
                  />
                </TableCell>
              </TableRow>
            )}
            {clients.map((c) => (
              <ClientRowDesktop
                key={c.id}
                client={c}
                selected={selected.has(c.id)}
                onToggle={() => toggleOne(c.id)}
                columns={cols}
                ctx={ctx}
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
                <Field label="Valor">
                  {c.refValue != null && c.refValue > 0
                    ? `${formatBRL(c.refValue)} ${c.modality === "TCV" ? "(total)" : "/mês"}`
                    : "—"}
                </Field>
                <Field label="Pagamento (mês)">
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
