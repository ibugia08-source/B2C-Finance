"use client";
import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * <B2CDateRangePicker /> — filtro global de período (padrão Meta Ads).
 * Flat design B2C: trigger fechado → popover com presets à esquerda e
 * 2 calendários à direita. Presets aplicam na hora; "Personalizado" exige
 * Atualizar. Persiste na URL: ?date=YYYY-MM-DD_YYYY-MM-DD&preset=...
 * (lido por resolvePeriod em todas as páginas server).
 * Semana começa na SEGUNDA. Datas exibidas em pt-BR (dd/mm/aaaa).
 */

export type DateRangePreset =
  | "today" | "yesterday" | "today_yesterday"
  | "last_7_days" | "last_14_days" | "last_28_days" | "last_30_days"
  | "this_week" | "last_week" | "this_month" | "last_month"
  | "maximum" | "custom";

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

const PRESET_LABEL: Record<DateRangePreset, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  today_yesterday: "Hoje e ontem",
  last_7_days: "Últimos 7 dias",
  last_14_days: "Últimos 14 dias",
  last_28_days: "Últimos 28 dias",
  last_30_days: "Últimos 30 dias",
  this_week: "Esta semana",
  last_week: "Semana passada",
  this_month: "Este mês",
  last_month: "Mês passado",
  maximum: "Máximo",
  custom: "Personalizado",
};

const PRESET_ORDER: DateRangePreset[] = [
  "today", "yesterday", "today_yesterday",
  "last_7_days", "last_14_days", "last_28_days", "last_30_days",
  "this_week", "last_week", "this_month", "last_month",
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

/** Intervalo [start,end] (inclusivo) de cada preset, relativo a hoje. */
export function presetRange(preset: DateRangePreset, minDate?: Date): { start: Date; end: Date } {
  const today = day(new Date());
  switch (preset) {
    case "today": return { start: today, end: today };
    case "yesterday": { const y = addDays(today, -1); return { start: y, end: y }; }
    case "today_yesterday": return { start: addDays(today, -1), end: today };
    case "last_7_days": return { start: addDays(today, -6), end: today };
    case "last_14_days": return { start: addDays(today, -13), end: today };
    case "last_28_days": return { start: addDays(today, -27), end: today };
    case "last_30_days": return { start: addDays(today, -29), end: today };
    case "this_week": {
      const dow = (today.getDay() + 6) % 7; // segunda = 0
      return { start: addDays(today, -dow), end: today };
    }
    case "last_week": {
      const dow = (today.getDay() + 6) % 7;
      const start = addDays(today, -dow - 7);
      return { start, end: addDays(start, 6) };
    }
    case "this_month":
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today };
    case "last_month": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { start, end: new Date(today.getFullYear(), today.getMonth(), 0) };
    }
    case "maximum":
      return { start: minDate ?? new Date(2020, 0, 1), end: today };
    default:
      return { start: today, end: today };
  }
}

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
    if (!raw) return null;
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (!m) return null;
    const s = fromIso(m[1]);
    const e = fromIso(m[2]);
    if (!s || !e) return null;
    const preset = (sp.get(p("preset")) as DateRangePreset) ?? "custom";
    return { startDate: s, endDate: e, preset: PRESET_LABEL[preset] ? preset : "custom" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

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

  const triggerLabel =
    current.preset !== "custom"
      ? `${PRESET_LABEL[current.preset]}: ${fmtLong(current.startDate)} a ${fmtLong(current.endDate)}`
      : `${fmtLong(current.startDate)} a ${fmtLong(current.endDate)}`;

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
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm",
          "transition-colors hover:border-muted-foreground/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <span className="whitespace-nowrap">{triggerLabel}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
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
