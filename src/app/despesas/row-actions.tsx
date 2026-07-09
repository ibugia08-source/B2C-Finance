"use client";
import { Button } from "@/components/ui/button";
import { ExpenseDialog } from "./expense-dialog";
import { Pencil, Trash2, CheckCircle2, CircleOff } from "lucide-react";
import { deleteExpense, setExpenseStatus, endRecurrence } from "@/lib/actions/expenses";
import { useTransition } from "react";

type CardOpt = { id: string; name: string };

export function ExpenseActions({
  expense,
  cards = [],
}: {
  expense: any;
  cards?: CardOpt[];
}) {
  const [pending, start] = useTransition();
  const isRecurring = Boolean(expense.recurrenceGroupId);

  return (
    <div className="flex justify-end gap-1">
      {expense.status !== "pago" && (
        <Button
          variant="ghost"
          size="icon"
          title="Marcar como paga"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setExpenseStatus(expense.id, "pago");
              if (!res.ok) alert(res.error);
            })
          }
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        </Button>
      )}
      <ExpenseDialog
        initial={expense}
        cards={cards}
        trigger={
          <Button variant="ghost" size="icon" title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      {isRecurring && (
        <Button
          variant="ghost"
          size="icon"
          title="Encerrar recorrência (remove futuras não pagas)"
          disabled={pending}
          onClick={() => {
            if (!confirm("Encerrar a recorrência? As ocorrências futuras não pagas serão removidas.")) return;
            start(async () => {
              const res = await endRecurrence(expense.recurrenceGroupId);
              if (!res.ok) alert(res.error);
            });
          }}
        >
          <CircleOff className="h-4 w-4 text-amber-600" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        title="Excluir"
        disabled={pending}
        onClick={() => {
          if (isRecurring) {
            const all = confirm(
              "Despesa recorrente.\n\nOK = excluir TODA a recorrência (não pagas)\nCancelar = escolher só esta"
            );
            if (all) {
              start(async () => {
                const res = await deleteExpense(expense.id, "group");
                if (!res.ok) alert(res.error);
              });
              return;
            }
            if (!confirm("Excluir somente esta ocorrência?")) return;
            start(async () => {
              const res = await deleteExpense(expense.id, "one");
              if (!res.ok) alert(res.error);
            });
            return;
          }
          if (!confirm("Excluir esta despesa?")) return;
          start(async () => {
            const res = await deleteExpense(expense.id);
            if (!res.ok) alert(res.error);
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
