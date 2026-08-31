"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetricHelp } from "@/components/dashboard/metric-help";
import { cn } from "@/lib/utils";

/**
 * CARD DE MÉTRICA — implementação ÚNICA do sistema (T1 · ref. 02 §5.1, §7.2, §7.4, §7.6).
 *
 * Substitui os quatro componentes que faziam a mesma coisa de quatro
 * jeitos (StatCard, KpiCard, MetricCard da Dashboard, SecondaryStat). Os
 * nomes antigos continuam exportados daqui como PRESETS de 5 linhas —
 * são configurações desta função, não implementações paralelas.
 *
 * O que a spec exige e está aqui:
 *  · valor em mono tabular, nunca quebrando no meio (02 §7.2);
 *  · negativo com SINAL DE MENOS e cor semântica, jamais parênteses;
 *  · selo de base temporal ao lado de todo dinheiro (Competência|Caixa|Fotografia);
 *  · sparkline de 12 meses: 1.5px, sem eixos, área 8%, ponto final marcado (§7.4);
 *  · todo card abre detalhe já filtrado — por href ou por modal (§5.5);
 *  · nulo vira "—" e diz por quê, em vez de zero enganoso;
 *  · esqueleto na geometria real (§7.6) via <MetricCardSkeleton/>.
 */

export type DeltaInput = { pct: number | null; hasBase: boolean } | null;

/** Base temporal do número — 02 §5.5: "dinheiro informa base temporal". */
export type TemporalBasis = "competencia" | "caixa" | "fotografia";

const BASIS_LABEL: Record<TemporalBasis, string> = {
  competencia: "Competência",
  caixa: "Caixa",
  fotografia: "Fotografia",
};

/** Aceita os nomes dos 4 componentes antigos — migração sem reescrever chamadas. */
export type MetricTone =
  | "default" | "neutral"
  | "pos" | "positive"
  | "neg" | "negative"
  | "warn" | "warning";

function toneClass(tone: MetricTone): string {
  switch (tone) {
    case "pos":
    case "positive":
      return "text-success";
    case "neg":
    case "negative":
      return "text-destructive";
    case "warn":
    case "warning":
      return "text-warning";
    default:
      return "text-foreground";
  }
}

export type MetricCardProps = {
  title: string;
  /** Já formatado (formatBRL etc.). `null` = sem base para calcular → "—". */
  value: string | null;
  hint?: string;
  /** Texto do dicionário de métricas → ícone "?" no canto. */
  help?: string;
  tone?: MetricTone;
  delta?: DeltaInput;
  /** true: subir é bom. false: subir é ruim (despesa, vencido). */
  goodWhenUp?: boolean;
  /** Selo de base temporal — obrigatório quando o valor é dinheiro. */
  basis?: TemporalBasis;
  /** Série de 12 meses para a sparkline. */
  sparkline?: number[];
  /** Abre a tela já filtrada. */
  href?: string;
  /** Abre o detalhe em modal, sem sair da tela. Tem prioridade sobre href. */
  detail?: React.ReactNode;
  detailTitle?: string;
  footer?: React.ReactNode;
  /** sm = indicador secundário · md = padrão · lg = card do painel executivo. */
  size?: "sm" | "md" | "lg";
  /** Motivo de o valor ser nulo (vira o hint quando value === null). */
  nullReason?: string;
  className?: string;
};

const VALUE_SIZE = {
  sm: "text-emphasis",
  md: "text-xl xl:text-2xl",
  lg: "text-value",
} as const;

const PAD = { sm: "px-3 py-2.5", md: "p-4", lg: "p-5" } as const;

export function MetricCard({
  title,
  value,
  hint,
  help,
  tone = "default",
  delta,
  goodWhenUp = true,
  basis,
  sparkline,
  href,
  detail,
  detailTitle,
  footer,
  size = "md",
  nullReason,
  className,
}: MetricCardProps) {
  const [open, setOpen] = useState(false);
  const empty = value === null;
  const shownHint = empty ? (nullReason ?? "Sem base para calcular") : hint;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            "min-w-0 truncate font-medium uppercase text-muted-foreground",
            size === "sm" ? "text-[11px] tracking-wide" : "text-caption tracking-[0.12em]"
          )}
          title={title}
        >
          {title}
        </p>
        {help && <MetricHelp title={title} text={help} />}
      </div>

      <p
        className={cn(
          // Nunca quebrar no meio de um número ("R$ 84.911 / ,00").
          "stat-number mt-1.5 whitespace-nowrap font-semibold",
          VALUE_SIZE[size],
          empty ? "text-muted-foreground" : toneClass(tone)
        )}
      >
        {empty ? "—" : value}
      </p>

      {basis && !empty && <BasisBadge basis={basis} />}

      {delta !== undefined && !empty ? (
        <DeltaLine delta={delta} goodWhenUp={goodWhenUp} compact={size === "sm"} />
      ) : shownHint ? (
        <p className="mt-1 truncate text-caption text-muted-foreground" title={shownHint}>
          {shownHint}
        </p>
      ) : null}

      {sparkline && sparkline.length > 1 && !empty && (
        <Sparkline points={sparkline} className={cn("mt-3", toneClass(tone))} />
      )}
    </>
  );

  const shell = cn(
    "flex h-full flex-col rounded-card border bg-card text-left elev-1",
    PAD[size],
    className
  );
  const interactive =
    "transition-shadow duration-fast ease-out hover:elev-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  // Detalhe em modal tem prioridade: mantém o contexto e o período filtrado.
  if (detail) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={cn(shell, interactive)}>
          {body}
          {footer && (
            <div className="mt-3" onClick={(e) => e.stopPropagation()}>
              {footer}
            </div>
          )}
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{detailTitle ?? title}</DialogTitle>
            </DialogHeader>
            <div className="text-body">{detail}</div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (href) {
    return (
      <Link href={href} className={cn(shell, interactive)}>
        {body}
        {footer && <div className="mt-3">{footer}</div>}
      </Link>
    );
  }

  return (
    <div className={shell}>
      {body}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

/** Selo de base temporal — 02 §5.5: todo dinheiro diz de que base veio. */
function BasisBadge({ basis }: { basis: TemporalBasis }) {
  return (
    <span className="mt-1.5 inline-flex w-fit items-center rounded-pill border border-border-soft bg-surface-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {BASIS_LABEL[basis]}
    </span>
  );
}

/** Comparação com o período anterior. Sinal de menos, nunca parênteses. */
function DeltaLine({
  delta,
  goodWhenUp,
  compact,
}: {
  delta: DeltaInput;
  goodWhenUp: boolean;
  compact?: boolean;
}) {
  if (!delta || !delta.hasBase || delta.pct == null) {
    return <p className="mt-1 text-caption text-muted-foreground">Sem base anterior</p>;
  }
  const up = delta.pct >= 0;
  const good = goodWhenUp ? up : !up;
  const color =
    delta.pct === 0 ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  const Icon = delta.pct === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("mt-1 flex items-center gap-1 text-caption", color)}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {up ? "+" : "−"}
      {Math.abs(delta.pct * 100).toFixed(0)}%
      {!compact && <span className="text-muted-foreground">vs. período anterior</span>}
    </p>
  );
}

/**
 * Sparkline de 12 meses (02 §7.4): traço 1.5px, sem eixos, área a 8% e
 * ponto final marcado. `vectorEffect` preserva a espessura mesmo com o
 * SVG esticado na largura do card.
 */
export function Sparkline({
  points,
  className,
  height = 28,
}: {
  points: number[];
  className?: string;
  height?: number;
}) {
  const W = 100;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = points
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-7 w-full", className)}
      aria-hidden
      focusable="false"
    >
      <path d={`${line} L${W},${height} L0,${height} Z`} fill="currentColor" opacity={0.08} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={x(points.length - 1)}
        cy={y(points[points.length - 1])}
        r={2}
        fill="currentColor"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Estado CARREGANDO na geometria real do card (02 §7.6). */
export function MetricCardSkeleton({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <div className={cn("rounded-card border bg-card elev-1", PAD[size])} aria-hidden>
      <div className="h-3 w-24 animate-pulse rounded-pill bg-muted" />
      <div className="mt-2.5 h-7 w-32 animate-pulse rounded-cell bg-muted" />
      <div className="mt-2 h-3 w-20 animate-pulse rounded-pill bg-muted" />
    </div>
  );
}

/* ===================== PRESETS =====================
   Configurações da função acima — mantidos para não reescrever ~115
   chamadas. Código NOVO deve usar <MetricCard/> direto. */

/** Card simples de listagem: título, valor, dica. */
export function StatCard({
  title,
  value,
  hint,
  intent = "default",
  href,
}: {
  title: string;
  value: string;
  hint?: string;
  intent?: "default" | "positive" | "negative" | "warning";
  href?: string;
}) {
  return <MetricCard title={title} value={value} hint={hint} tone={intent} href={href} />;
}

/** Card de métrica clicável com ajuda — usado na Carteira. */
export function KpiCard({
  title,
  value,
  hint,
  help,
  href,
  tone = "default",
}: {
  title: string;
  value: string;
  hint?: string;
  help: string;
  href: string;
  tone?: MetricTone;
}) {
  return (
    <MetricCard title={title} value={value} hint={hint} help={help} href={href} tone={tone} />
  );
}

/** Indicador secundário compacto do painel executivo. */
export function SecondaryStat({
  label,
  value,
  help,
  hint,
  tone = "default",
  delta,
  goodWhenUp = true,
  detailTitle,
  detail,
}: {
  label: string;
  value: string;
  help?: string;
  hint?: string;
  tone?: MetricTone;
  delta?: DeltaInput;
  goodWhenUp?: boolean;
  detailTitle?: string;
  detail?: React.ReactNode;
}) {
  return (
    <MetricCard
      size="sm"
      title={label}
      value={value}
      help={help}
      hint={hint}
      tone={tone}
      delta={delta}
      goodWhenUp={goodWhenUp}
      detail={detail}
      detailTitle={detailTitle}
    />
  );
}
