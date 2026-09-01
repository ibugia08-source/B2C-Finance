"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { showUndoToast } from "@/components/undo-toast";
import { askReason } from "@/components/ui/confirm-dialog";
import { PauseCircle, PlayCircle, RotateCcw } from "lucide-react";
import {
  pausarClienteAction, reativarClienteAction, retomarClienteAction,
} from "@/lib/actions/lifecycle";

/**
 * Pausar · Retomar · Reativar (F1.16 · 01 §3.9).
 *
 * Botões, e não um select: cada gesto tem consequência de domínio (fechar o
 * termo vigente, abrir termo novo, encerrar o churn) e pede um PORQUÊ — a
 * linha do tempo mostra o motivo para sempre.
 */
export function LifecycleActions({
  clientId,
  status,
}: {
  clientId: string;
  status: string;
}) {
  const [pending, start] = useTransition();

  const executar = async (
    titulo: string,
    descricao: string,
    rotulo: string,
    action: (id: string, motivo?: string) => Promise<{ ok: boolean; error?: string }>
  ) => {
    const motivo = await askReason({
      title: titulo,
      description: descricao,
      motivo: { label: "Por quê? (fica registrado na linha do tempo)", minimo: 5 },
      confirmLabel: rotulo,
    });
    if (!motivo) return;
    start(async () => {
      const r = await action(clientId, motivo);
      showUndoToast({ message: r.ok ? `${rotulo} — feito.` : (r as any).error });
    });
  };

  if (status === "PAUSED") {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          executar(
            "Retomar este cliente?",
            "A mensalidade volta a ser gerada e um novo período de preço começa hoje, com o último valor. Reajuste depois, se for o caso, em Preço e termos.",
            "Retomar",
            retomarClienteAction
          )
        }
      >
        <PlayCircle className="mr-1.5 h-4 w-4" aria-hidden />
        Retomar
      </Button>
    );
  }
  if (status === "CHURNED") {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          executar(
            "Reativar este cliente?",
            "A saída é encerrada e o cliente volta ativo NA MESMA ficha, com todo o histórico. Um novo período de preço começa hoje, com o último valor.",
            "Reativar",
            reativarClienteAction
          )
        }
      >
        <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />
        Reativar
      </Button>
    );
  }
  if (["ACTIVE", "RENEWAL", "DELINQUENT", "ONBOARDING"].includes(status)) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          executar(
            "Pausar este cliente?",
            "A mensalidade deixa de ser gerada a partir de agora e o período de preço vigente é encerrado. As cobranças já emitidas continuam valendo.",
            "Pausar",
            pausarClienteAction
          )
        }
      >
        <PauseCircle className="mr-1.5 h-4 w-4" aria-hidden />
        Pausar
      </Button>
    );
  }
  return null;
}
