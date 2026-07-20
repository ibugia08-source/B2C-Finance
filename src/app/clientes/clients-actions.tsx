"use client";
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
  setClientDelinquency,
  setClientLossReason,
  bulkUpdateClients,
  bulkDeleteClients,
} from "@/lib/actions/clients";
import type { ClientRow } from "./clients-table";

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
export function DelinquencyCell({ client }: { client: ClientRow }) {
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
        action={(v) =>
          setClientDelinquency(client.id, v || null, client.refMonth, client.refYear)
        }
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

export function BulkActionBar({
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
