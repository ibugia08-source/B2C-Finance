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
          <div key={`bar-${i}`} title={`${item.label}: ${format(item.value)} (${pct}%)`}>
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
