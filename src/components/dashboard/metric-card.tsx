"use client";
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { MetricHelp } from "./metric-help";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export type DeltaInput = {
  pct: number | null;
  hasBase: boolean;
} | null;

/**
 * Card principal do Dashboard: valor em destaque, ícone de ajuda (?),
 * comparativo discreto com o mês anterior e clique para abrir o DETALHE
 * (modal) sem sair da Dashboard — mantém o contexto e o período filtrado.
 */
export function MetricCard({
  title,
  value,
  help,
  delta,
  goodWhenUp = true,
  valueTone = "default",
  detailTitle,
  detail,
  footer,
}: {
  title: string;
  value: string;
  help: string;
  delta?: DeltaInput;
  /** true: subir é bom (faturamento/recebido/resultado); false: subir é ruim (despesas/em aberto) */
  goodWhenUp?: boolean;
  valueTone?: "default" | "pos" | "neg";
  detailTitle: string;
  detail: React.ReactNode;
  /** ação opcional no rodapé do card (ex.: Lançar ao caixa) */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const valueColor =
    valueTone === "pos" ? "text-success" : valueTone === "neg" ? "text-destructive" : "text-foreground";

  return (
    <>
      <Card
        className="cursor-pointer transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring"
        onClick={() => setOpen(true)}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              className="text-left text-[11px] uppercase tracking-wide text-muted-foreground font-medium focus:outline-none"
              onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            >
              {title}
            </button>
            <MetricHelp title={title} text={help} />
          </div>
          <p className={cn("text-lg xl:text-xl 2xl:text-2xl font-semibold stat-number mt-1.5 whitespace-nowrap", valueColor)}>{value}</p>
          <DeltaLine delta={delta} goodWhenUp={goodWhenUp} />
          {footer && <div className="mt-3" onClick={(e) => e.stopPropagation()}>{footer}</div>}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailTitle}</DialogTitle>
          </DialogHeader>
          <div className="text-sm">{detail}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Linha de comparação com o mês anterior (verde/vermelho/cinza). */
function DeltaLine({ delta, goodWhenUp }: { delta?: DeltaInput; goodWhenUp: boolean }) {
  if (!delta || !delta.hasBase || delta.pct == null) {
    return <p className="text-[11px] text-muted-foreground mt-1">Sem dados do mês anterior</p>;
  }
  const up = delta.pct >= 0;
  const good = goodWhenUp ? up : !up;
  const color = delta.pct === 0 ? "text-muted-foreground" : good ? "text-success" : "text-destructive";
  const Icon = delta.pct === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const pctText = `${Math.abs(delta.pct * 100).toFixed(0)}%`;
  return (
    <p className={cn("text-[11px] mt-1 flex items-center gap-1", color)}>
      <Icon className="h-3 w-3" />
      {up ? "+" : "−"}{pctText} <span className="text-muted-foreground">vs mês anterior</span>
    </p>
  );
}
