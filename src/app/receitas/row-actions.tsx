"use client";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { IncomeDialog } from "./income-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteIncome } from "@/lib/actions/incomes";
import { useTransition } from "react";
import { showUndoToast } from "@/components/undo-toast";

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
  // Espelho de pagamento de cobrança: não se edita por aqui (o servidor
  // recusa) — a correção é estornar o pagamento na Gestão do Mês.
  const espelho = Boolean(income?.billingId || income?.paymentId);
  return (
    <div className="flex gap-1 justify-end">
      {espelho ? (
        <Button
          variant="ghost"
          size="icon"
          disabled
          aria-label="Entrada de pagamento de cobrança — edite pelo pagamento"
          title="Espelho de um pagamento de cobrança: para corrigir, exclua o pagamento na Gestão do Mês e registre de novo."
        >
          <Pencil className="h-4 w-4 opacity-40" />
        </Button>
      ) : (
      <IncomeDialog
        accounts={accounts}
        people={people}
        categories={categories}
        clients={clients}
        contracts={contracts}
        initial={income}
        trigger={
          <Button variant="ghost" size="icon" aria-label="Editar receita">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Excluir receita"
        disabled={pending}
        onClick={async () => {
          if (!(await confirmAction({ title: "Excluir receita?", destructive: true }))) return;
          start(async () => {
            const res = await deleteIncome(income.id);
            if (res && !res.ok) showUndoToast({ message: res.error });
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
