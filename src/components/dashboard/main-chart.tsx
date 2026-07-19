"use client";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL, formatBRLShort } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Gráfico principal do Dashboard (Recharts) — padrão minimalista da referência:
 * linha fina strokeWidth 2, sem pontos (só no hover), grid vertical sutil, grid
 * horizontal desligado, eixos discretos, tooltip limpo com variação vs mês
 * anterior, e toggle segmentado Mensal | Acumulado no topo direito.
 */

type ChartVariant = "line" | "bar";

export function MainChart({
  title,
  data,
  color = "hsl(var(--primary))",
  variant = "line",
  selectedIndex,
  diverging = false,
}: {
  title: string;
  /** 12 pontos Jan..Dez do ano selecionado */
  data: { label: string; value: number }[];
  color?: string;
  variant?: ChartVariant;
  /** índice (0-11) do mês filtrado, para destaque */
  selectedIndex?: number;
  /** barras/valores negativos em vermelho e positivos em verde (Resultado) */
  diverging?: boolean;
}) {
  const [mode, setMode] = useState<"mensal" | "acumulado">("mensal");

  const chartData = useMemo(() => {
    if (mode === "mensal") return data;
    let acc = 0;
    return data.map((d) => ({ ...d, value: (acc += d.value) }));
  }, [data, mode]);

  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const selectedValue =
    selectedIndex != null && chartData[selectedIndex] ? chartData[selectedIndex].value : null;

  const posColor = "hsl(var(--success))";
  const negColor = "hsl(var(--destructive))";
  const barColor = (v: number) => (diverging ? (v < 0 ? negColor : posColor) : color);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-2xl font-bold tabular-nums mt-1">
              {formatBRL(mode === "acumulado" ? total : selectedValue ?? total)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {mode === "acumulado"
                ? "acumulado no ano"
                : selectedValue != null
                  ? "mês selecionado"
                  : "total no ano"}
            </p>
          </div>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "mensal", label: "Mensal" },
              { value: "acumulado", label: "Acumulado" },
            ]}
          />
        </div>

        <ResponsiveContainer width="100%" height={280}>
          {variant === "bar" ? (
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.35} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis axisLine={false} tickLine={false} tickMargin={8} width={56}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => formatBRLShort(v)} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                content={<VariationTooltip data={chartData} />} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={26}>
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={barColor(d.value)}
                    fillOpacity={selectedIndex == null || i === selectedIndex ? 1 : 0.45}
                  />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.35} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis axisLine={false} tickLine={false} tickMargin={8} width={56}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => formatBRLShort(v)} />
              <Tooltip cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                content={<VariationTooltip data={chartData} />} />
              {selectedIndex != null && chartData[selectedIndex] && (
                <ReferenceLine x={chartData[selectedIndex].label} stroke={color} strokeOpacity={0.25} strokeDasharray="3 3" />
              )}
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2}
                dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/** Tooltip minimalista com valor do mês + variação vs mês anterior. */
function VariationTooltip({
  active,
  payload,
  label,
  data,
}: any) {
  if (!active || !payload || !payload.length) return null;
  const value = payload[0].value as number;
  const idx = data.findIndex((d: any) => d.label === label);
  const prev = idx > 0 ? (data[idx - 1].value as number) : null;
  const variation = prev != null && prev !== 0 ? (value - prev) / Math.abs(prev) : null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-lg text-xs">
      <p className="font-medium text-foreground mb-0.5">{label}</p>
      <p className="tabular-nums text-foreground">{formatBRL(value)}</p>
      {variation != null && (
        <p className={cn("tabular-nums mt-0.5", variation >= 0 ? "text-success" : "text-destructive")}>
          {variation >= 0 ? "▲" : "▼"} {Math.abs(variation * 100).toFixed(1).replace(".", ",")}% vs mês anterior
        </p>
      )}
    </div>
  );
}

/** Toggle segmentado (pill) — controle compacto no topo do gráfico. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
            value === o.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
