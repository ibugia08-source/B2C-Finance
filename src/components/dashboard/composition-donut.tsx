"use client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { ClientOnly } from "./client-only";
import { formatBRL } from "@/lib/format";

/**
 * Donut minimalista de composição (ex.: MRR × TCV × Receita Extra).
 * Poucas fatias, cores sóbrias, legenda com valor e %. Sem poluição.
 */
export function CompositionDonut({
  data,
  emptyText = "Sem dados no período.",
}: {
  data: { label: string; value: number; color: string }[];
  emptyText?: string;
}) {
  const items = data.filter((d) => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);

  if (total <= 0) {
    return <p className="text-sm text-muted-foreground py-10 text-center">{emptyText}</p>;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: 132, height: 132 }}>
        <ClientOnly height={132}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={62}
              paddingAngle={2}
              stroke="none"
            >
              {items.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        </ClientOnly>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] text-muted-foreground">Total</span>
          <span className="text-sm font-semibold tabular-nums">{formatBRL(total)}</span>
        </div>
      </div>
      <ul className="flex-1 min-w-0 space-y-1.5">
        {items.map((d) => (
          <li key={d.label} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="tabular-nums whitespace-nowrap text-muted-foreground">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DonutTooltip({ active, payload, total }: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-lg text-xs">
      <p className="font-medium text-foreground">{p.name}</p>
      <p className="tabular-nums">{formatBRL(p.value)} · {Math.round((p.value / total) * 100)}%</p>
    </div>
  );
}
