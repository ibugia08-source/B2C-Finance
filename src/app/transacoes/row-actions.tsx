"use client";
import { Button } from "@/components/ui/button";
import { TransactionDialog } from "./transaction-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteTransaction } from "@/lib/actions/transactions";
import { useTransition } from "react";

export function TransactionRowActions({
  tx,
  cards,
  people,
  categories,
  accounts,
}: {
  tx: any;
  cards: any[];
  people: any[];
  categories: any[];
  accounts: any[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-1">
      <TransactionDialog
        cards={cards}
        people={people}
        categories={categories}
        accounts={accounts}
        initial={tx}
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
          if (!confirm("Excluir esta transação?")) return;
          start(() => deleteTransaction(tx.id));
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
