"use client";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { useTransition, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { InlineSelect } from "./inline-select";
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABEL,
  DELINQUENCY_VALUES,
  DELINQUENCY_LABEL,
  MONTHS,
  clientStatusPill,
  delinquencyPill,
  type DelinquencyValue,
} from "./_meta";
import {
  setClientLossReason,
  setClientQuickNotes,
  bulkUpdateClients,
  bulkDeleteClients,
} from "@/lib/actions/clients";
import { setClientMonthPayment } from "@/lib/actions/receivables-inline";
import { undoQuickSettle } from "@/lib/actions/billings";
import { showUndoToast } from "@/components/undo-toast";
import type { ClientRow } from "./clients-table";
import { FloatingActionBar } from "@/components/ui/floating-action-bar";

const STATUS_OPTIONS = CLIENT_STATUSES.filter((s) => s !== "LEAD").map((s) => ({
  value: s,
  label: CLIENT_STATUS_LABEL[s],
}));
const DELINQUENCY_OPTIONS = DELINQUENCY_VALUES.map((d) => ({
  value: d,
  label: DELINQUENCY_LABEL[d],
}));
const MONTH_OPTIONS = MONTHS.map((m) => ({ value: String(m.value), label: m.label }));

/**
 * Motivo da perda (opcional) — aparece logo após marcar um cliente como
 * Perdido na linha. A perda já foi registrada; aqui só complementamos o
 * motivo no registro mais recente.
 */
export function LossReasonDialog({
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
      if (!res.ok) showUndoToast({ message: String(res.error) });
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
 * Pagamento do mês editável inline — agora REAL (fim dos dois "pagos"):
 *  - Pago → registra o pagamento pelo núcleo contábil (1 clique + Desfazer);
 *  - Devendo → marca a cobrança como Inadimplente;
 *  - limpar → volta para A vencer.
 * Se o mês ainda não tem cobrança, ela é criada do cadastro na hora
 * (preencher a célula É o registro, como na planilha). Reflete em
 * Recebimentos, Inadimplência e Dashboard imediatamente.
 */
export function DelinquencyCell({ client }: { client: ClientRow }) {
  const options = [...DELINQUENCY_OPTIONS];
  return (
    <div className="inline-flex flex-col gap-0.5">
      <InlineSelect
        ariaLabel={`Pagamento do mês de ${client.name}`}
        value={
          client.delinquency.value === "SEM_COBRANCA" ? "" : client.delinquency.value
        }
        options={options}
        pillClass={(v) => delinquencyPill((v || "SEM_COBRANCA") as any)}
        allowEmpty
        emptyLabel={DELINQUENCY_LABEL.SEM_COBRANCA}
        action={async (v) => {
          const res = await setClientMonthPayment(
            client.id,
            (v || null) as "PAGO" | "DEVENDO" | null,
            client.refMonth,
            client.refYear
          );
          if (res.ok && v === "PAGO") {
            const paymentId = res.id;
            showUndoToast({
              message: `${client.name}: pagamento do mês registrado.`,
              onUndo: paymentId ? () => undoQuickSettle(paymentId) : undefined,
            });
          }
          return res;
        }}
      />
      {client.delinquency.manual && (
        <span className="text-[10px] text-muted-foreground">
          manual{client.delinquency.by ? ` · ${client.delinquency.by}` : ""}
        </span>
      )}
    </div>
  );
}

/**
 * Observação rápida da linha (coluna Obs da planilha): mostra o texto
 * truncado; clique abre um dialog leve com Textarea → Client.notes.
 */
export function NotesCell({ client }: { client: ClientRow }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const has = !!(client.notes && client.notes.trim());

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={has ? client.notes ?? "" : "Adicionar observação"}
        className={`block max-w-[220px] truncate rounded px-1.5 py-0.5 text-left text-xs hover:bg-accent ${
          has ? "" : "text-muted-foreground/70 italic"
        }`}
      >
        {has ? client.notes : "— obs —"}
      </button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Observações — {client.name}</DialogTitle>
          </DialogHeader>
          <form
            action={(fd) =>
              start(async () => {
                setError(null);
                const res = await setClientQuickNotes(
                  client.id,
                  String(fd.get("notes") ?? "")
                );
                if (res.ok) setOpen(false);
                else setError(res.error);
              })
            }
            className="space-y-3"
          >
            <Textarea
              name="notes"
              rows={4}
              defaultValue={client.notes ?? ""}
              placeholder="ex.: pagamento de fevereiro será diluído nos próximos meses"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando…" : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ===== Barra de ações em massa =====

type BulkDialog = null | "status" | "owner" | "renewal";

export function BulkActionBar({
  ids,
  count,
  onClear,
  canDelete = true,
}: {
  ids: string[];
  count: number;
  onClear: () => void;
  /** Sem clientes.excluir → botão Excluir não aparece (backend também bloqueia). */
  canDelete?: boolean;
}) {
  const [dialog, setDialog] = useState<BulkDialog>(null);
  const [pending, start] = useTransition();

  async function runDelete() {
    if (
      !(await confirmAction({
        title: `Excluir ${count} cliente${count === 1 ? "" : "s"} selecionado${count === 1 ? "" : "s"}?`,
        description: "Não dá para desfazer.",
        confirmLabel: "Excluir",
        destructive: true,
      }))
    )
      return;
    start(async () => {
      const res = await bulkDeleteClients(ids);
      if (!res.ok) showUndoToast({ message: String(res.error) });
      else onClear();
    });
  }

  return (
    <>
      <FloatingActionBar>
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
            {canDelete && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={pending}
                onClick={runDelete}
              >
                <Trash2 className="h-4 w-4 mr-1" /> Excluir
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClear}>
              Cancelar
            </Button>
          </div>
        </div>
      </FloatingActionBar>

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

  function submeter() {
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
          <Button onClick={submeter} disabled={pending}>
            {pending ? "Aplicando…" : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
