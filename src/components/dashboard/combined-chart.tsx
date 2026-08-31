"use client";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ClientOnly } from "./client-only";
import { formatBRL, formatBRLShort } from "@/lib/format";

/**
 * GRÁFICO COMBINADO do painel executivo (F1.19 · ref. 02 §5.1, §7.4).
 *
 * "Esperado x Recebido em caixa x Despesas (combinado)".
 *
 * Regras do §7.4 aplicadas aqui, uma a uma:
 *  · o título é uma PERGUNTA, e a resposta é o próprio gráfico;
 *  · linhas de 2px sem pontos — o ponto aparece no hover, com valor;
 *  · grade horizontal discreta, vertical NENHUMA;
 *  · três séries (o teto é quatro);
 *  · cores das três primeiras faixas da paleta de dataviz, que foram
 *    validadas justamente para separar entre TODOS os pares sob
 *    daltonismo — não são escolhas soltas;
 *  · cor nunca é o único canal: cada série tem traço próprio (cheio,
 *    tracejado, pontilhado) e rótulo na legenda.
 *
 * Um eixo só. Duas escalas no mesmo gráfico seria o erro clássico — as
 * três séries aqui são todas em reais, então compartilham a escala com
 * honestidade.
 */

export type SerieCombinada = {
  label: string;
  values: number[];
  color: string;
  dash?: string;
};

export function CombinedChart({
  title,
  question,
  labels,
  series,
  selectedIndex,
}: {
  title: string;
  question?: string;
  labels: string[];
  series: SerieCombinada[];
  selectedIndex?: number;
}) {
  const [oculta, setOculta] = useState<Set<string>>(new Set());

  const data = useMemo(
    () =>
      labels.map((label, i) => {
        const linha: Record<string, string | number> = { label };
        for (const s of series) linha[s.label] = s.values[i] ?? 0;
        return linha;
      }),
    [labels, series]
  );

  function alternar(label: string) {
    setOculta((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else if (next.size < series.length - 1) next.add(label); // nunca esconder todas
      return next;
    });
  }

  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {question && <p className="mt-0.5 text-dense text-muted-foreground">{question}</p>}

        <ClientOnly height={220}>
          <div className="mt-3 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
                {/* Grade só horizontal (02 §7.4). */}
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
                  cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--radius-cell)",
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                  formatter={(v: number, name: string) => [formatBRL(v), name]}
                />
                <Legend
                  verticalAlign="top"
                  align="left"
                  height={28}
                  iconType="plainline"
                  wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
                  onClick={(e: any) => alternar(String(e?.value ?? ""))}
                />
                {series.map((s) => (
                  <Line
                    key={s.label}
                    type="monotone"
                    dataKey={s.label}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dash}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--surface))" }}
                    hide={oculta.has(s.label)}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ClientOnly>

        {selectedIndex != null && labels[selectedIndex] && (
          <p className="mt-2 text-caption text-muted-foreground">
            Mês em foco: <span className="font-medium text-foreground">{labels[selectedIndex]}</span>
            {series.map((s) => (
              <span key={s.label} className="ml-3 whitespace-nowrap">
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-pill align-middle"
                  style={{ background: s.color }}
                  aria-hidden
                />
                {s.label} <span className="stat-number">{formatBRL(s.values[selectedIndex] ?? 0)}</span>
              </span>
            ))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
