"use client";
import { useEffect, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";

/**
 * Ícone de ajuda discreto (?) para explicar uma métrica.
 * Desktop: abre no hover. Mobile: abre no toque/clique. Fecha ao sair/clicar fora.
 * Acessível: botão com aria-label; caixa com role="tooltip".
 */
export function MetricHelp({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`O que é ${title}`}
        className="text-muted-foreground/60 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute right-0 top-6 z-30 w-56 rounded-lg border bg-popover p-3 text-left shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="block text-xs font-semibold text-foreground mb-1">{title}</span>
          <span className="block text-xs leading-relaxed text-muted-foreground">{text}</span>
        </span>
      )}
    </span>
  );
}
