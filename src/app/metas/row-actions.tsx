"use client";
import { Button } from "@/components/ui/button";
import { GoalDialog } from "./goal-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteGoal } from "@/lib/actions/goals";
import { useTransition } from "react";

export function GoalRowActions({ goal }: { goal: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1">
      <GoalDialog
        initial={goal}
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
          if (!confirm("Excluir esta meta?")) return;
          start(() => deleteGoal(goal.id));
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
