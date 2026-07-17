"use client";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/format";
import type { ActionResult } from "@/lib/actions/clients";

/**
 * Edição inline de valor monetário na linha do cliente. Clique para editar,
 * Enter/blur salva, Esc cancela. Otimista com reversão em erro.
 */
export function InlineMoney({
  value,
  onSave,
  ariaLabel,
  suffix,
}: {
  value: number | null;
  onSave: (raw: string) => Promise<ActionResult>;
  ariaLabel: string;
  suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [shown, setShown] = useState<number | null>(value);

  function commit() {
    const raw = draft.trim();
    setEditing(false);
    const prev = shown;
    start(async () => {
      const res = await onSave(raw);
      if (!res.ok) {
        setShown(prev);
        alert(res.error);
      } else {
        const parsed = raw
          ? Number(raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."))
          : null;
        setShown(parsed != null && Number.isFinite(parsed) ? parsed : null);
      }
    });
  }

  if (editing) {
    return (
      <Input
        autoFocus
        aria-label={ariaLabel}
        inputMode="decimal"
        className="h-7 w-24 text-right text-sm ml-auto"
        defaultValue={shown != null && shown > 0 ? shown.toFixed(2).replace(".", ",") : ""}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={`${ariaLabel} — clique para editar`}
      title="Clique para editar"
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        setDraft("");
        setEditing(true);
      }}
      className="tabular-nums underline-offset-4 hover:underline disabled:opacity-60"
    >
      {shown != null && shown > 0 ? (
        <>
          {formatBRL(shown)}
          {suffix && <span className="ml-1 text-[10px] text-muted-foreground">{suffix}</span>}
        </>
      ) : (
        <span className="text-muted-foreground">— definir —</span>
      )}
    </button>
  );
}
