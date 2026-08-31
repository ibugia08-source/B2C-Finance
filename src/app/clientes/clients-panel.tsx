"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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

/**
 * AGRUPAMENTO DA CARTEIRA (F1.16 · ref. 02 §4.1).
 *
 * O subtotal soma o VALOR DE REFERÊNCIA de cada linha (refValue): para
 * MRR é o mensal, para TCV é o total do contrato. Somar os dois no mesmo
 * número é o que a planilha fazia; aqui pelo menos o rótulo diz "valor de
 * referência" e a coluna mostra qual é qual.
 */
const GROUP_KEY_STORAGE = "b2c:clientes:agrupar";

type GroupKey = "none" | "salesOwner" | "modality" | "status" | "renewalMonth";

const GROUP_OPTIONS: { value: GroupKey; label: string }[] = [
  { value: "none", label: "Sem agrupamento" },
  { value: "salesOwner", label: "Gestor" },
  { value: "modality", label: "Modalidade" },
  { value: "status", label: "Status" },
  { value: "renewalMonth", label: "Mês de renovação" },
];

function rotuloGrupo(c: ClientRow, by: GroupKey): string {
  switch (by) {
    case "salesOwner":
      return c.salesOwner?.trim() || "Sem gestor";
    case "modality":
      return c.modality ? CLIENT_MODALITY_LABEL[c.modality as keyof typeof CLIENT_MODALITY_LABEL] ?? c.modality : "Sem modalidade";
    case "status":
      return c.status;
    case "renewalMonth":
      return c.renewalMonth
        ? MONTHS.find((m) => m.value === c.renewalMonth)?.label ?? String(c.renewalMonth)
        : "Sem mês de renovação";
    default:
      return "";
  }
}

function montarGrupos(clients: ClientRow[], by: GroupKey) {
  if (by === "none") {
    return [{ label: "", rows: clients, subtotal: 0 }];
  }
  const mapa = new Map<string, ClientRow[]>();
  for (const c of clients) {
    const k = rotuloGrupo(c, by);
    const atual = mapa.get(k);
    if (atual) atual.push(c);
    else mapa.set(k, [c]);
  }
  return [...mapa.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([label, rows]) => ({
      label,
      rows,
      subtotal: rows.reduce((s, r) => s + (r.refValue ?? 0), 0),
    }));
}

const MODALITY_OPTIONS = CLIENT_MODALITIES.map((m) => ({
  value: m,
  label: CLIENT_MODALITY_LABEL[m],
}));
const MONTH_OPTIONS = MONTHS.map((m) => ({ value: String(m.value), label: m.label }));

export function ClientsPanel({
  clients,
  allFilteredIds,
  canDelete,
}: {
  clients: ClientRow[];
  allFilteredIds: string[];
  canDelete: boolean;
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

  // ===== Agrupamento com subtotais (02 §4.1) =====
  // "agrupamento por gestor/agência/grupo com subtotais". Agência ainda não
  // existe como dimensão do cliente (nasce na F1.1 com a relação
  // cliente↔agência), então não aparece como opção: oferecer um agrupamento
  // que sempre devolve um grupo só seria mentir sobre o que o sistema sabe.
  const [groupBy, setGroupBy] = useState<GroupKey>("none");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(GROUP_KEY_STORAGE);
      if (raw && GROUP_OPTIONS.some((o) => o.value === raw)) setGroupBy(raw as GroupKey);
    } catch {
      /* ignora localStorage indisponível */
    }
  }, []);
  function changeGroupBy(v: string) {
    setGroupBy(v as GroupKey);
    try {
      localStorage.setItem(GROUP_KEY_STORAGE, v);
    } catch {
      /* ignora */
    }
  }

  const grupos = useMemo(() => montarGrupos(clients, groupBy), [clients, groupBy]);

  const onStatusDone = useCallback((c: ClientRow) => (value: string) => {
    if (value === "CHURNED") setLossClient({ id: c.id, name: c.name });
  }, []);
  const ctx = useMemo(() => ({ onStatusDone }), [onStatusDone]);

  const allIds = allFilteredIds;
  const allSelected = allIds.length > 0 && selected.size === allIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }
  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  function clearSelection() {
    setSelected(new Set());
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <>
      {/* Barra de ferramentas: agrupamento + seletor de colunas (desktop) */}
      <div className="mb-2 hidden items-center justify-end gap-2 md:flex">
        <label className="flex items-center gap-1.5 text-caption text-muted-foreground">
          Agrupar por
          <select
            value={groupBy}
            onChange={(e) => changeGroupBy(e.target.value)}
            className="h-8 rounded-cell border bg-background px-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
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

      {/* Desktop — cabeçalho FIXO ao rolar a lista: a rolagem (vertical e
          horizontal) vive no wrapper interno da própria Table, que é o
          scrollport do sticky. Um div externo com overflow quebraria o sticky. */}
      <div className="hidden md:block rounded-md border overflow-hidden">
        <Table containerClassName="max-h-[72vh]">
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
            {grupos.map((g) => (
              <Fragment key={g.label || "todos"}>
                {groupBy !== "none" && (
                  <TableRow className="bg-surface-sunken hover:bg-surface-sunken">
                    <TableCell colSpan={cols.length + 3} className="py-1.5">
                      <span className="text-caption font-semibold uppercase tracking-wide text-foreground">
                        {g.label}
                      </span>
                      <span className="ml-2 text-caption text-muted-foreground">
                        {g.rows.length} cliente(s)
                      </span>
                    </TableCell>
                  </TableRow>
                )}
                {g.rows.map((c) => (
                  <ClientRowDesktop
                    key={c.id}
                    client={c}
                    selected={selected.has(c.id)}
                    onToggle={() => toggleOne(c.id)}
                    columns={cols}
                    ctx={ctx}
                  />
                ))}
                {groupBy !== "none" && (
                  <TableRow className="border-b-2 hover:bg-transparent">
                    <TableCell colSpan={cols.length + 3} className="py-1.5 text-right">
                      <span className="text-caption text-muted-foreground">Subtotal de {g.label}: </span>
                      <span className="stat-number text-body font-semibold">{formatBRL(g.subtotal)}</span>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
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
          canDelete={canDelete}
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
