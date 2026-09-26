"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { showUndoToast } from "@/components/undo-toast";
import { applyDueScheduledStatusAction } from "@/lib/actions/client-status";

/** Reserva do job diário: aplica agora as alterações programadas já vencidas. */
export function ApplyDueButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await applyDueScheduledStatusAction();
          showUndoToast({
            message: r.ok
              ? r.atualizados
                ? `${r.atualizados} alteração(ões) programada(s) aplicada(s).`
                : "Nenhuma alteração programada pendente."
              : String(r.error),
          });
        })
      }
    >
      {pending ? "Aplicando…" : "Aplicar alterações programadas vencidas"}
    </Button>
  );
}
