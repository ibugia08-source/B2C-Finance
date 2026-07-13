"use client";
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  type Baseline,
  type ScenarioInput,
  type Goals,
  EMPTY_SCENARIO,
  currentScenario,
  projectScenario,
  analyzeGaps,
  buildNarrative,
  marginTone,
  profitTone,
  type Tone,
} from "@/lib/financial/projections";
import { Lightbulb, RotateCcw } from "lucide-react";

/** Cores discretas do Design System B2C (azul/verde/amarelo/vermelho/cinza). */
const TONE_CLASS: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30",
  green:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  yellow:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
  gray: "bg-muted text-muted-foreground border-transparent",
};

function parseNum(v: string): number {
  if (!v) return 0;
  const cleaned = v.replace(/[R$\s.]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

function TonePill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone]
      )}
    >
      {children}
    </span>
  );
}

function NumField({
  label,
  value,
  onChange,
  hint,
  isCount = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  isCount?: boolean;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        inputMode={isCount ? "numeric" : "decimal"}
        placeholder={isCount ? "0" : "0,00"}
        value={value === 0 ? "" : isCount ? String(value) : String(value).replace(".", ",")}
        onChange={(e) =>
          onChange(isCount ? Math.max(0, parseInt(e.target.value || "0", 10) || 0) : parseNum(e.target.value))
        }
      />
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

export function ProjectionSimulator({ baseline }: { baseline: Baseline }) {
  const [scenario, setScenario] = useState<ScenarioInput>(EMPTY_SCENARIO);
  const [goalsInput, setGoals] = useState<Goals>({
    metaFaturamento: null,
    margemDesejada: 30,
    metaLucro: null,
  });

  // Meta de lucro é DERIVADA (faturamento × margem) — um campo a menos.
  const goals = useMemo<Goals>(
    () => ({
      ...goalsInput,
      metaLucro:
        goalsInput.metaFaturamento != null && goalsInput.margemDesejada != null
          ? Math.round(goalsInput.metaFaturamento * (goalsInput.margemDesejada / 100))
          : null,
    }),
    [goalsInput]
  );

  const atual = useMemo(() => currentScenario(baseline), [baseline]);
  const projetado = useMemo(
    () => projectScenario(baseline, scenario),
    [baseline, scenario]
  );
  const gaps = useMemo(
    () => analyzeGaps(baseline, projetado, goals),
    [baseline, projetado, goals]
  );
  const narrative = useMemo(
    () => buildNarrative(baseline, atual, projetado, goals, gaps),
    [baseline, atual, projetado, goals, gaps]
  );

  const set = (k: keyof ScenarioInput) => (v: number) =>
    setScenario((s) => ({ ...s, [k]: v }));

  const diff = (a: number, b: number) => {
    const d = b - a;
    if (Math.abs(d) < 0.005) return null;
    return d;
  };

  const rows: {
    label: string;
    atual: number;
    projetado: number;
    fmt: (v: number) => string;
    tone: Tone;
  }[] = [
    { label: "Receita", atual: atual.receita, projetado: projetado.receita, fmt: formatBRL, tone: projetado.receita >= atual.receita ? "green" : "red" },
    { label: "Despesas", atual: atual.despesas, projetado: projetado.despesas, fmt: formatBRL, tone: projetado.despesas <= atual.despesas ? "green" : "yellow" },
    { label: "Lucro", atual: atual.lucro, projetado: projetado.lucro, fmt: formatBRL, tone: profitTone(projetado.lucro) },
    { label: "Margem", atual: atual.margem, projetado: projetado.margem, fmt: (v) => `${v.toFixed(1)}%`, tone: marginTone(projetado.margem, goals.margemDesejada) },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* ===== Coluna 1: metas + simulação ===== */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
              Metas
            </p>
            <div className="space-y-3">
              <NumField
                label="Meta de faturamento (R$/mês)"
                value={goals.metaFaturamento ?? 0}
                onChange={(v) => setGoals((g) => ({ ...g, metaFaturamento: v || null }))}
              />
              <div>
                <Label className="text-xs">Margem saudável desejada (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={95}
                  value={goals.margemDesejada ?? ""}
                  onChange={(e) =>
                    setGoals((g) => ({
                      ...g,
                      margemDesejada: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              A meta de lucro é calculada: faturamento × margem desejada.
            </p>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Simular cenário
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setScenario(EMPTY_SCENARIO)}
              >
                <RotateCcw className="h-3 w-3 mr-1" /> Zerar
              </Button>
            </div>
            <div className="space-y-3">
              <NumField label="Aumento de MRR (R$/mês)" value={scenario.aumentoMrr} onChange={set("aumentoMrr")} />
              <NumField label="Aumento de TCV no mês (R$)" value={scenario.aumentoTcv} onChange={set("aumentoTcv")} />
              <NumField
                label="Upsell vendido (R$)"
                value={scenario.aumentoUpsell}
                onChange={set("aumentoUpsell")}
                hint={`pipeline aberto: ${formatBRL(baseline.upsellPipeline)}`}
              />
              <NumField
                label="Inadimplência recuperada (R$)"
                value={scenario.recuperacaoInadimplencia}
                onChange={set("recuperacaoInadimplencia")}
                hint={`vencido em aberto: ${formatBRL(baseline.inadimplenciaAberta)}`}
              />
              <NumField label="Redução de despesas (R$/mês)" value={scenario.reducaoDespesas} onChange={set("reducaoDespesas")} />
              <details className="rounded-md border">
                <summary className="cursor-pointer select-none px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                  Avançado — perdas e folha
                </summary>
                <div className="space-y-3 p-2.5 pt-1">
                  <NumField
                    label="Perda de clientes MRR (nº)"
                    value={scenario.perdaClientesMrr}
                    onChange={set("perdaClientesMrr")}
                    isCount
                    hint={`ticket médio MRR: ${formatBRL(baseline.avgTicketMrr)}`}
                  />
                  <NumField label="Contratação / aumento de folha (R$/mês)" value={scenario.aumentoFolha} onChange={set("aumentoFolha")} />
                </div>
              </details>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Coluna 2: atual × projetado ===== */}
      <Card>
        <CardContent className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
            Cenário atual × projetado
          </p>
          <div className="space-y-3">
            {rows.map((r) => {
              const d = diff(r.atual, r.projetado);
              return (
                <div key={r.label} className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium w-20">{r.label}</span>
                  <span className="text-sm text-muted-foreground text-right flex-1">
                    {r.fmt(r.atual)}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-right flex-1">
                    <TonePill tone={r.tone}>{r.fmt(r.projetado)}</TonePill>
                    {d != null && (
                      <span
                        className={cn(
                          "block text-[11px] mt-0.5",
                          d > 0 ? "text-emerald-600" : "text-red-600"
                        )}
                      >
                        {d > 0 ? "+" : ""}
                        {r.label === "Margem" ? `${d.toFixed(1)} p.p.` : formatBRL(d)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="border-t mt-4 pt-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Distância até as metas
            </p>
            {goals.metaFaturamento == null && goals.margemDesejada == null && goals.metaLucro == null ? (
              <p className="text-sm text-muted-foreground">Defina metas ao lado.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {goals.metaFaturamento != null && (
                  <li className="flex justify-between">
                    <span>Meta de faturamento</span>
                    <TonePill tone={(gaps.gapFaturamento ?? 0) <= 0 ? "green" : "yellow"}>
                      {(gaps.gapFaturamento ?? 0) <= 0 ? "atingida ✓" : `faltam ${formatBRL(gaps.gapFaturamento!)}`}
                    </TonePill>
                  </li>
                )}
                {goals.margemDesejada != null && (
                  <li className="flex justify-between">
                    <span>Margem desejada ({goals.margemDesejada}%)</span>
                    <TonePill tone={(gaps.gapMargem ?? 0) <= 0 ? "green" : marginTone(projetado.margem, goals.margemDesejada)}>
                      {(gaps.gapMargem ?? 0) <= 0 ? "atingida ✓" : `faltam ${gaps.gapMargem!.toFixed(1)} p.p.`}
                    </TonePill>
                  </li>
                )}
                {goals.metaLucro != null && (
                  <li className="flex justify-between">
                    <span>Meta de lucro</span>
                    <TonePill tone={(gaps.gapLucro ?? 0) <= 0 ? "green" : "yellow"}>
                      {(gaps.gapLucro ?? 0) <= 0 ? "atingida ✓" : `faltam ${formatBRL(gaps.gapLucro!)}`}
                    </TonePill>
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="border-t mt-4 pt-4 space-y-1.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              O que seria necessário
            </p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between">
                <span>Aumentar receita</span>
                <span className="font-medium">
                  {gaps.aumentoReceitaNecessario != null ? formatBRL(gaps.aumentoReceitaNecessario) : "—"}
                </span>
              </li>
              <li className="flex justify-between">
                <span>ou reduzir despesas</span>
                <span className="font-medium">
                  {gaps.reducaoDespesasNecessaria != null ? formatBRL(gaps.reducaoDespesasNecessaria) : "—"}
                </span>
              </li>
              <li className="flex justify-between">
                <span>Novos clientes MRR</span>
                <span className="font-medium">{gaps.novosMrrsNecessarios ?? "—"}</span>
              </li>
              <li className="flex justify-between">
                <span>Vendas TCV</span>
                <span className="font-medium">{gaps.tcvsNecessarios ?? "—"}</span>
              </li>
              <li className="flex justify-between">
                <span>Upsell a vender</span>
                <span className="font-medium">
                  {gaps.upsellNecessario ? formatBRL(gaps.upsellNecessario) : "—"}
                </span>
              </li>
              <li className="flex justify-between">
                <span>Inadimplência a recuperar</span>
                <span className="font-medium">
                  {gaps.inadimplenciaARecuperar ? formatBRL(gaps.inadimplenciaARecuperar) : "—"}
                </span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* ===== Coluna 3: resumo estratégico ===== */}
      <Card className="border-primary/25 bg-primary/[0.03]">
        <CardContent className="p-5">
          <p className="text-xs uppercase tracking-wide text-primary font-medium mb-3 flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" /> Resumo estratégico
          </p>
          <p className="text-sm leading-relaxed">{narrative}</p>

          <div className="border-t mt-4 pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
              Legenda de cores
            </p>
            <div className="flex flex-wrap gap-1.5">
              <TonePill tone="blue">Oportunidade / ação sugerida</TonePill>
              <TonePill tone="green">Saudável</TonePill>
              <TonePill tone="yellow">Atenção</TonePill>
              <TonePill tone="red">Crítico</TonePill>
              <TonePill tone="gray">Neutro</TonePill>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
