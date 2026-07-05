"use client";
import { Button } from "@/components/ui/button";
import { PlanDialog } from "./plan-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deletePlan } from "@/lib/actions/plans";
import { useTransition } from "react";

export function PlanActions({
  plan,
  services,
}: {
  plan: any;
  services: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <PlanDialog
        services={services}
        initial={plan}
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
          if (!confirm(`Excluir o plano "${plan.name}"?`)) return;
          start(async () => {
            const res = await deletePlan(plan.id);
            if (!res.ok) alert(res.error);
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
