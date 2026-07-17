import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Gráficos leves do dashboard — CSS/SVG puro, renderizados no servidor
 * (zero JS no cliente, zero dependência). Tooltip nativo via title.
 */

type Fmt = (v: number) => string;

export function ChartCard({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="mb-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {title}
          </p>
          {hint && <p className="text-[11px] text-muted-foreground/80 mt-0.5">{hint}</p>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** Barras agrupadas (ex.: receita × despesa por mês) com legenda. */
export function GroupedBarChart({
  labels,
  series,
  format = formatBRL,
}: {
  labels: string[];
  series: { name: string; colorClass: string; values: number[] }[];
  format?: Fmt;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Math.abs(v))));
  return (
    <div>
      <div className="flex items-end gap-1.5 h-40 border-b border-border/60">
        {labels.map((label, i) => (
          <div key={i} className="flex-1 min-w-0 h-full flex items-end justify-center gap-[2px]">
            {series.map((s) => {
              const v = s.values[i] ?? 0;
              const pct = (Math.abs(v) / max) * 100;
              return (
                <div
                  key={s.name}
                  className={cn("w-full max-w-[14px] rounded-t-sm hover:brightness-110", s.colorClass)}
                  style={{ height: `${v !== 0 ? Math.max(4, pct) : 0}%` }}
                  title={`${label} — ${s.name}: ${format(v)}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2">
        {labels.map((l, i) => (
          <div key={i} className="flex-1 min-w-0 text-center text-[10px] text-muted-foreground capitalize truncate">
            {l}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 mt-3">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("h-2.5 w-2.5 rounded-sm", s.colorClass)} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Barras divergentes (positivo sobe verde, negativo desce vermelho). */
export function DivergingBarChart({
  labels,
  values,
  format = formatBRL,
  positiveClass = "bg-emerald-500",
  negativeClass = "bg-rose-500",
}: {
  labels: string[];
  values: number[];
  format?: Fmt;
  positiveClass?: string;
  negativeClass?: string;
}) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <div>
      <div className="flex gap-1.5 h-40">
        {values.map((v, i) => {
          const pct = (Math.abs(v) / max) * 100;
          const h = v !== 0 ? Math.max(4, pct) : 0;
          return (
            <div key={i} className="flex-1 min-w-0 h-full flex flex-col" title={`${labels[i]}: ${format(v)}`}>
              <div className="h-1/2 flex items-end justify-center border-b border-border/60">
                {v > 0 && (
                  <div className={cn("w-full max-w-[18px] rounded-t-sm", positiveClass)} style={{ height: `${h}%` }} />
                )}
              </div>
              <div className="h-1/2 flex items-start justify-center">
                {v < 0 && (
                  <div className={cn("w-full max-w-[18px] rounded-b-sm", negativeClass)} style={{ height: `${h}%` }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-2">
        {labels.map((l, i) => (
          <div key={i} className="flex-1 min-w-0 text-center text-[10px] text-muted-foreground capitalize truncate">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Linha com área (ex.: MRR ao longo do tempo). SVG server-rendered. */
export function LineChart({
  labels,
  values,
  format = formatBRL,
  stroke = "hsl(var(--primary))",
}: {
  labels: string[];
  values: number[];
  format?: Fmt;
  stroke?: string;
}) {
  const max = Math.max(1, ...values) * 1.1;
  const W = 100;
  const H = 40;
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : W / 2);
  const y = (v: number) => H - (Math.max(0, v) / max) * H;
  const points = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `0,${H} ${points} ${W},${H}`;
  const last = values[values.length - 1] ?? 0;

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-36 border-b border-border/60">
          <polygon points={area} fill={stroke} opacity={0.12} />
          <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        </svg>
        {/* colunas invisíveis por ponto → tooltip nativo */}
        <div className="absolute inset-0 flex">
          {values.map((v, i) => (
            <div key={i} className="flex-1" title={`${labels[i]}: ${format(v)}`} />
          ))}
        </div>
        <span className="absolute top-1 right-1 text-xs font-semibold" style={{ color: stroke }}>
          {format(last)}
        </span>
      </div>
      <div className="flex gap-1 mt-2">
        {labels.map((l, i) => (
          <div key={i} className="flex-1 min-w-0 text-center text-[10px] text-muted-foreground capitalize truncate">
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ranking horizontal (receita por cliente/serviço, despesas por categoria). */
export function HBarList({
  items,
  colorClass = "bg-primary",
  format = formatBRL,
  emptyText = "Sem dados no período.",
}: {
  items: { label: string; value: number }[];
  colorClass?: string;
  format?: Fmt;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{emptyText}</p>;
  }
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
        return (
          <div key={i} title={`${item.label}: ${format(item.value)} (${pct}%)`}>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-sm truncate">{item.label}</span>
              <span className="text-sm font-medium tabular-nums whitespace-nowrap">
                {format(item.value)}
                <span className="text-xs text-muted-foreground ml-1.5">{pct}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full", colorClass)}
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
