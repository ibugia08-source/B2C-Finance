"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { generateContractBillings } from "@/lib/actions/contracts";
import { Receipt, Check } from "lucide-react";

/**
 * Botão visível ao lado do cliente na listagem de acordos: gera as
 * cobranças pendentes do contrato daquele cliente em 1 clique.
 * Idempotente — só cria as parcelas que ainda não existem.
 */
export function GenerateClientBillingsButton({ contractId }: { contractId: string }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setFeedback(null);
            const res = await generateContractBillings(contractId);
            setFeedback(
              res.ok
                ? (res.created ?? 0) > 0
                  ? `${res.created} gerada(s)`
                  : "em dia"
                : res.error
            );
          })
        }
      >
        <Receipt className="h-3.5 w-3.5 mr-1" />
        {pending ? "Gerando…" : "Gerar cobranças"}
      </Button>
      {feedback && (
        <span className="text-[11px] text-emerald-600 inline-flex items-center gap-0.5">
          <Check className="h-3 w-3" /> {feedback}
        </span>
      )}
    </span>
  );
}
