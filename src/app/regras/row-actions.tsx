"use client";
import { Button } from "@/components/ui/button";
import { RuleDialog } from "./rule-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteRule } from "@/lib/actions/rules";
import { useTransition } from "react";

export function RuleRowActions({ rule, categories, cards }: { rule: any; categories: any[]; cards: any[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <RuleDialog
        categories={categories}
        cards={cards}
        initial={rule}
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
          if (!confirm("Excluir esta regra?")) return;
          start(() => deleteRule(rule.id));
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
