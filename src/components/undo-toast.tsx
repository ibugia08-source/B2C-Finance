"use client";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Undo2, X } from "lucide-react";

/**
 * Toast de DESFAZER (padrão planilha: o gesto registra na hora e o aviso
 * oferece voltar atrás). Sem lib externa: barramento de eventos em módulo +
 * host único montado no AppShell.
 *
 *   showUndoToast({ message: "Pagamento registrado", onUndo: async () => {...} })
 *
 * - Auto-fecha em 8s (tempo de ler e decidir).
 * - Um toast por vez — gesto novo substitui o anterior (o Desfazer antigo
 *   continua válido pela janela da action, não pela UI).
 * - Renderiza em portal no <body>: a animação page-enter do <main> criaria
 *   um bloco de contenção e prenderia o position:fixed (mesma razão do
 *   FloatingActionBar).
 */

export type UndoToastInput = {
  message: string;
  /** Ação de desfazer; retorno {ok:false} mantém o toast com o erro. */
  onUndo?: () => Promise<{ ok: boolean; error?: string } | void>;
  /** Rótulo do botão (default "Desfazer"). */
  undoLabel?: string;
};

type Listener = (t: UndoToastInput) => void;
let listener: Listener | null = null;

export function showUndoToast(t: UndoToastInput) {
  listener?.(t);
}

const AUTO_HIDE_MS = 8000;

export function UndoToastHost() {
  const [toast, setToast] = useState<UndoToastInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    listener = (t) => {
      setError(null);
      setToast(t);
    };
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!toast || pending) return;
    const id = setTimeout(() => setToast(null), AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [toast, pending, error]);

  if (!mounted || !toast) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-full border bg-card px-4 py-2.5 shadow-modal max-w-[calc(100vw-2rem)]"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      <span className="text-sm font-medium truncate">
        {error ? error : toast.message}
      </span>
      {toast.onUndo && !error && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                const res = await toast.onUndo!();
                if (res && res.ok === false) {
                  setError(res.error ?? "Não foi possível desfazer.");
                  return;
                }
                setToast(null);
              } catch {
                setError("Não foi possível desfazer.");
              }
            })
          }
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
        >
          <Undo2 className="h-3.5 w-3.5" />
          {pending ? "Desfazendo…" : toast.undoLabel ?? "Desfazer"}
        </button>
      )}
      <button
        type="button"
        aria-label="Fechar aviso"
        onClick={() => setToast(null)}
        className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>,
    document.body
  );
}
