"use client";
import { useState, useTransition } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { dismissRoutineItem, setRoutineActionDone } from "@/lib/actions/routine";
import { setExpenseDueDate } from "@/lib/actions/expenses";
import { EyeOff, CalendarClock } from "lucide-react";

/**
 * Controles da ROTINA DIÁRIA:
 *  - DismissButton: "Remover da rotina de hoje" (só oculta da lista do dia;
 *    confirma com motivo opcional; nunca apaga cliente/cobrança/despesa).
 *  - ActionCheck: checkbox do checklist "Ações de hoje" (persistido por dia).
 *  - ExpenseDueDateDialog: "Alterar vencimento" de uma despesa (só esta).
 */

const DISMISS_REASONS = [
  "Já foi cobrado fora da plataforma",
  "Vou cobrar depois",
  "Cliente pediu novo prazo",
  "Não se aplica hoje",
  "Outro motivo",
];

export function DismissButton({
  itemType,
  itemKey,
  itemLabel,
}: {
  itemType: "cobranca" | "pagamento";
  itemKey: string;
  itemLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setReason(""); } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Remover da rotina de hoje">
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Remover da rotina de hoje</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            <strong className="text-foreground">{itemLabel}</strong> será apenas
            ocultado da rotina de hoje. Nada é apagado ou alterado no cadastro,
            nas cobranças ou no financeiro — amanhã ele volta, se ainda pendente.
          </p>
          <div>
            <Label>Motivo (opcional)</Label>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">—</option>
              {DISMISS_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </div>
          {error && <p className="text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await dismissRoutineItem(itemType, itemKey, reason || null);
                if (res.ok) setOpen(false);
                else setError(res.error);
              })
            }
          >
            {pending ? "Removendo…" : "Remover de hoje"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ActionCheck({
  itemKey,
  done,
  children,
}: {
  itemKey: string;
  done: boolean;
  children: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  return (
    <div
      className={`flex items-start gap-2.5 text-sm ${
        done ? "text-muted-foreground line-through" : ""
      } ${pending ? "opacity-60" : ""}`}
    >
      <span className="mt-0.5">
        <Checkbox
          checked={done}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              await setRoutineActionDone(itemKey, e.target.checked);
            })
          }
          aria-label={done ? "Reabrir ação" : "Concluir ação"}
          title={done ? "Reabrir ação" : "Concluir ação"}
        />
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function ExpenseDueDateDialog({
  expenseId,
  description,
  currentDue,
}: {
  expenseId: string;
  description: string;
  /** YYYY-MM-DD atual (ou vazio) */
  currentDue: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentDue);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Alterar vencimento">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Alterar vencimento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground truncate">{description}</p>
          <div>
            <Label>Novo vencimento</Label>
            <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
            <p className="text-[11px] text-muted-foreground mt-1">
              Altera apenas esta despesa/ocorrência.
            </p>
          </div>
          {error && <p className="text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={pending || !value}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await setExpenseDueDate(expenseId, value);
                if (res.ok) setOpen(false);
                else setError(res.error);
              })
            }
          >
            {pending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
