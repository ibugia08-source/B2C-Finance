"use client";
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * CONFIRMAÇÃO NO TEMA DO SISTEMA (T3 · ref. 02 §7.6).
 *
 * Substitui o `confirm()` nativo, que ignora tema, tipografia e idioma do
 * produto, não é estilizável e no mobile aparece como caixa do sistema
 * operacional com o domínio do site — o oposto do que 02 §7.6 pede.
 *
 * A API é a mesma do nativo, de propósito, para a troca ser mecânica:
 *
 *     if (!(await confirmAction({ title: "Excluir despesa?" }))) return;
 *
 * 02 §7.6 também limita o uso: "modal de confirmação só para o
 * irreversível real, com a consequência escrita em uma frase". Por isso
 * `description` existe e deve ser preenchida quando a ação apaga algo.
 */

export type ConfirmOptions = {
  title: string;
  /** A consequência, em uma frase. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Ação destrutiva: botão em vermelho. */
  destructive?: boolean;
};

type Pedido = ConfirmOptions & { resolve: (v: boolean) => void };

let listener: ((p: Pedido) => void) | null = null;

/** Pergunta ao usuário. Resolve `false` se o host não estiver montado. */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (!listener) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => listener!({ ...opts, resolve }));
}

export function ConfirmDialogHost() {
  const [pedido, setPedido] = useState<Pedido | null>(null);

  useEffect(() => {
    listener = (p) => setPedido(p);
    return () => {
      listener = null;
    };
  }, []);

  function responder(valor: boolean) {
    pedido?.resolve(valor);
    setPedido(null);
  }

  return (
    <Dialog
      open={pedido !== null}
      onOpenChange={(aberto) => {
        // Fechar pelo X, pelo Esc ou por fora equivale a cancelar.
        if (!aberto) responder(false);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{pedido?.title ?? ""}</DialogTitle>
          {pedido?.description && <DialogDescription>{pedido.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => responder(false)}>
            {pedido?.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            type="button"
            variant={pedido?.destructive ? "destructive" : "default"}
            onClick={() => responder(true)}
          >
            {pedido?.confirmLabel ?? "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
