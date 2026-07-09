"use client";
import * as React from "react";
import { useState, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/actions/clients";

type Option = { value: string; label: string };

/**
 * Select inline em formato de "pill" para edição direta na linha da carteira
 * (status, modalidade, inadimplência, mês de renovação). Atualização otimista:
 * aplica o valor na hora e reverte com aviso se a Server Action falhar.
 *
 * `value` é sempre string (""=vazio). A action recebe a string escolhida
 * ("" quando o usuário limpa) e devolve ActionResult.
 */
export function InlineSelect({
  value,
  options,
  action,
  pillClass,
  ariaLabel,
  emptyLabel = "—",
  allowEmpty = false,
  onDone,
}: {
  value: string;
  options: Option[];
  action: (value: string) => Promise<ActionResult>;
  pillClass?: (value: string) => string;
  ariaLabel: string;
  emptyLabel?: string;
  allowEmpty?: boolean;
  /** Chamado após salvar com sucesso, com o valor aplicado. */
  onDone?: (value: string) => void;
}) {
  const [current, setCurrent] = useState(value);
  const [pending, start] = useTransition();

  // Sincroniza quando a prop muda (ex.: revalidate após ação em massa).
  React.useEffect(() => setCurrent(value), [value]);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const prev = current;
    setCurrent(next); // otimista
    start(async () => {
      const res = await action(next);
      if (!res.ok) {
        setCurrent(prev);
        alert(res.error);
      } else {
        onDone?.(next);
      }
    });
  }

  const tone = pillClass ? pillClass(current) : "bg-muted text-foreground border-transparent";

  return (
    <span
      className={cn(
        "relative inline-flex items-center rounded-full border pl-2.5 pr-6 h-6 text-xs font-medium transition-colors",
        tone,
        pending && "opacity-60"
      )}
    >
      <select
        aria-label={ariaLabel}
        value={current}
        disabled={pending}
        onChange={handleChange}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none truncate max-w-[130px]">
        {options.find((o) => o.value === current)?.label ?? emptyLabel}
      </span>
      <span className="pointer-events-none absolute right-1.5">
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <ChevronDown className="h-3 w-3 opacity-60" />
        )}
      </span>
    </span>
  );
}
