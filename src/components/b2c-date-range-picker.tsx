"use client";
import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PRESET_LABEL,
  PRESET_LABEL_CURTO,
  PERIODO_LEGADO,
  presetRange,
  type DateRangePreset,
} from "@/lib/period";

/**
 * <B2CDateRangePicker /> — filtro global de período (padrão Meta Ads).
 * Flat design B2C: trigger fechado → popover com presets à esquerda e
 * 2 calendários à direita. Presets aplicam na hora; "Personalizado" exige
 * Atualizar. Persiste na URL: ?date=YYYY-MM-DD_YYYY-MM-DD&preset=...
 * (lido por resolvePeriod em todas as páginas server).
 * Semana começa na SEGUNDA. Datas exibidas em pt-BR (dd/mm/aaaa).
 */

export type { DateRangePreset };

export type DateRangeValue = {
  startDate: Date;
  endDate: Date; // inclusivo
  preset: DateRangePreset;
};

export type B2CDateRangePickerProps = {
  value?: DateRangeValue;
  onChange?: (value: DateRangeValue) => void;
  allowFuture?: boolean;
  maxFutureMonths?: number;
  minDate?: Date;
  align?: "left" | "right";
  updateUrl?: boolean;
  queryParamPrefix?: string;
};

/**
 * Ordem dos presets na coluna, agrupada por natureza. Os três do fim do
 * bloco de calendário (trimestre, ano, ano passado) entraram com a RP-01:
 * `?periodo=trimestre` e `?periodo=ano` valiam no servidor e não tinham
 * representação aqui, então o seletor anunciava "Este mês" enquanto o
 * relatório somava o ano inteiro.
 */
const PRESET_ORDER: DateRangePreset[] = [
  "today", "yesterday", "today_yesterday",
  "last_7_days", "last_14_days", "last_28_days", "last_30_days",
  "this_week", "last_week",
  "this_month", "last_month", "this_quarter", "this_year", "last_year",
  "maximum", "custom",
];

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const RECENT_KEY = "b2c-drp-recent";

// ===== helpers de data (dia local, sem hora) =====
const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIso = (s: string): Date | null => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const parseBR = (s: string): Date | null => {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[1] ? d : null;
};
const fmtBR = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const fmtLong = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric" })
    .format(d)
    .replace(".", "");

export function B2CDateRangePicker({
  value,
  onChange,
  allowFuture = false,
  maxFutureMonths = 1,
  minDate,
  align = "left",
  updateUrl = true,
  queryParamPrefix = "",
}: B2CDateRangePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const p = (k: string) => `${queryParamPrefix}${k}`;

  // ===== valor atual (URL → prop → padrão "este mês") =====
  const urlValue = React.useMemo<DateRangeValue | null>(() => {
    const raw = sp.get(p("date"));
    if (raw) {
      const m = raw.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
      if (m) {
        const s = fromIso(m[1]);
        const e = fromIso(m[2]);
        if (s && e) {
          const preset = (sp.get(p("preset")) as DateRangePreset) ?? "custom";
          return { startDate: s, endDate: e, preset: PRESET_LABEL[preset] ? preset : "custom" };
        }
      }
    }

    // RP-01 — o servidor resolve `?periodo=` e este controle só conhecia
    // `?date=`. Sem `?date=` na URL ele caía no padrão "este mês" e ANUNCIAVA
    // isso, enquanto o relatório já estava somando o ano. Agora as duas
    // leituras saem da mesma tabela, em lib/period.
    const legado = PERIODO_LEGADO[sp.get("periodo") ?? ""];
    if (legado) {
      const r = presetRange(legado, minDate);
      return { startDate: r.start, endDate: r.end, preset: legado };
    }

    // Intervalo livre legado (?de=&ate=) também tem representação aqui.
    const de = sp.get("de");
    const ate = sp.get("ate");
    if (de || ate) {
      const s = de ? fromIso(de) : null;
      const e = ate ? fromIso(ate) : null;
      if (s || e) {
        const hoje = day(new Date());
        return {
          startDate: s ?? new Date(hoje.getFullYear(), 0, 1),
          endDate: e ?? hoje,
          preset: "custom",
        };
      }
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, minDate]);

  const current: DateRangeValue =
    urlValue ?? value ?? { ...toValue(presetRange("this_month", minDate), "this_month") };

  function toValue(r: { start: Date; end: Date }, preset: DateRangePreset): DateRangeValue {
    return { startDate: r.start, endDate: r.end, preset };
  }

  // ===== estado do popover =====
  const [open, setOpen] = React.useState(false);
  const [draftStart, setDraftStart] = React.useState<Date>(current.startDate);
  const [draftEnd, setDraftEnd] = React.useState<Date>(current.endDate);
  const [draftPreset, setDraftPreset] = React.useState<DateRangePreset>(current.preset);
  const [clickCount, setClickCount] = React.useState(0); // 0 = próximo clique inicia range
  const [viewMonth, setViewMonth] = React.useState<Date>(
    new Date(current.startDate.getFullYear(), current.startDate.getMonth(), 1)
  );
  const [inputStart, setInputStart] = React.useState("");
  const [inputEnd, setInputEnd] = React.useState("");
  const [inputError, setInputError] = React.useState<string | null>(null);
  const [recents, setRecents] = React.useState<DateRangePreset[]>([]);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecents(JSON.parse(raw).filter((k: string) => PRESET_LABEL[k as DateRangePreset]));
    } catch {}
  }, []);

  // fecha ao clicar fora / Esc (descarta rascunho custom)
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeDiscard();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeDiscard();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function openPopover() {
    setDraftStart(current.startDate);
    setDraftEnd(current.endDate);
    setDraftPreset(current.preset);
    setClickCount(0);
    setInputStart(fmtBR(current.startDate));
    setInputEnd(fmtBR(current.endDate));
    setInputError(null);
    setViewMonth(new Date(current.startDate.getFullYear(), current.startDate.getMonth(), 1));
    setOpen(true);
  }
  function closeDiscard() {
    setOpen(false);
    setInputError(null);
  }

  function pushRecent(preset: DateRangePreset) {
    if (preset === "custom") return;
    const next = [preset, ...recents.filter((r) => r !== preset)].slice(0, 3);
    setRecents(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
  }

  function apply(v: DateRangeValue) {
    onChange?.(v);
    if (updateUrl) {
      const params = new URLSearchParams(sp.toString());
      params.set(p("date"), `${iso(v.startDate)}_${iso(v.endDate)}`);
      params.set(p("preset"), v.preset);
      // limpa params legados de período para não conflitar
      params.delete("periodo");
      params.delete("de");
      params.delete("ate");
      router.push(`${pathname}?${params.toString()}`);
    }
  }

  function applyPreset(preset: DateRangePreset) {
    if (preset === "custom") {
      setDraftPreset("custom");
      return;
    }
    const r = presetRange(preset, minDate);
    pushRecent(preset);
    setOpen(false);
    apply(toValue(r, preset));
  }

  function confirmCustom() {
    const s = draftStart <= draftEnd ? draftStart : draftEnd;
    const e = draftStart <= draftEnd ? draftEnd : draftStart;
    setOpen(false);
    apply({ startDate: s, endDate: e, preset: "custom" });
  }

  // ===== calendário =====
  const today = day(new Date());
  const maxSelectable = allowFuture
    ? new Date(today.getFullYear(), today.getMonth() + Math.max(1, maxFutureMonths) + 1, 0)
    : today;

  function selectDay(d: Date) {
    setDraftPreset("custom");
    setInputError(null);
    if (clickCount === 0) {
      setDraftStart(d);
      setDraftEnd(d);
      setClickCount(1);
    } else {
      if (d < draftStart) {
        setDraftEnd(draftStart);
        setDraftStart(d);
      } else {
        setDraftEnd(d);
      }
      setClickCount(0);
    }
    setInputStart(fmtBR(d < draftStart && clickCount === 1 ? d : clickCount === 0 ? d : draftStart));
    setInputEnd(fmtBR(clickCount === 1 ? (d < draftStart ? draftStart : d) : d));
  }

  function commitInput(kind: "start" | "end", raw: string) {
    const d = parseBR(raw);
    if (!d) {
      setInputError("Data inválida — use dd/mm/aaaa.");
      return;
    }
    if (d > maxSelectable) {
      setInputError("Data além do limite permitido.");
      return;
    }
    if (minDate && d < day(minDate)) {
      setInputError("Data anterior ao mínimo permitido.");
      return;
    }
    setInputError(null);
    setDraftPreset("custom");
    if (kind === "start") {
      setDraftStart(d);
      if (d > draftEnd) setDraftEnd(d);
    } else {
      setDraftEnd(d);
      if (d < draftStart) setDraftStart(d);
    }
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  /**
   * RP-07 — o botão media ~381 px numa viewport de 390 px e empurrava a
   * página para 410 px, criando rolagem horizontal onde 1.4.10 (Reflow) não
   * permite. O rótulo longo continua no desktop; no celular entra a versão
   * curta, e o intervalo completo fica no `title` e no nome acessível.
   */
  const nomeDoPreset =
    current.preset !== "custom" ? PRESET_LABEL[current.preset] : null;
  const intervalo = `${fmtLong(current.startDate)} a ${fmtLong(current.endDate)}`;
  const triggerLabel = nomeDoPreset ? `${nomeDoPreset}: ${intervalo}` : intervalo;
  const triggerCurto = nomeDoPreset
    ? (PRESET_LABEL_CURTO[current.preset] ?? nomeDoPreset)
    : `${fmtBR(current.startDate)} – ${fmtBR(current.endDate)}`;

  const inRange = (d: Date) => d >= (draftStart <= draftEnd ? draftStart : draftEnd) && d <= (draftStart <= draftEnd ? draftEnd : draftStart);
  const isEdge = (d: Date) => sameDay(d, draftStart) || sameDay(d, draftEnd);

  function MonthGrid({ base }: { base: Date }) {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(first);
    const offset = (first.getDay() + 6) % 7; // segunda = 0
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(base.getFullYear(), base.getMonth(), i + 1)),
    ];
    return (
      <div className="w-full">
        <p className="text-center text-sm font-medium capitalize mb-2">{label}</p>
        <div className="grid grid-cols-7 gap-y-0.5 text-center">
          {WEEKDAYS.map((w) => (
            <span key={w} className="text-[10px] font-medium text-muted-foreground py-1">
              {w}
            </span>
          ))}
          {cells.map((d, i) =>
            d == null ? (
              <span key={`e${i}`} />
            ) : (
              <button
                key={d.getTime()}
                type="button"
                disabled={d > maxSelectable || (minDate ? d < day(minDate) : false)}
                aria-label={fmtBR(d)}
                onClick={() => selectDay(d)}
                className={cn(
                  "mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors",
                  "hover:bg-muted disabled:opacity-30 disabled:pointer-events-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  inRange(d) && !isEdge(d) && "bg-primary/15 text-foreground rounded-none",
                  isEdge(d) && "bg-primary text-primary-foreground font-semibold",
                  sameDay(d, today) && !inRange(d) && "border border-primary/40"
                )}
              >
                {d.getDate()}
              </button>
            )
          )}
        </div>
      </div>
    );
  }

  const nextMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
  const isCustom = draftPreset === "custom";

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      {/* ===== Trigger ===== */}
      <button
        type="button"
        onClick={() => (open ? closeDiscard() : openPopover())}
        aria-expanded={open}
        aria-controls="b2c-drp-popover"
        title={triggerLabel}
        aria-label={`Período: ${triggerLabel}`}
        className={cn(
          // `max-w-full` + `min-w-0` são o que impede o rótulo de empurrar a
          // página: sem eles o conteúdo define a largura e o flex pai cresce.
          "flex h-9 min-h-touch-sm max-w-full min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-sm",
          "transition-colors hover:border-muted-foreground/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate sm:hidden">{triggerCurto}</span>
        <span className="hidden truncate sm:inline">{triggerLabel}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {/* ===== Popover ===== */}
      {open && (
        <div
          id="b2c-drp-popover"
          role="dialog"
          aria-label="Selecionar período"
          className={cn(
            "z-50 rounded-lg border bg-background shadow-lg",
            // desktop: popover ancorado; mobile: bottom sheet
            "max-sm:fixed max-sm:inset-x-2 max-sm:bottom-2 max-sm:max-h-[85vh] max-sm:overflow-y-auto",
            "sm:absolute sm:mt-1.5 sm:w-[580px]",
            align === "right" ? "sm:right-0" : "sm:left-0"
          )}
        >
          <div className="flex max-sm:flex-col">
            {/* Coluna esquerda — presets */}
            <div className="sm:w-[180px] shrink-0 border-b sm:border-b-0 sm:border-r p-2 max-h-[420px] overflow-y-auto">
              {recents.length > 0 && (
                <>
                  <p className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Usados recentemente
                  </p>
                  {recents.map((r) => (
                    <PresetItem key={`r-${r}`} preset={r} active={draftPreset === r} onSelect={applyPreset} />
                  ))}
                  <div className="my-1 border-t" />
                </>
              )}
              {PRESET_ORDER.map((k) => (
                <PresetItem key={k} preset={k} active={draftPreset === k} onSelect={applyPreset} />
              ))}
            </div>

            {/* Coluna direita — calendários + inputs */}
            <div className="flex-1 p-3">
              <div className="flex items-center justify-between mb-1">
                <button
                  type="button"
                  aria-label="Meses anteriores"
                  onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                  className="rounded-md p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Próximos meses"
                  onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                  className="rounded-md p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <MonthGrid base={viewMonth} />
                <div className="max-sm:hidden">
                  <MonthGrid base={nextMonth} />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Data inicial
                  </label>
                  <Input
                    className="h-8 text-sm"
                    value={inputStart}
                    placeholder="dd/mm/aaaa"
                    onChange={(e) => setInputStart(e.target.value)}
                    onBlur={(e) => commitInput("start", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && commitInput("start", inputStart)}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Data final
                  </label>
                  <Input
                    className="h-8 text-sm"
                    value={inputEnd}
                    placeholder="dd/mm/aaaa"
                    onChange={(e) => setInputEnd(e.target.value)}
                    onBlur={(e) => commitInput("end", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && commitInput("end", inputEnd)}
                  />
                </div>
              </div>
              {inputError && <p className="mt-1 text-xs text-destructive">{inputError}</p>}
            </div>
          </div>

          {/* Rodapé */}
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            <p className="text-xs text-muted-foreground truncate">
              {fmtLong(draftStart <= draftEnd ? draftStart : draftEnd)} a{" "}
              {fmtLong(draftStart <= draftEnd ? draftEnd : draftStart)} · Fuso: America/Sao_Paulo
            </p>
            {isCustom && (
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={closeDiscard}>
                  Cancelar
                </Button>
                <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={confirmCustom}>
                  Atualizar
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PresetItem({
  preset,
  active,
  onSelect,
}: {
  preset: DateRangePreset;
  active: boolean;
  onSelect: (p: DateRangePreset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(preset)}
      className={cn(
        "block w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-foreground hover:bg-muted"
      )}
    >
      {PRESET_LABEL[preset]}
    </button>
  );
}
