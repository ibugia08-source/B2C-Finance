"use client";
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
  /**
   * Pede uma JUSTIFICATIVA escrita antes de confirmar (F2.1 · 01 §5.5:
   * reabrir período sem motivo não existe). Use `askReason`, que devolve o
   * texto; `confirmAction` continua devolvendo booleano.
   */
  motivo?: { label: string; placeholder?: string; minimo?: number };
};

type Pedido = ConfirmOptions & { resolve: (v: boolean | string | null) => void };

let listener: ((p: Pedido) => void) | null = null;

/** Pergunta ao usuário. Resolve `false` se o host não estiver montado. */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (!listener) return Promise.resolve(false);
  return new Promise<boolean>((resolve) =>
    listener!({ ...opts, resolve: (v) => resolve(v === true) })
  );
}

/**
 * Confirma PEDINDO O PORQUÊ. Devolve o texto, ou null se cancelou.
 *
 * Existe para não usar o `prompt()` nativo, que é a mesma caixa do sistema
 * operacional que T3 tirou do produto — e que num gesto como reabrir um mês
 * fechado ficaria especialmente fora de lugar.
 */
export function askReason(opts: ConfirmOptions & { motivo: NonNullable<ConfirmOptions["motivo"]> }): Promise<string | null> {
  if (!listener) return Promise.resolve(null);
  return new Promise<string | null>((resolve) =>
    listener!({ ...opts, resolve: (v) => resolve(typeof v === "string" ? v : null) })
  );
}

export function ConfirmDialogHost() {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [texto, setTexto] = useState("");

  useEffect(() => {
    listener = (p) => {
      setTexto("");
      setPedido(p);
    };
    return () => {
      listener = null;
    };
  }, []);

  function responder(valor: boolean) {
    // Com justificativa, o "sim" devolve o TEXTO; o "não" devolve false, e
    // quem chamou por askReason lê isso como cancelamento.
    pedido?.resolve(pedido.motivo && valor ? texto.trim() : valor);
    setPedido(null);
    setTexto("");
  }

  const minimo = pedido?.motivo?.minimo ?? 10;
  const curto = !!pedido?.motivo && texto.trim().length < minimo;

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
        {pedido?.motivo ? (
          <div className="space-y-1.5">
            <Label htmlFor="motivo-confirmacao">{pedido.motivo.label}</Label>
            <Textarea
              id="motivo-confirmacao"
              rows={3}
              autoFocus
              value={texto}
              placeholder={pedido.motivo.placeholder}
              onChange={(e) => setTexto(e.target.value)}
            />
            {curto ? (
              <p className="text-caption text-muted-foreground">
                Escreva pelo menos {minimo} caracteres — isto fica registrado.
              </p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => responder(false)}>
            {pedido?.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            type="button"
            variant={pedido?.destructive ? "destructive" : "default"}
            disabled={curto}
            onClick={() => responder(true)}
          >
            {pedido?.confirmLabel ?? "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
