"use client";
import { useTransition, useState } from "react";
import { Trash2, RotateCcw } from "lucide-react";
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
import { InlineSelect } from "@/app/clientes/inline-select";
import { PaymentDialog } from "./payment-dialog";
import { MessageDialog } from "./message-dialog";
import { RescheduleDialog } from "./note-dialog";
import { DollarSign, MessageSquareText, CalendarClock } from "lucide-react";
import { setClientContractMonths, bulkSetMonthStatus, bulkRemoveClientsFromList } from "@/lib/actions/receivables-inline";
import { FloatingActionBar } from "@/components/ui/floating-action-bar";
import { bulkUpdateClients } from "@/lib/actions/clients";
import { restoreBilling } from "@/lib/actions/billings";
import type { ActionResult } from "@/lib/actions/clients";
import type { ReceivableRow } from "./receivables-table";

const MODALITY_OPTIONS = [
  { value: "MRR", label: "MRR" },
  { value: "TCV", label: "TCV" },
];

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
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

// Pills de status com par dark: — sem ele, fundo claro + texto escuro ficava
// ilegível no tema escuro.
const STATUS_PILL: Record<string, string> = {
  UPCOMING:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  PAID: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  PAID_LATE:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  PAID_OTHER_MONTH:
    "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-500/10 dark:text-slate-300 dark:border-slate-500/30",
  OVERDUE:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
  DELINQUENT:
    "bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/40",
  PARTIAL:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  REMOVED: "bg-muted text-muted-foreground border-transparent",
  NO_CHARGE: "bg-muted text-muted-foreground border-transparent",
};

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function statusSelectValue(cycleStatus: string): string {
  if (["PAID", "PAID_LATE", "PAID_OTHER_MONTH"].includes(cycleStatus)) return "PAID";
  if (cycleStatus === "PARTIAL") return "UPCOMING";
  return cycleStatus;
}

export function StatusCell({
  row,
  onStatusChange,
}: {
  row: ReceivableRow;
  onStatusChange: (row: ReceivableRow) => (v: string) => Promise<ActionResult>;
}) {
  if (row.cycleStatus === "REMOVED")
    return (
      <div className="inline-flex items-center gap-1.5">
        <Badge variant="outline">Removido do mês</Badge>
        <RestoreButton billingId={row.billingId!} name={row.name} />
      </div>
    );
  if (row.cycleStatus === "NO_CHARGE")
    return (
      <span
        className="inline-flex items-center rounded-full border bg-muted px-2.5 h-6 text-xs text-muted-foreground"
        title="Cliente MRR ativo ainda sem mensalidade gerada neste mês (defina o valor mensal no cadastro)."
      >
        Sem cobrança no mês
      </span>
    );
  return (
    <div className="inline-flex flex-col gap-0.5">
      <InlineSelect
        ariaLabel={`Status de ${row.name} no mês`}
        value={statusSelectValue(row.cycleStatus)}
        options={STATUS_OPTIONS}
        pillClass={() => STATUS_PILL[row.cycleStatus] ?? STATUS_PILL.UPCOMING}
        action={onStatusChange(row)}
      />
      <span className="text-[10px] text-muted-foreground">
        {row.cycleStatus === "OVERDUE" || row.cycleStatus === "DELINQUENT" ? (
          <span className="text-destructive font-medium">
            ! {row.daysLate} dia{row.daysLate === 1 ? "" : "s"} em atraso
          </span>
        ) : row.cycleStatus === "PAID_LATE" ? (
          `! pago com ${row.daysLate} dia${row.daysLate === 1 ? "" : "s"} de atraso`
        ) : row.cycleStatus === "PAID_OTHER_MONTH" ? (
          "inadimplência regularizada em outro mês"
        ) : row.cycleStatus === "PARTIAL" ? (
          `${fmtBRL(row.openAmount)} em aberto`
        ) : row.paidAtBR ? (
          `pago em ${row.paidAtBR}`
        ) : (
          "Em dia"
        )}
      </span>
    </div>
  );
}

export function TermSelect({ row }: { row: ReceivableRow }) {
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

export function InlineMoney({
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

export function DeletePaymentButton({
  row,
  primary = false,
}: {
  row: ReceivableRow;
  primary?: boolean;
}) {
  const [pending, start] = useTransition();
  function run() {
    if (
      !confirm(
        `Excluir o(s) pagamento(s) de ${row.name} (${fmtBRL(row.amountDue)})?\n\nA cobrança volta a ficar em aberto/vencida e os valores saem de "Recebido". Esta ação não pode ser desfeita.`
      )
    )
      return;
    start(async () => {
      const res = await deleteBillingPayments(row.billingId!);
      if (!res.ok) alert(res.error);
    });
  }
  return primary ? (
    <Button
      variant="outline"
      size="sm"
      className="text-destructive"
      aria-label="Excluir pagamento"
      disabled={pending}
      onClick={run}
    >
      <Trash2 className="h-4 w-4 mr-1" /> Excluir pagamento
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="icon"
      title="Excluir pagamento (reabre a cobrança)"
      aria-label="Excluir pagamento"
      disabled={pending}
      onClick={run}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

export function RestoreButton({ billingId, name }: { billingId: string; name: string }) {
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

export function RowActions({
  row,
  accounts,
  primary = false,
}: {
  row: ReceivableRow;
  accounts: { id: string; name: string }[];
  primary?: boolean;
}) {
  const open = row.billingId && !["PAID", "PAID_LATE", "PAID_OTHER_MONTH", "REMOVED", "NO_CHARGE"].includes(row.cycleStatus);
  const paid = row.billingId && ["PAID", "PAID_LATE", "PAID_OTHER_MONTH"].includes(row.cycleStatus);
  return (
    <div className="flex gap-0.5 justify-end flex-wrap items-center">
      {paid && <DeletePaymentButton row={row} primary={primary} />}
      {open && (
        <PaymentDialog
          billing={{ id: row.billingId!, openAmount: row.openAmount, description: row.description ?? row.name }}
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
      {row.cycleStatus !== "REMOVED" && (
        <MessageDialog
          input={row.msg}
          phone={row.phone}
          billingId={row.billingId ?? undefined}
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
          billingId={row.billingId!}
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

// ===== Barra de ações em massa =====

type BulkDialogKind = null | "status" | "modality" | "day" | "owner";

export function BulkBar({
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
  const billingIds = rows.filter((r) => r.billingId).map((r) => r.billingId!);
  const count = rows.length;

  function removeFromMonth() {
    const reason = prompt(
      `Remover ${count} cliente(s) selecionado(s) da lista deste mês?\n\nEles continuam na Gestão de Carteira e podem ser recolocados em "Removidos do mês". Motivo (opcional):`
    );
    if (reason === null) return;
    start(async () => {
      const res = await bulkRemoveClientsFromList(
        rows.map((r) => ({ clientId: r.clientId, billingId: r.billingId })),
        month,
        year,
        reason
      );
      if (!res.ok) alert(res.error);
      else onClear();
    });
  }

  return (
    <>
      <FloatingActionBar>
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
              Remover da lista
            </Button>
            <Button size="sm" variant="ghost" onClick={onClear}>
              Cancelar
            </Button>
          </div>
        </div>
      </FloatingActionBar>

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
            const { setClientPaymentDay } = await import("@/lib/actions/receivables-inline");
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

// Import missing from receivables-inline
async function deleteBillingPayments(billingId: string) {
  const { deleteBillingPayments: dbp } = await import("@/lib/actions/receivables-inline");
  return dbp(billingId);
}
