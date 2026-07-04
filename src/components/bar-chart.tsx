import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "income" | "expense" | "cash";

const TONE_GRADIENT: Record<Tone, string> = {
  income: "from-emerald-600 to-emerald-400",
  expense: "from-rose-600 to-rose-400",
  cash: "from-[#6F2CFF] to-[#9A6CFF]",
};

/**
 * Gráfico de colunas mensal — leve (CSS/Tailwind), sem dependências.
 * Tooltip nativo (title) + valor ao passar o mouse (group-hover).
 */
export function MonthlyBarChart({
  labels,
  values,
  tone = "cash",
}: {
  labels: string[];
  values: number[];
  tone?: Tone;
}) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));

  return (
    <div className="overflow-hidden">
      <div className="flex items-end gap-1.5 h-40 border-b border-border/60">
        {values.map((v, i) => {
          const pct = (Math.abs(v) / max) * 100;
          const h = v !== 0 ? Math.max(6, pct) : 0;
          return (
            <div
              key={i}
              // min-w-0: o valor de hover não pode ditar a largura mínima da
              // coluna (estourava o card com valores grandes tipo R$ 101.000,00)
              className="flex-1 min-w-0 h-full flex flex-col justify-end items-center group"
            >
              <span className="mb-1 max-w-full truncate text-[9px] font-medium tabular-nums text-foreground/80 opacity-0 group-hover:opacity-100 transition-opacity">
                {formatBRL(v)}
              </span>
              <div
                className={cn(
                  "w-full rounded-t-md bg-gradient-to-t transition-[height] hover:brightness-110",
                  TONE_GRADIENT[tone]
                )}
                style={{ height: `${h}%` }}
                title={`${labels[i]}: ${formatBRL(v)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-2">
        {labels.map((l, i) => (
          <div
            key={i}
            className="flex-1 min-w-0 text-center text-[10px] text-muted-foreground capitalize truncate"
          >
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
