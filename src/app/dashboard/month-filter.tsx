"use client";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CalendarDays } from "lucide-react";

/**
 * Filtro ÚNICO do Dashboard: lista suspensa de meses (próximo mês, atual e
 * 12 para trás) + opção "Personalizado…" no fim, que abre um intervalo de
 * datas livre. Atualiza ?date=YYYY-MM-DD_YYYY-MM-DD (lido por resolvePeriod).
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
  // Próximo mês, mês atual e 12 meses para trás.
  const options = useMemo(() => {
    const list: { value: string; label: string; y: number; m: number }[] = [];
    for (let off = 1; off >= -12; off--) {
      const d = new Date(now.getFullYear(), now.getMonth() + off, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      list.push({
        value: `${y}-${String(m).padStart(2, "0")}`,
        label: `${MONTHS_PT[m - 1]}/${y}`,
        y,
        m,
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deriva a seleção do ?date= (mês cheio → item da lista; outro → custom).
  const dateParam = sp.get("date") ?? "";
  const { selected, customStart, customEnd } = useMemo(() => {
    const m = dateParam.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (!m) {
      const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      return { selected: cur, customStart: "", customEnd: "" };
    }
    const [, s, e] = m;
    const opt = options.find((o) => {
      const r = monthRange(o.y, o.m);
      return r.start === s && r.end === e;
    });
    return opt
      ? { selected: opt.value, customStart: "", customEnd: "" }
      : { selected: "custom", customStart: s, customEnd: e };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateParam, options]);

  const [custom, setCustom] = useState(selected === "custom");
  const [de, setDe] = useState(customStart);
  const [ate, setAte] = useState(customEnd);

  function pushRange(start: string, end: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("date", `${start}_${end}`);
    params.delete("preset");
    params.delete("periodo");
    router.push(`${pathname}?${params.toString()}`);
  }

  function onSelect(v: string) {
    if (v === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    const opt = options.find((o) => o.value === v);
    if (!opt) return;
    const r = monthRange(opt.y, opt.m);
    pushRange(r.start, r.end);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label className="text-xs">Período</Label>
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
          <Select
            aria-label="Mês do Dashboard"
            className="h-9 w-auto min-w-[170px] text-sm font-medium"
            value={custom ? "custom" : selected}
            onChange={(e) => onSelect(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="custom">Personalizado…</option>
          </Select>
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
