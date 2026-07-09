"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { ClientActions } from "./row-actions";
import { InlineSelect } from "./inline-select";
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABEL,
  CLIENT_MODALITIES,
  CLIENT_MODALITY_LABEL,
  DELINQUENCY_VALUES,
  DELINQUENCY_LABEL,
  MONTHS,
  clientStatusPill,
  delinquencyPill,
  modalityPill,
  type DelinquencyValue,
} from "./_meta";
import {
  setClientStatus,
  setClientModality,
  setClientDelinquency,
  setClientRenewalMonth,
  setClientLossReason,
  bulkUpdateClients,
  bulkDeleteClients,
} from "@/lib/actions/clients";
import { Textarea } from "@/components/ui/textarea";

export type ClientRow = {
  id: string;
  name: string;
  segment: string | null;
  status: string;
  modality: string | null;
  salesOwner: string | null;
  renewalMonth: number | null;
  delinquency: {
    value: DelinquencyValue | "SEM_COBRANCA";
    manual: boolean;
    by: string | null;
  };
};

const STATUS_OPTIONS = CLIENT_STATUSES.filter((s) => s !== "LEAD").map((s) => ({
  value: s,
  label: CLIENT_STATUS_LABEL[s],
}));
const MODALITY_OPTIONS = CLIENT_MODALITIES.map((m) => ({
  value: m,
  label: CLIENT_MODALITY_LABEL[m],
}));
const DELINQUENCY_OPTIONS = DELINQUENCY_VALUES.map((d) => ({
  value: d,
  label: DELINQUENCY_LABEL[d],
}));
const MONTH_OPTIONS = MONTHS.map((m) => ({ value: String(m.value), label: m.label }));

export function ClientsTable({
  clients,
  allFilteredIds,
}: {
  clients: ClientRow[];
  allFilteredIds: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Cliente recém-marcado como Perdido → oferecer registrar o motivo.
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
              <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`Selecionar ${c.name}`}
                    checked={selected.has(c.id)}
                    onChange={() => toggleOne(c.id)}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <Link href={`/clientes/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                  {c.segment && (
                    <p className="text-xs text-muted-foreground">{c.segment}</p>
                  )}
                </TableCell>
                <TableCell>
                  <InlineSelect
                    ariaLabel={`Status de ${c.name}`}
                    value={c.status}
                    options={STATUS_OPTIONS}
                    pillClass={clientStatusPill}
                    action={(v) => setClientStatus(c.id, v)}
                    onDone={onStatusDone(c)}
                  />
                </TableCell>
                <TableCell>
                  <InlineSelect
                    ariaLabel={`Modalidade de ${c.name}`}
                    value={c.modality ?? ""}
                    options={MODALITY_OPTIONS}
                    pillClass={modalityPill}
                    allowEmpty
                    emptyLabel="— definir —"
                    action={(v) => setClientModality(c.id, v || null)}
                  />
                </TableCell>
                <TableCell>
                  <DelinquencyCell client={c} />
                </TableCell>
                <TableCell>
                  <InlineSelect
                    ariaLabel={`Mês de renovação de ${c.name}`}
                    value={c.renewalMonth != null ? String(c.renewalMonth) : ""}
                    options={MONTH_OPTIONS}
                    allowEmpty
                    emptyLabel="— definir —"
                    action={(v) => setClientRenewalMonth(c.id, v ? parseInt(v, 10) : null)}
                  />
                </TableCell>
                <TableCell className="text-sm">{c.salesOwner ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <ClientActions client={c} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile */}
      <MobileCards>
        {clients.length === 0 ? (
          <MobileEmpty>
            Nenhum cliente encontrado com esses filtros. Ajuste a busca ou cadastre um
            novo cliente.
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
                    options={STATUS_OPTIONS}
                    pillClass={clientStatusPill}
                    action={(v) => setClientStatus(c.id, v)}
                    onDone={onStatusDone(c)}
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

/**
 * Motivo da perda (opcional) — aparece logo após marcar um cliente como
 * Perdido na linha. A perda já foi registrada; aqui só complementamos o
 * motivo no registro mais recente.
 */
function LossReasonDialog({
  client,
  onClose,
}: {
  client: { id: string; name: string };
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  function save() {
    if (!reason.trim()) {
      onClose();
      return;
    }
    start(async () => {
      const res = await setClientLossReason(client.id, reason);
      if (!res.ok) alert(res.error);
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cliente marcado como perdido</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          A perda de <span className="font-medium text-foreground">{client.name}</span>{" "}
          foi registrada nos indicadores. Se quiser, informe o motivo (opcional):
        </p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="ex.: corte de orçamento, insatisfação com resultado, fechou a empresa…"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Pular
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Salvando…" : "Salvar motivo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inadimplência do mês editável inline. Mostra "editado manualmente" quando há
 * override na competência corrente (item 6 do briefing: diferenciar automático
 * de manual). Ao escolher um valor, grava override; opção "Automático" limpa.
 */
function DelinquencyCell({ client }: { client: ClientRow }) {
  const options = [...DELINQUENCY_OPTIONS];
  return (
    <div className="inline-flex flex-col gap-0.5">
      <InlineSelect
        ariaLabel={`Inadimplência de ${client.name}`}
        value={
          client.delinquency.value === "SEM_COBRANCA" ? "" : client.delinquency.value
        }
        options={options}
        pillClass={(v) => delinquencyPill((v || "SEM_COBRANCA") as any)}
        allowEmpty
        emptyLabel={client.delinquency.manual ? "Automático" : DELINQUENCY_LABEL.SEM_COBRANCA}
        action={(v) => setClientDelinquency(client.id, v || null)}
      />
      {client.delinquency.manual && (
        <span className="text-[10px] text-muted-foreground">
          manual{client.delinquency.by ? ` · ${client.delinquency.by}` : ""}
        </span>
      )}
    </div>
  );
}

// ===== Barra de ações em massa =====

type BulkDialog = null | "status" | "owner" | "renewal";

function BulkActionBar({
  ids,
  count,
  onClear,
}: {
  ids: string[];
  count: number;
  onClear: () => void;
}) {
  const [dialog, setDialog] = useState<BulkDialog>(null);
  const [pending, start] = useTransition();

  function runDelete() {
    if (!confirm(`Excluir ${count} cliente${count === 1 ? "" : "s"} selecionado${count === 1 ? "" : "s"}? Esta ação não pode ser desfeita.`))
      return;
    start(async () => {
      const res = await bulkDeleteClients(ids);
      if (!res.ok) alert(res.error);
      else onClear();
    });
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 print:hidden pointer-events-none">
        <div className="pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className="text-sm font-medium">
            {count} cliente{count === 1 ? "" : "s"} selecionado{count === 1 ? "" : "s"}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog("status")}>
              Alterar status
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("owner")}>
              Alterar responsável
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("renewal")}>
              Alterar renovação
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={pending}
              onClick={runDelete}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Excluir
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear}>
              Cancelar
            </Button>
          </div>
        </div>
      </div>

      {dialog === "status" && (
        <BulkFieldDialog
          title="Alterar status em massa"
          count={count}
          onClose={() => setDialog(null)}
          render={(value, setValue) => (
            <Select value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Selecione…</option>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
          onConfirm={(value) => bulkUpdateClients({ ids, status: value })}
          onDone={onClear}
        />
      )}
      {dialog === "owner" && (
        <BulkFieldDialog
          title="Alterar responsável em massa"
          count={count}
          onClose={() => setDialog(null)}
          render={(value, setValue) => (
            <Input
              placeholder="Nome do responsável (vazio = limpar)"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          allowEmpty
          onConfirm={(value) => bulkUpdateClients({ ids, salesOwner: value })}
          onDone={onClear}
        />
      )}
      {dialog === "renewal" && (
        <BulkFieldDialog
          title="Alterar mês de renovação em massa"
          count={count}
          onClose={() => setDialog(null)}
          render={(value, setValue) => (
            <Select value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Selecione o mês…</option>
              {MONTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
          onConfirm={(value) =>
            bulkUpdateClients({ ids, renewalMonth: value ? parseInt(value, 10) : null })
          }
          onDone={onClear}
        />
      )}
    </>
  );
}

function BulkFieldDialog({
  title,
  count,
  render,
  onConfirm,
  onClose,
  onDone,
  allowEmpty = false,
}: {
  title: string;
  count: number;
  render: (value: string, setValue: (v: string) => void) => React.ReactNode;
  onConfirm: (value: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
  allowEmpty?: boolean;
}) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    if (!allowEmpty && !value) {
      setError("Selecione um valor.");
      return;
    }
    start(async () => {
      setError(null);
      const res = await onConfirm(value);
      if (res.ok) {
        onClose();
        onDone();
      } else {
        setError(res.error ?? "Falha ao atualizar.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Aplicar a {count} cliente{count === 1 ? "" : "s"} selecionado
          {count === 1 ? "" : "s"}.
        </p>
        <div className="py-1">{render(value, setValue)}</div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={pending}>
            {pending ? "Aplicando…" : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
