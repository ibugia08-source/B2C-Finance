"use client";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { IncomeDialog } from "./income-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteIncome } from "@/lib/actions/incomes";
import { useTransition } from "react";

export function IncomeActions({
  income,
  accounts,
  people,
  categories,
  clients = [],
  contracts = [],
}: {
  income: any;
  accounts: any[];
  people: any[];
  categories: any[];
  clients?: any[];
  contracts?: any[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <IncomeDialog
        accounts={accounts}
        people={people}
        categories={categories}
        clients={clients}
        contracts={contracts}
        initial={income}
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
        onClick={async () => {
          if (!(await confirmAction({ title: "Excluir receita?", destructive: true }))) return;
          start(() => deleteIncome(income.id));
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
