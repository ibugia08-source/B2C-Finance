"use client";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CalendarDays } from "lucide-react";

/**
 * Filtro ÚNICO do Dashboard: [Mês ▾] [Ano ▾] — com "Personalizado…" no fim
 * da lista de meses para escolher um intervalo de datas livre (De/Até).
 * Atualiza ?date=YYYY-MM-DD_YYYY-MM-DD (lido por resolvePeriod).
 */

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function monthRange(y: number, m: number) {
  // m: 1-12 → primeiro e último dia do mês
  return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
}

export function MonthFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const now = new Date();
  const curM = now.getMonth() + 1;
  const curY = now.getFullYear();

  // Anos disponíveis: 3 para trás até 1 à frente (inclui o ano da URL, se fora).
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = curY - 3; y <= curY + 1; y++) list.push(y);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deriva a seleção do ?date=: mês cheio → mês/ano; outro intervalo → custom.
  const dateParam = sp.get("date") ?? "";
  const derived = useMemo(() => {
    const m = dateParam.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      const [, ys, ms, , endStr] = m;
      const y = parseInt(ys, 10);
      const mo = parseInt(ms, 10);
      const r = monthRange(y, mo);
      if (dateParam === `${r.start}_${r.end}`) {
        return { custom: false, month: mo, year: y, de: "", ate: "" };
      }
      const full = dateParam.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/)!;
      return { custom: true, month: curM, year: curY, de: full[1], ate: full[2] };
    }
    return { custom: false, month: curM, year: curY, de: "", ate: "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateParam]);

  const [custom, setCustom] = useState(derived.custom);
  const [month, setMonth] = useState(derived.month);
  const [year, setYear] = useState(derived.year);
  const [de, setDe] = useState(derived.de);
  const [ate, setAte] = useState(derived.ate);

  const yearOptions = years.includes(year) ? years : [year, ...years];

  function pushRange(start: string, end: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("date", `${start}_${end}`);
    params.delete("preset");
    params.delete("periodo");
    router.push(`${pathname}?${params.toString()}`);
  }

  function apply(m: number, y: number) {
    const r = monthRange(y, m);
    pushRange(r.start, r.end);
  }

  function onMonthChange(v: string) {
    if (v === "custom") {
      setCustom(true);
      return;
    }
    const m = parseInt(v, 10);
    setCustom(false);
    setMonth(m);
    apply(m, year);
  }

  function onYearChange(v: string) {
    const y = parseInt(v, 10);
    setYear(y);
    if (!custom) apply(month, y);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label className="text-xs">Período</Label>
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
          <Select
            aria-label="Mês"
            className="h-9 w-auto min-w-[140px] text-sm font-medium"
            value={custom ? "custom" : String(month)}
            onChange={(e) => onMonthChange(e.target.value)}
          >
            {MONTHS_PT.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
            <option value="custom">Personalizado…</option>
          </Select>
          {!custom && (
            <Select
              aria-label="Ano"
              className="h-9 w-auto text-sm font-medium"
              value={String(year)}
              onChange={(e) => onYearChange(e.target.value)}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {custom && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (de && ate && de <= ate) pushRange(de, ate);
          }}
        >
          <div>
            <Label className="text-xs">De</Label>
            <Input
              type="date"
              className="h-9 w-40"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input
              type="date"
              className="h-9 w-40"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              required
              min={de || undefined}
            />
          </div>
          <Button type="submit" className="h-9" disabled={!de || !ate || de > ate}>
            Aplicar
          </Button>
        </form>
      )}
    </div>
  );
}
