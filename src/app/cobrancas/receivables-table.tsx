"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, DollarSign, MessageSquareText, CalendarClock, RotateCcw } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
import { InlineSelect } from "@/app/clientes/inline-select";
import { PaymentDialog } from "./payment-dialog";
import { MessageDialog } from "./message-dialog";
import { RescheduleDialog } from "./note-dialog";
import { setClientModality, bulkUpdateClients } from "@/lib/actions/clients";
import {
  setClientPaymentDay,
  setClientChargeAmount,
  setClientContractMonths,
  setMonthChargeStatus,
  bulkSetMonthStatus,
  bulkRemoveFromMonth,
} from "@/lib/actions/receivables-inline";
import { restoreBilling } from "@/lib/actions/billings";
import type { ActionResult } from "@/lib/actions/clients";
import type { BillingMessageInput } from "@/lib/billing-message";

/**
 * Lista mensal de Recebimentos — uma linha por cliente ativo do mês.
 * Colunas editáveis inline sincronizam com o cadastro na Gestão de Carteira
 * (modalidade, vencimento recorrente, valor, prazo); o Status é do
 * recebimento do mês. Apenas 3 ações por linha: Registrar pagamento,
 * Gerar texto de cobrança e Alterar data de cobrança do mês.
 */

export type ReceivableRow = {
  key: string; // billingId ?? clientId
  clientId: string;
  billingId: string | null; // null = ativo sem cobrança neste mês
  name: string;
  phone: string | null;
  modality: string | null;
  paymentDay: number | null;
  contractMonths: number | null;
  amountDue: number;
  openAmount: number;
  description: string | null;
  cycleStatus: string; // CycleStatus | "NO_CHARGE"
  statusLabel: string;
  daysLate: number;
  paidAtBR: string | null;
  dueDateBR: string | null;
  responsible: string | null;
  removedInfo: string | null;
  msg: BillingMessageInput;
};

const MODALITY_OPTIONS = [
  { value: "MRR", label: "MRR" },
  { value: "TCV", label: "TCV" },
];

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: `Todo dia ${String(i + 1).padStart(2, "0")}`,
}));

const STATUS_OPTIONS = [
  { value: "UPCOMING", label: "A vencer" },
  { value: "PAID", label: "Pago" },
  { value: "OVERDUE", label: "Vencido" },
  { value: "DELINQUENT", label: "Inadimplente" },
];

const TERM_OPTIONS = [
  { value: "1", label: "1 mês" },
  { value: "3", label: "3 meses" },
  { value: "6", label: "6 meses" },
  { value: "12", label: "12 meses" },
];

const STATUS_PILL: Record<string, string> = {
  UPCOMING: "bg-amber-50 text-amber-700 border-amber-200",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PAID_LATE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PAID_OTHER_MONTH: "bg-slate-100 text-slate-700 border-slate-200",
  OVERDUE: "bg-red-50 text-red-700 border-red-200",
  DELINQUENT: "bg-red-100 text-red-800 border-red-200",
  PARTIAL: "bg-amber-50 text-amber-700 border-amber-200",
  REMOVED: "bg-muted text-muted-foreground border-transparent",
  NO_CHARGE: "bg-muted text-muted-foreground border-transparent",
};

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Valor do status no select (estados pagos colapsam em "PAID"). */
function statusSelectValue(cycleStatus: string): string {
  if (["PAID", "PAID_LATE", "PAID_OTHER_MONTH"].includes(cycleStatus)) return "PAID";
  if (cycleStatus === "PARTIAL") return "UPCOMING";
  return cycleStatus; // UPCOMING | OVERDUE | DELINQUENT
}

export function ReceivablesTable({
  rows,
  accounts,
  month,
  year,
}: {
  rows: ReceivableRow[];
  accounts: { id: string; name: string }[];
  month: number;
  year: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allKeys = rows.map((r) => r.key);
  const allSelected = allKeys.length > 0 && selected.size === allKeys.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allKeys));
  const toggleOne = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.key)),
    [rows, selected]
  );

  const statusAction = (r: ReceivableRow) => async (v: string): Promise<ActionResult> => {
    if (!r.billingId)
      return { ok: false, error: "Cliente sem cobrança neste mês — use “Incluir cliente no mês”." };
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

  function statusCell(r: ReceivableRow) {
    if (r.cycleStatus === "REMOVED")
      return (
        <div className="inline-flex items-center gap-1.5">
          <Badge variant="outline">Removido do mês</Badge>
          <RestoreButton billingId={r.billingId!} name={r.name} />
        </div>
      );
    if (r.cycleStatus === "NO_CHARGE")
      return (
        <span
          className="inline-flex items-center rounded-full border bg-muted px-2.5 h-6 text-xs text-muted-foreground"
          title="Cliente ativo sem cobrança gerada neste mês (TCV fora do mês de adesão ou sem modalidade definida)."
        >
          Sem cobrança no mês
        </span>
      );
    return (
      <div className="inline-flex flex-col gap-0.5">
        <InlineSelect
          ariaLabel={`Status de ${r.name} no mês`}
          value={statusSelectValue(r.cycleStatus)}
          options={STATUS_OPTIONS}
          pillClass={() => STATUS_PILL[r.cycleStatus] ?? STATUS_PILL.UPCOMING}
          action={statusAction(r)}
        />
        <span className="text-[10px] text-muted-foreground">
          {r.cycleStatus === "OVERDUE" || r.cycleStatus === "DELINQUENT" ? (
            <span className="text-destructive font-medium">
              ! {r.daysLate} dia{r.daysLate === 1 ? "" : "s"} em atraso
            </span>
          ) : r.cycleStatus === "PAID_LATE" ? (
            `! pago com ${r.daysLate} dia${r.daysLate === 1 ? "" : "s"} de atraso`
          ) : r.cycleStatus === "PAID_OTHER_MONTH" ? (
            "inadimplência regularizada em outro mês"
          ) : r.cycleStatus === "PARTIAL" ? (
            `${fmtBRL(r.openAmount)} em aberto`
          ) : r.paidAtBR ? (
            `pago em ${r.paidAtBR}`
          ) : (
            "Em dia"
          )}
        </span>
      </div>
    );
  }

  function rowActions(r: ReceivableRow, primary = false) {
    const open = r.billingId && !["PAID", "PAID_LATE", "PAID_OTHER_MONTH", "REMOVED", "NO_CHARGE"].includes(r.cycleStatus);
    return (
      <div className="flex gap-0.5 justify-end flex-wrap items-center">
        {open && (
          <PaymentDialog
            billing={{ id: r.billingId!, openAmount: r.openAmount, description: r.description ?? r.name }}
            accounts={accounts}
            trigger={
              primary ? (
                <Button size="sm" aria-label="Registrar pagamento">
                  <DollarSign className="h-4 w-4 mr-1" /> Registrar pagamento
                </Button>
              ) : (
                <Button variant="ghost" size="icon" title="Registrar pagamento (valor e data)" aria-label="Registrar pagamento">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                </Button>
              )
            }
          />
        )}
        {r.cycleStatus !== "REMOVED" && (
          <MessageDialog
            input={r.msg}
            phone={r.phone}
            billingId={r.billingId ?? undefined}
            trigger={
              primary ? (
                <Button variant="outline" size="sm" aria-label="Gerar texto de cobrança">
                  <MessageSquareText className="h-4 w-4 mr-1" /> Cobrar
                </Button>
              ) : (
                <Button variant="ghost" size="icon" title="Gerar texto de cobrança / WhatsApp" aria-label="Gerar texto de cobrança">
                  <MessageSquareText className="h-4 w-4" />
                </Button>
              )
            }
          />
        )}
        {open && (
          <RescheduleDialog
            billingId={r.billingId!}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                title="Alterar a data de cobrança deste mês (não muda o dia recorrente)"
                aria-label="Alterar data de cobrança deste mês"
              >
                <CalendarClock className="h-4 w-4" />
              </Button>
            }
          />
        )}
      </div>
    );
  }

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
              <TableRow key={r.key} data-state={selected.has(r.key) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`Selecionar ${r.name}`}
                    checked={selected.has(r.key)}
                    onChange={() => toggleOne(r.key)}
                  />
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <span className="flex items-center gap-1.5">
                    <Link href={`/clientes/${r.clientId}`} className="font-medium hover:underline truncate">
                      {r.name}
                    </Link>
                    {(r.cycleStatus === "OVERDUE" ||
                      r.cycleStatus === "DELINQUENT" ||
                      r.cycleStatus === "PAID_LATE") && (
                      <span title="Pagamento em atraso em relação à data de vencimento." className="cursor-help">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      </span>
                    )}
                  </span>
                  {r.removedInfo && (
                    <p className="text-[11px] text-muted-foreground">{r.removedInfo}</p>
                  )}
                </TableCell>
                <TableCell>
                  <InlineSelect
                    ariaLabel={`Modalidade de ${r.name}`}
                    value={r.modality ?? ""}
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
                    action={(v) => setClientModality(r.clientId, v || null)}
                  />
                </TableCell>
                <TableCell>
                  <InlineSelect
                    ariaLabel={`Vencimento recorrente de ${r.name}`}
                    value={r.paymentDay != null ? String(r.paymentDay) : ""}
                    options={DAY_OPTIONS}
                    allowEmpty
                    emptyLabel="— definir —"
                    action={(v) =>
                      setClientPaymentDay(r.clientId, parseInt(v, 10), month, year)
                    }
                  />
                  {r.dueDateBR && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      neste mês: {r.dueDateBR}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <InlineMoney
                    ariaLabel={`Valor devido de ${r.name}`}
                    value={r.amountDue}
                    onSave={(raw) => setClientChargeAmount(r.clientId, raw, month, year)}
                  />
                </TableCell>
                <TableCell>{statusCell(r)}</TableCell>
                <TableCell>
                  <TermSelect row={r} />
                </TableCell>
                <TableCell className="text-right">{rowActions(r)}</TableCell>
              </TableRow>
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
                <Field label="Status">{statusCell(r)}</Field>
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
              <MobileCardActions>{rowActions(r, true)}</MobileCardActions>
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

/** Prazo do contrato — 1/3/6/12 meses ou personalizado. */
function TermSelect({ row }: { row: ReceivableRow }) {
  const current = row.contractMonths != null ? String(row.contractMonths) : "";
  const isPreset = TERM_OPTIONS.some((o) => o.value === current);
  const options = isPreset || !current
    ? [...TERM_OPTIONS, { value: "custom", label: "Personalizado…" }]
    : [
        ...TERM_OPTIONS,
        { value: current, label: `${current} meses` },
        { value: "custom", label: "Personalizado…" },
      ];
  return (
    <InlineSelect
      ariaLabel={`Prazo do contrato de ${row.name}`}
      value={current}
      options={options}
      allowEmpty
      emptyLabel="— definir —"
      action={async (v) => {
        if (v === "custom") {
          const raw = prompt("Prazo do contrato em meses (1 a 120):", current || "12");
          if (raw === null) return { ok: false, error: "Alteração cancelada." };
          const months = parseInt(raw, 10);
          return setClientContractMonths(row.clientId, Number.isFinite(months) ? months : null);
        }
        return setClientContractMonths(row.clientId, v ? parseInt(v, 10) : null);
      }}
    />
  );
}

/** Valor em R$ editável inline (clique → campo, Enter/sair salva). */
function InlineMoney({
  value,
  onSave,
  ariaLabel,
}: {
  value: number;
  onSave: (raw: string) => Promise<ActionResult>;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [shown, setShown] = useState(value);

  function commit() {
    const raw = draft.trim();
    setEditing(false);
    if (!raw) return;
    const prev = shown;
    start(async () => {
      const res = await onSave(raw);
      if (!res.ok) {
        setShown(prev);
        alert(res.error);
      } else {
        const parsed = Number(raw.replace(/\./g, "").replace(",", "."));
        if (Number.isFinite(parsed)) setShown(parsed);
      }
    });
  }

  if (editing) {
    return (
      <Input
        autoFocus
        aria-label={ariaLabel}
        inputMode="decimal"
        className="h-7 w-28 text-right text-sm ml-auto"
        defaultValue={shown > 0 ? shown.toFixed(2).replace(".", ",") : ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={`${ariaLabel} — clique para editar`}
      title="Clique para editar o valor"
      disabled={pending}
      onClick={() => {
        setDraft("");
        setEditing(true);
      }}
      className="font-medium tabular-nums underline-offset-4 hover:underline disabled:opacity-60"
    >
      {shown > 0 ? fmtBRL(shown) : "— definir —"}
    </button>
  );
}

function RestoreButton({ billingId, name }: { billingId: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      title="Recolocar no ciclo deste mês"
      aria-label={`Recolocar ${name} no ciclo deste mês`}
      disabled={pending}
      onClick={() => {
        if (!confirm(`Recolocar ${name} no ciclo deste mês?`)) return;
        start(async () => {
          const res = await restoreBilling(billingId);
          if (!res.ok) alert(res.error);
        });
      }}
    >
      <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
    </Button>
  );
}

// ===== Barra de ações em massa =====

type BulkDialogKind = null | "status" | "modality" | "day" | "owner";

function BulkBar({
  rows,
  month,
  year,
  onClear,
}: {
  rows: ReceivableRow[];
  month: number;
  year: number;
  onClear: () => void;
}) {
  const [dialog, setDialog] = useState<BulkDialogKind>(null);
  const [pending, start] = useTransition();

  const clientIds = Array.from(new Set(rows.map((r) => r.clientId)));
  const billingIds = rows.filter((r) => r.billingId).map((r) => r.billingId!) ;
  const count = rows.length;

  function removeFromMonth() {
    if (billingIds.length === 0) {
      alert("Nenhuma cobrança deste mês na seleção.");
      return;
    }
    const reason = prompt(
      `Remover ${billingIds.length} cobrança(s) do ciclo deste mês?\n\nOs clientes continuam na Gestão de Carteira. Motivo (opcional):`
    );
    if (reason === null) return;
    start(async () => {
      const res = await bulkRemoveFromMonth(billingIds, reason);
      if (!res.ok) alert(res.error);
      else onClear();
    });
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 print:hidden pointer-events-none">
        <div className="pointer-events-auto mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className="text-sm font-medium">
            {count} selecionado{count === 1 ? "" : "s"}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog("status")}>
              Status do mês
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("modality")}>
              Modalidade
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("day")}>
              Vencimento
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("owner")}>
              Responsável
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={pending}
              onClick={removeFromMonth}
            >
              Remover do mês
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear}>
              Cancelar
            </Button>
          </div>
        </div>
      </div>

      {dialog === "status" && (
        <BulkValueDialog
          title="Status do mês em massa"
          hint="Pagamentos são registrados individualmente (ação $ na linha)."
          count={billingIds.length}
          options={STATUS_OPTIONS.filter((o) => o.value !== "PAID")}
          onClose={() => setDialog(null)}
          onConfirm={(v) => bulkSetMonthStatus(billingIds, v as any)}
          onDone={onClear}
        />
      )}
      {dialog === "modality" && (
        <BulkValueDialog
          title="Modalidade em massa"
          hint="Atualiza também o cadastro dos clientes na Gestão de Carteira."
          count={clientIds.length}
          options={MODALITY_OPTIONS}
          onClose={() => setDialog(null)}
          onConfirm={(v) => bulkUpdateClients({ ids: clientIds, modality: v })}
          onDone={onClear}
        />
      )}
      {dialog === "day" && (
        <BulkValueDialog
          title="Vencimento recorrente em massa"
          hint="Atualiza o cadastro e a cobrança em aberto deste mês."
          count={clientIds.length}
          options={DAY_OPTIONS}
          onClose={() => setDialog(null)}
          onConfirm={async (v) => {
            const day = parseInt(v, 10);
            let okCount = 0;
            for (const id of clientIds) {
              const res = await setClientPaymentDay(id, day, month, year);
              if (res.ok) okCount++;
            }
            return okCount > 0
              ? { ok: true }
              : { ok: false, error: "Nenhum cliente pôde ser atualizado." };
          }}
          onDone={onClear}
        />
      )}
      {dialog === "owner" && (
        <BulkTextDialog
          title="Responsável em massa"
          count={clientIds.length}
          placeholder="Nome do responsável (vazio = limpar)"
          onClose={() => setDialog(null)}
          onConfirm={(v) => bulkUpdateClients({ ids: clientIds, salesOwner: v })}
          onDone={onClear}
        />
      )}
    </>
  );
}

function BulkValueDialog({
  title,
  hint,
  count,
  options,
  onConfirm,
  onClose,
  onDone,
}: {
  title: string;
  hint?: string;
  count: number;
  options: { value: string; label: string }[];
  onConfirm: (value: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Aplicar a {count} item{count === 1 ? "" : "s"} selecionado{count === 1 ? "" : "s"}.
          {hint ? ` ${hint}` : ""}
        </p>
        <Select value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Selecione…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (!value) {
                setError("Selecione um valor.");
                return;
              }
              start(async () => {
                setError(null);
                const res = await onConfirm(value);
                if (res.ok) {
                  onClose();
                  onDone();
                } else setError(res.error ?? "Falha ao atualizar.");
              });
            }}
          >
            {pending ? "Aplicando…" : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkTextDialog({
  title,
  count,
  placeholder,
  onConfirm,
  onClose,
  onDone,
}: {
  title: string;
  count: number;
  placeholder: string;
  onConfirm: (value: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Aplicar a {count} cliente{count === 1 ? "" : "s"} selecionado{count === 1 ? "" : "s"}.
        </p>
        <Input
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await onConfirm(value);
                if (res.ok) {
                  onClose();
                  onDone();
                } else setError(res.error ?? "Falha ao atualizar.");
              })
            }
          >
            {pending ? "Aplicando…" : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
