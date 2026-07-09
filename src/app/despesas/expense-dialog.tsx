"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveExpense } from "@/lib/actions/expenses";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";

export const EXPENSE_TYPE_LABEL: Record<string, string> = {
  FIXED: "Fixa",
  VARIABLE: "Variável",
  CARD: "Cartão de crédito",
  TAX: "Imposto",
  PAYROLL: "Folha",
  TOOL: "Ferramenta",
  ADS: "Mídia / Ads",
  LOAN: "Empréstimo",
  OTHER: "Outros",
};

export const RECURRENCE_LABEL: Record<string, string> = {
  NONE: "Não recorrente",
  MONTHLY: "Mensal",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
  CUSTOM: "Personalizada",
};

type CardOpt = { id: string; name: string };

/**
 * Cadastro SIMPLES de despesa: nome, descrição, valor, vencimento,
 * recorrência, status e tipo. Tipo "Cartão de crédito" abre a associação
 * com o cartão + mês da fatura (fechamento/vencimento vêm do cartão).
 */
export function ExpenseDialog({
  cards = [],
  initial,
  trigger,
}: {
  cards?: CardOpt[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [expenseType, setExpenseType] = useState<string>(initial?.expenseType ?? "OTHER");
  const [recurrence, setRecurrence] = useState<string>(initial?.recurrence ?? "NONE");
  const isEditRecurring = Boolean(initial?.recurrenceGroupId);

  const fmt = (v: any) => (v != null ? Number(v).toFixed(2).replace(".", ",") : "");
  const invoiceRef =
    initial?.cardInvoiceYear && initial?.cardInvoiceMonth
      ? `${initial.cardInvoiceYear}-${String(initial.cardInvoiceMonth).padStart(2, "0")}`
      : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova despesa
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar despesa" : "Nova despesa"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await saveExpense(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div className="col-span-full">
            <Label>Nome da despesa *</Label>
            <Input
              name="description"
              defaultValue={initial?.description ?? ""}
              placeholder="ex.: Meta Ads, aluguel, ferramenta X"
              required
            />
          </div>

          <div>
            <Label>Valor total (R$) *</Label>
            <Input
              name="amount"
              inputMode="decimal"
              placeholder="0,00"
              defaultValue={fmt(initial?.amount)}
              required
            />
          </div>
          <div>
            <Label>Vencimento *</Label>
            <Input
              type="date"
              name="dueDate"
              defaultValue={initial?.dueDate ? formatDateInput(initial.dueDate) : ""}
              required
            />
          </div>

          <div>
            <Label>Tipo</Label>
            <Select
              name="expenseType"
              value={expenseType}
              onChange={(e) => setExpenseType(e.target.value)}
            >
              {Object.entries(EXPENSE_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select name="status" defaultValue={initial?.status ?? "pendente"}>
              <option value="pendente">Pendente</option>
              <option value="pago">Paga</option>
              <option value="cancelado">Cancelada</option>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              &quot;Vencida&quot; é automática ao passar do vencimento.
            </p>
          </div>

          <div>
            <Label>Recorrência</Label>
            <Select
              name="recurrence"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              disabled={Boolean(initial?.id)}
            >
              {Object.entries(RECURRENCE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            {initial?.id && (
              <p className="text-[11px] text-muted-foreground mt-1">
                A recorrência é definida na criação.
              </p>
            )}
          </div>
          {recurrence === "CUSTOM" && !initial?.id ? (
            <div>
              <Label>A cada quantos meses?</Label>
              <Input
                type="number"
                name="recurrenceInterval"
                min={1}
                max={24}
                defaultValue={initial?.recurrenceInterval ?? 2}
              />
            </div>
          ) : (
            <div className="hidden sm:block" />
          )}

          {expenseType === "CARD" && (
            <div className="col-span-full rounded-lg border bg-muted/30 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Cartão / conta</Label>
                <Select name="cardId" defaultValue={initial?.cardId ?? ""}>
                  <option value="">—</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Mês da fatura</Label>
                <Input type="month" name="cardInvoiceRef" defaultValue={invoiceRef} />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Fechamento e vencimento vêm da configuração do cartão.
                </p>
              </div>
            </div>
          )}

          <div className="col-span-full">
            <Label>Descrição</Label>
            <Textarea
              name="notes"
              defaultValue={initial?.notes ?? ""}
              placeholder="detalhes da despesa (opcional)"
            />
          </div>

          {isEditRecurring && (
            <div className="col-span-full">
              <Label>Aplicar edição a</Label>
              <Select name="scope" defaultValue="one">
                <option value="one">Somente esta ocorrência</option>
                <option value="future">Esta e as próximas (não pagas)</option>
              </Select>
            </div>
          )}

          {error && <p className="col-span-full text-sm text-destructive">{error}</p>}

          <DialogFooter className="col-span-full">
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
  );
}
