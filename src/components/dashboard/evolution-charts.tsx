"use client";
import { useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { ClientOnly } from "./client-only";
import { formatBRL, formatBRLShort } from "@/lib/format";

/**
 * GRÁFICOS DE EVOLUÇÃO DA VISÃO GERAL (26/09/2026).
 *
 * MRR × TCV (janela 3/6/12 meses, anima na troca), clientes ativos, churn
 * (quantidade; o tooltip traz o R$ perdido) e ticket médio ao longo do ano.
 * Cores: MRR azul (chart-1) e TCV magenta (chart-6) — o mesmo par da
 * composição do faturamento, validado para daltonismo. Um eixo por gráfico;
 * cor nunca é o único canal (legenda, tooltip e tabela).
 */

const TOOLTIP = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "var(--radius-cell)",
    fontSize: 12,
  },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 600 },
};
const TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const ANIM = { isAnimationActive: true, animationDuration: 600, animationEasing: "ease-out" as const };

function Shell({
  title,
  question,
  actions,
  children,
  table,
}: {
  title: string;
  question: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  table: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
            <p className="mt-0.5 text-dense text-muted-foreground">{question}</p>
          </div>
          {actions}
        </div>
        <ClientOnly height={220}>
          <div className="mt-3 h-[220px]">{children}</div>
        </ClientOnly>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-caption text-muted-foreground hover:text-foreground">Ver em tabela</summary>
          <div className="mt-2 overflow-x-auto">{table}</div>
        </details>
      </CardContent>
    </Card>
  );
}

function Tabela({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-dense">
      <thead>
        <tr className="text-left text-muted-foreground">
          {head.map((h, i) => (
            <th key={h} className={`py-1 pr-3 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r[0])} className="border-t">
            {r.map((c, i) => (
              <td key={i} className={`py-1 pr-3 ${i > 0 ? "text-right tabular-nums" : ""}`}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ===================================================================
// MRR × TCV — janela móvel com filtro 3/6/12 meses
// ===================================================================

export type MrrTcvPoint = { label: string; mrr: number; tcv: number };
const JANELAS = [3, 6, 12] as const;

export function MrrTcvChart({ data }: { data: MrrTcvPoint[] }) {
  const [meses, setMeses] = useState<(typeof JANELAS)[number]>(6);
  const visiveis = data.slice(-meses);
  return (
    <Shell
      title="Evolução de MRR e TCV"
      question="Como a receita recorrente e os contratos fechados evoluíram mês a mês?"
      actions={
        <div role="group" aria-label="Período do gráfico" className="inline-flex rounded-lg border p-0.5">
          {JANELAS.map((j) => (
            <button
              key={j}
              type="button"
              aria-pressed={meses === j}
              onClick={() => setMeses(j)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                meses === j ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {j} meses
            </button>
          ))}
        </div>
      }
      table={
        <Tabela
          head={["Mês", "MRR", "TCV"]}
          rows={visiveis.map((d) => [d.label, formatBRL(d.mrr), formatBRL(d.tcv)])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        {/* key muda com o filtro → o gráfico redesenha animando */}
        <LineChart key={meses} data={visiveis} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK} />
          <YAxis tickLine={false} axisLine={false} width={64} tick={TICK} tickFormatter={(v: number) => formatBRLShort(v)} />
          <Tooltip {...TOOLTIP} formatter={(v: number, name: string) => [formatBRL(v), name]} />
          <Legend verticalAlign="top" align="left" height={26} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="mrr" name="MRR" stroke="hsl(var(--chart-1))" strokeWidth={2}
            dot={{ r: 3 }} activeDot={{ r: 5 }} {...ANIM} />
          <Line type="monotone" dataKey="tcv" name="TCV" stroke="hsl(var(--chart-6))" strokeWidth={2}
            dot={{ r: 3 }} activeDot={{ r: 5 }} {...ANIM} />
        </LineChart>
      </ResponsiveContainer>
    </Shell>
  );
}

// ===================================================================
// Ao longo do ano: clientes, churn e ticket médio
// ===================================================================

export type YearChartPoint = {
  label: string;
  ativos: number | null;
  churn: number | null;
  churnValue: number | null;
  ticket: number | null;
};

export function ClientsYearChart({ data, year }: { data: YearChartPoint[]; year: number }) {
  return (
    <Shell
      title={`Clientes ativos · ${year}`}
      question="Quantos clientes ativos havia no fim de cada mês?"
      table={<Tabela head={["Mês", "Clientes ativos"]} rows={data.map((d) => [d.label, d.ativos ?? "—"])} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -20 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={TICK} />
          <Tooltip {...TOOLTIP} cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
            formatter={(v: number) => [`${v} cliente(s)`, "Ativos"]} />
          <Bar dataKey="ativos" name="Ativos" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} {...ANIM} />
        </BarChart>
      </ResponsiveContainer>
    </Shell>
  );
}

export function ChurnYearChart({ data, year }: { data: YearChartPoint[]; year: number }) {
  return (
    <Shell
      title={`Churn de clientes · ${year}`}
      question="Quantos clientes saíram em cada mês — e quanto isso custou?"
      table={
        <Tabela
          head={["Mês", "Saídas", "Receita perdida"]}
          rows={data.map((d) => [d.label, d.churn ?? "—", d.churnValue == null ? "—" : formatBRL(d.churnValue)])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -20 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={TICK} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
            formatter={(v: number, _n: string, item: any) => [
              `${v} cliente(s) · ${formatBRL(item?.payload?.churnValue ?? 0)} perdidos`,
              "Churn",
            ]}
          />
          <Bar dataKey="churn" name="Churn" fill="hsl(var(--chart-6))" radius={[4, 4, 0, 0]} {...ANIM} />
        </BarChart>
      </ResponsiveContainer>
    </Shell>
  );
}

export function TicketYearChart({ data, year }: { data: YearChartPoint[]; year: number }) {
  return (
    <Shell
      title={`Ticket médio · ${year}`}
      question="Quanto cada cliente ativo representou de faturamento no mês?"
      table={
        <Tabela head={["Mês", "Ticket médio"]} rows={data.map((d) => [d.label, d.ticket == null ? "—" : formatBRL(d.ticket)])} />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={TICK} />
          <YAxis tickLine={false} axisLine={false} width={64} tick={TICK} tickFormatter={(v: number) => formatBRLShort(v)} />
          <Tooltip {...TOOLTIP} formatter={(v: number) => [formatBRL(v), "Ticket médio"]} />
          <Line type="monotone" dataKey="ticket" name="Ticket médio" stroke="hsl(var(--chart-1))" strokeWidth={2}
            dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} {...ANIM} />
        </LineChart>
      </ResponsiveContainer>
    </Shell>
  );
}
