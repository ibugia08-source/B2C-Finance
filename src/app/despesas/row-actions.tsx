"use client";
import { Button } from "@/components/ui/button";
import { ExpenseDialog } from "./expense-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteExpense } from "@/lib/actions/expenses";
import { useTransition } from "react";

export function ExpenseActions({
  expense,
  people,
  categories,
  accounts,
  clients = [],
  services = [],
}: {
  expense: any;
  people: any[];
  categories: any[];
  accounts: any[];
  clients?: any[];
  services?: any[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-1">
      <ExpenseDialog
        initial={expense}
        people={people}
        categories={categories}
        accounts={accounts}
        clients={clients}
        services={services}
        trigger={
          <Button variant="ghost" size="icon">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => {
          if (!confirm("Excluir esta despesa?")) return;
          start(() => deleteExpense(expense.id));
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
