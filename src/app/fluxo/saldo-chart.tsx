"use client";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceDot,
} from "recharts";
import { ClientOnly } from "@/components/dashboard/client-only";
import { formatBRL, formatBRLShort } from "@/lib/format";
import { rotuloDoDia } from "./rotulo";

/**
 * A LINHA DO SALDO PROJETADO, dia a dia (02 §7.4).
 *
 * Um eixo só, linha de 2px, grade só horizontal — os padrões de dataviz do
 * design system. O que este gráfico acrescenta à tabela é UMA coisa, e é a
 * que importa: o formato da curva. Ver que o saldo desce em rampa até o dia
 * 22 e volta é diferente de ler trinta linhas de tabela.
 *
 * A LINHA DO ZERO é sempre desenhada, mesmo quando a projeção não chega
 * perto dela: sem a referência, uma curva que desce parece igual em qualquer
 * escala. E o primeiro dia negativo ganha um PONTO marcado — é a informação
 * que a pessoa veio buscar.
 */
export function SaldoChart({
  dados,
  primeiroNegativo,
}: {
  dados: { dia: string; rotulo: string; saldo: number }[];
  primeiroNegativo: { dia: string; saldo: number } | null;
}) {
  return (
    <ClientOnly height={220}>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false}
              stroke="hsl(var(--border))" />
            <XAxis
              dataKey="rotulo" tickLine={false} axisLine={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              minTickGap={24}
            />
            <YAxis
              tickLine={false} axisLine={false} width={64}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(v: number) => formatBRLShort(v)}
            />
            <Tooltip
              formatter={(v: number) => [formatBRL(v), "Saldo projetado"]}
              labelFormatter={(l: string) => `Dia ${l}`}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
            <Line
              type="monotone" dataKey="saldo" strokeWidth={2} dot={false}
              stroke="hsl(var(--primary))" activeDot={{ r: 4 }} isAnimationActive={false}
            />
            {primeiroNegativo ? (
              <ReferenceDot
                x={rotuloDoDia(primeiroNegativo.dia)}
                y={primeiroNegativo.saldo}
                r={5}
                fill="hsl(var(--destructive))"
                stroke="hsl(var(--card))"
                strokeWidth={2}
                isFront
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ClientOnly>
  );
}
