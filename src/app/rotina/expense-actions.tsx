"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { setExpenseStatus } from "@/lib/actions/expenses";

/**
 * Ação rápida da Rotina: marcar despesa como paga sem sair da tela.
 * Atualiza Despesas/Dashboard/Rotina via revalidate da própria action.
 */
export function MarkExpensePaid({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Marcar como paga"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await setExpenseStatus(id, "pago");
            if (!res.ok) setError(res.error);
          })
        }
      >
        <CheckCircle2 className={`h-4 w-4 ${pending ? "text-muted-foreground" : "text-emerald-600"}`} />
      </Button>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </span>
  );
}
