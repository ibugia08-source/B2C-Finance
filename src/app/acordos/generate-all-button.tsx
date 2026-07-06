"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Receipt } from "lucide-react";
import { generateAllBillings } from "@/lib/actions/contracts";

/** Gera as cobranças do mês para todos os contratos vigentes. */
export function GenerateAllButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await generateAllBillings();
            setMsg(
              res.ok
                ? `${res.created ?? 0} cobrança(s) gerada(s) ✅`
                : res.error
            );
          })
        }
      >
        <Receipt className="h-4 w-4 mr-1" />
        {pending ? "Gerando…" : "Gerar cobranças do mês"}
      </Button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
