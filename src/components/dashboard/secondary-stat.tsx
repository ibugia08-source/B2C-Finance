"use client";
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { MetricHelp } from "./metric-help";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { DeltaInput } from "./metric-card";

/**
 * Card compacto dos indicadores gerenciais (menor que o MetricCard principal):
 * título pequeno, valor médio, tooltip de ajuda (?), comparativo discreto
 * opcional e — quando houver `detail` — clique abre um modal na própria
 * Dashboard (não redireciona).
 */
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
  tone?: "default" | "pos" | "neg" | "warn";
  delta?: DeltaInput;
  goodWhenUp?: boolean;
  detailTitle?: string;
  detail?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const clickable = !!detail;

  const color =
    tone === "pos" ? "text-success"
      : tone === "neg" ? "text-destructive"
      : tone === "warn" ? "text-warning"
      : "text-foreground";

  return (
    <>
      <div
        className={cn(
          "rounded-lg border bg-card px-3 py-2.5",
          clickable && "cursor-pointer transition-shadow hover:shadow-sm"
        )}
        onClick={clickable ? () => setOpen(true) : undefined}
      >
        <div className="flex items-start justify-between gap-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium truncate" title={label}>
            {label}
          </p>
          {help && <MetricHelp title={label} text={help} />}
        </div>
        <p className={cn("text-base font-semibold stat-number mt-0.5 whitespace-nowrap", color)}>{value}</p>
        {delta ? (
          <DeltaMini delta={delta} goodWhenUp={goodWhenUp} />
        ) : (
          hint && <p className="text-[11px] text-muted-foreground truncate" title={hint}>{hint}</p>
        )}
      </div>

      {clickable && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{detailTitle ?? label}</DialogTitle>
            </DialogHeader>
            <div className="text-sm">{detail}</div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function DeltaMini({ delta, goodWhenUp }: { delta: DeltaInput; goodWhenUp: boolean }) {
  if (!delta || !delta.hasBase || delta.pct == null) {
    return <p className="text-[11px] text-muted-foreground">Sem base anterior</p>;
  }
  const up = delta.pct >= 0;
  const good = goodWhenUp ? up : !up;
  const color = delta.pct === 0 ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  const Icon = delta.pct === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("text-[11px] flex items-center gap-0.5", color)}>
      <Icon className="h-3 w-3" />
      {up ? "+" : "−"}{Math.abs(delta.pct * 100).toFixed(0)}%
    </p>
  );
}
