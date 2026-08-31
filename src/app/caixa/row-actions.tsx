"use client";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { CashBoxDialog } from "./cashbox-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteCashBox, deleteCashMovement } from "@/lib/actions/cashboxes";
import { useTransition } from "react";

export function CashBoxActions({
  box,
  accounts,
}: {
  box: any;
  accounts: any[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1">
      <CashBoxDialog
        accounts={accounts}
        initial={box}
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
          if (!(await confirmAction({ title: "Excluir este caixa? As movimentações serão perdidas.", destructive: true }))) return;
          start(() => deleteCashBox(box.id));
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

export function MovementDeleteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={pending}
      onClick={async () => {
        if (!(await confirmAction({ title: "Excluir movimentação?", destructive: true }))) return;
        start(() => deleteCashMovement(id));
      }}
    >
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}
