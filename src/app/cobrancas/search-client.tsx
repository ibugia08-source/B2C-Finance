"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

/** Busca por nome de cliente no ciclo do mês (debounce, preserva filtros). */
export function ClientSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [value, setValue] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Mantém o campo em sincronia ao navegar (chips, mês etc.).
  useEffect(() => setValue(sp.get("q") ?? ""), [sp]);

  function apply(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="relative w-full sm:w-56">
      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        aria-label="Buscar cliente no mês"
        placeholder="Buscar cliente…"
        className="h-9 pl-8 pr-8"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => apply(v), 350);
        }}
      />
      {value && (
        <button
          type="button"
          aria-label="Limpar busca"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setValue("");
            clearTimeout(timer.current);
            apply("");
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
