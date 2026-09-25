"use client";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ClientOnly } from "./client-only";
import { formatBRL, formatBRLShort } from "@/lib/format";

/**
 * EVOLUÇÃO DAS RENOVAÇÕES — últimos 6 meses + o mês em foco (25/09/2026).
 *
 * Barras agrupadas por mês: Esperado · Ganho · Perdido. É comparação de
 * MAGNITUDE entre três medidas da mesma unidade (reais) mês a mês, então
 * barras lado a lado num eixo só — nada de segundo eixo.
 *
 * Cores: azul (chart-1), verde (chart-3) e magenta (chart-6), nesta ordem.
 * O par verde × vermelho (chart-2) reprovou no validador de daltonismo no
 * tema escuro (ΔE 4,8 deutan); verde × magenta passa nos dois temas (≥ 9,9).
 * Cor nunca é o único canal: legenda com rótulo, tooltip com nome e valor, e
 * a tabela logo abaixo.
 */

export type RenewalChartPoint = {
  label: string;
  expected: number;
  gained: number;
  lost: number;
  renewedCount: number;
  lostCount: number;
};

const SERIES = [
  { key: "expected", label: "Esperado", color: "hsl(var(--chart-1))" },
  { key: "gained", label: "Ganho", color: "hsl(var(--chart-3))" },
  { key: "lost", label: "Perdido", color: "hsl(var(--chart-6))" },
] as const;

export function RenewalsChart({
  data,
  selectedIndex,
}: {
  data: RenewalChartPoint[];
  selectedIndex?: number;
}) {
  const [oculta, setOculta] = useState<Set<string>>(new Set());
  const vazio = useMemo(() => data.every((d) => d.expected === 0 && d.gained === 0 && d.lost === 0), [data]);

  function alternar(label: string) {
    const serie = SERIES.find((s) => s.label === label);
    if (!serie) return;
    setOculta((prev) => {
      const next = new Set(prev);
      if (next.has(serie.key)) next.delete(serie.key);
      else if (next.size < SERIES.length - 1) next.add(serie.key);
      return next;
    });
  }

  const foco = selectedIndex != null ? data[selectedIndex] : undefined;

  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
          Evolução das renovações
        </p>
        <p className="mt-0.5 text-dense text-muted-foreground">
          O que se esperava renovar em cada mês virou renovação — ou se perdeu?
        </p>

        {vazio ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Nenhuma expectativa de renovação nos últimos meses. A expectativa nasce da
            data de entrada + prazo do contrato de cada cliente.
          </p>
        ) : (
          <ClientOnly height={240}>
            <div className="mt-3 h-[240px]" role="img" aria-label="Gráfico de barras: esperado, ganho e perdido em renovações por mês">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }} barGap={2} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" strokeDasharray="0" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: number) => formatBRLShort(v)}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius-cell)",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                    formatter={(v: number, name: string, item: any) => {
                      const p = item?.payload as RenewalChartPoint | undefined;
                      if (name === "Ganho" && p) return [`${formatBRL(v)} · ${p.renewedCount} renovação(ões)`, name];
                      if (name === "Perdido" && p) return [`${formatBRL(v)} · ${p.lostCount} cliente(s)`, name];
                      return [formatBRL(v), name];
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="left"
                    height={28}
                    iconType="square"
                    wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                    onClick={(e: any) => alternar(String(e?.value ?? ""))}
                  />
                  {SERIES.map((s) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label}
                      fill={s.color}
                      radius={[4, 4, 0, 0]}
                      stroke="hsl(var(--surface))"
                      strokeWidth={1}
                      hide={oculta.has(s.key)}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ClientOnly>
        )}

        {foco && (
          <p className="mt-2 text-caption text-muted-foreground">
            Mês em foco: <span className="font-medium text-foreground">{foco.label}</span>
            {SERIES.map((s) => (
              <span key={s.key} className="ml-3 whitespace-nowrap">
                <span className="mr-1 inline-block h-2 w-2 rounded-pill align-middle" style={{ background: s.color }} aria-hidden />
                {s.label} <span className="stat-number">{formatBRL(foco[s.key])}</span>
              </span>
            ))}
          </p>
        )}

        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-caption text-muted-foreground hover:text-foreground">
            Ver em tabela
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-dense">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Mês</th>
                  <th className="py-1 pr-3 text-right font-medium">Esperado</th>
                  <th className="py-1 pr-3 text-right font-medium">Ganho</th>
                  <th className="py-1 pr-3 text-right font-medium">Perdido</th>
                  <th className="py-1 text-right font-medium">Renovações</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.label} className="border-t">
                    <td className="py-1 pr-3">{d.label}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatBRL(d.expected)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatBRL(d.gained)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{formatBRL(d.lost)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {d.renewedCount} ganha(s) · {d.lostCount} perdida(s)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
