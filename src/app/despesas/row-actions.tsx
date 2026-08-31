"use client";
import { showUndoToast } from "@/components/undo-toast";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { ExpenseDialog } from "./expense-dialog";
import { Pencil, Trash2, CheckCircle2, CircleOff } from "lucide-react";
import { deleteExpense, setExpenseStatus, endRecurrence } from "@/lib/actions/expenses";
import { useTransition } from "react";

type CardOpt = { id: string; name: string };
type CategoryOpt = { id: string; name: string };

export function ExpenseActions({
  expense,
  cards = [],
  categories = [],
}: {
  expense: any;
  cards?: CardOpt[];
  categories?: CategoryOpt[];
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
              if (!res.ok) showUndoToast({ message: String(res.error) });
            })
          }
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        </Button>
      )}
      <ExpenseDialog
        initial={expense}
        cards={cards}
        categories={categories}
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
          onClick={async () => {
            if (!(await confirmAction({ title: "Encerrar a recorrência? As ocorrências futuras não pagas serão removidas.", destructive: true }))) return;
            start(async () => {
              const res = await endRecurrence(expense.recurrenceGroupId);
              if (!res.ok) showUndoToast({ message: String(res.error) });
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
        onClick={async () => {
          if (isRecurring) {
            // O confirm nativo só tinha OK/Cancelar, então a pergunta virava
            // um enigma ("OK = tudo, Cancelar = só esta"). Com rótulos de
            // verdade, cada botão diz o que faz.
            const all = await confirmAction({
              title: "Excluir toda a recorrência?",
              description:
                "Esta despesa se repete. Você pode apagar todas as ocorrências ainda não pagas ou somente esta.",
              confirmLabel: "Excluir todas",
              cancelLabel: "Só esta",
              destructive: true,
            });
            if (all) {
              start(async () => {
                const res = await deleteExpense(expense.id, "group");
                if (!res.ok) showUndoToast({ message: String(res.error) });
              });
              return;
            }
            if (!(await confirmAction({ title: "Excluir somente esta ocorrência?", destructive: true }))) return;
            start(async () => {
              const res = await deleteExpense(expense.id, "one");
              if (!res.ok) showUndoToast({ message: String(res.error) });
            });
            return;
          }
          if (!(await confirmAction({ title: "Excluir esta despesa?", destructive: true }))) return;
          start(async () => {
            const res = await deleteExpense(expense.id);
            if (!res.ok) showUndoToast({ message: String(res.error) });
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
