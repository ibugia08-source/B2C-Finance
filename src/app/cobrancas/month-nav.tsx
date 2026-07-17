"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

/**
 * Navegação MENSAL do ciclo de recebimentos (modo mês do filtro global):
 * ◀  [Mês ▾] [Ano ▾]  ▶ · atualiza ?mes=YYYY-MM e recarrega a lista.
 * Experiência de planilha: olhar Janeiro, depois Fevereiro, depois Março.
 */

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function MonthNav({ month, year }: { month: number; year: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function go(m: number, y: number) {
    // normaliza transbordo (mês 0 → dezembro do ano anterior etc.)
    const d = new Date(y, m - 1, 1);
    const params = new URLSearchParams(sp.toString());
    params.set(
      "mes",
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
    router.push(`${pathname}?${params.toString()}`);
  }

  const now = new Date();
  const years: number[] = [];
  for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y++) years.push(y);
  if (!years.includes(year)) years.unshift(year);

  return (
    <div className="inline-flex items-center gap-1.5">
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        aria-label="Mês anterior"
        onClick={() => go(month - 1, year)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <div className="flex h-9 items-center gap-1 rounded-md border bg-background pl-2.5 pr-1">
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Select
          aria-label="Mês"
          className="h-7 w-[112px] rounded-md border-0 bg-transparent px-1 text-sm font-medium text-foreground focus-visible:ring-1 focus-visible:ring-offset-0"
          value={String(month)}
          onChange={(e) => go(parseInt(e.target.value, 10), year)}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </Select>
        <span className="text-muted-foreground">/</span>
        <Select
          aria-label="Ano"
          className="h-7 w-[72px] rounded-md border-0 bg-transparent px-1 text-sm font-medium text-foreground focus-visible:ring-1 focus-visible:ring-offset-0"
          value={String(year)}
          onChange={(e) => go(month, parseInt(e.target.value, 10))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>

      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        aria-label="Próximo mês"
        onClick={() => go(month + 1, year)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {(month !== now.getMonth() + 1 || year !== now.getFullYear()) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => go(now.getMonth() + 1, now.getFullYear())}
        >
          Mês atual
        </Button>
      )}
    </div>
  );
}
