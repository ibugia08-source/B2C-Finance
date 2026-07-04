"use client";
import { Button } from "@/components/ui/button";
import { CardDialog } from "./card-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteCard } from "@/lib/actions/cards";
import { useTransition } from "react";

export function CardRowActions({
  card,
  people,
  accounts,
}: {
  card: any;
  people: any[];
  accounts?: any[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1">
      <CardDialog
        people={people}
        accounts={accounts}
        initial={card}
        trigger={
          <Button variant="ghost" size="icon" title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => {
          if (!confirm("Excluir este cartão?")) return;
          start(() => deleteCard(card.id));
        }}
        title="Excluir"
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
