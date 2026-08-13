"use client";
import { useState, useTransition } from "react";
import { formatBRL0 } from "@/lib/format";
import { useRouter } from "next/navigation";
import { Pencil, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { saveAnnualTarget } from "@/lib/actions/annual-target";

/**
 * Bloco 🎯 META ANUAL da planilha: meta de faturamento do ano, % atingida
 * e média mensal necessária no restante do ano. Edição inline para quem
 * tem configuracoes.editar.
 */

export function MetaAnual({
  year,
  target,
  achieved,
  monthsLeft,
  canEdit,
}: {
  year: number;
  target: number | null;
  achieved: number;
  monthsLeft: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pctMeta = target && target > 0 ? achieved / target : null;
  const mediaNecessaria =
    target && monthsLeft > 0 ? Math.max(0, target - achieved) / monthsLeft : null;

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Target className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Meta anual {year}
              </p>
              {editing ? (
                <form
                  className="mt-0.5 flex items-center gap-1.5"
                  action={(fd) =>
                    start(async () => {
                      setError(null);
                      const res = await saveAnnualTarget(
                        year,
                        String(fd.get("meta") ?? "")
                      );
                      if (res.ok) {
                        setEditing(false);
                        router.refresh();
                      } else setError(res.error);
                    })
                  }
                >
                  <Input
                    name="meta"
                    inputMode="decimal"
                    autoFocus
                    className="h-8 w-36"
                    defaultValue={
                      target ? target.toFixed(2).replace(".", ",") : "3.000.000,00"
                    }
                  />
                  <Button size="sm" className="h-8" type="submit" disabled={pending}>
                    {pending ? "…" : "Salvar"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    type="button"
                    onClick={() => setEditing(false)}
                  >
                    Cancelar
                  </Button>
                </form>
              ) : (
                <p className="stat-number text-xl font-bold">
                  {target ? formatBRL0(target) : "— defina a meta"}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label="Editar meta anual"
                      className="ml-2 inline-flex align-middle text-muted-foreground hover:text-foreground"
                      onClick={() => setEditing(true)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </p>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Acumulado no ano
            </p>
            <p className="stat-number text-xl font-bold text-success">{formatBRL0(achieved)}</p>
          </div>

          <div className="min-w-[180px] flex-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              % da meta atingida
            </p>
            {pctMeta != null ? (
              <div className="mt-1 flex items-center gap-2">
                <div className="h-2.5 flex-1 max-w-[220px] overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${pctMeta >= 1 ? "bg-success" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, pctMeta * 100)}%` }}
                  />
                </div>
                <span className="stat-number text-sm font-semibold">
                  {(pctMeta * 100).toFixed(1).replace(".", ",")}%
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Média mensal necessária
            </p>
            <p className="stat-number text-xl font-bold">
              {mediaNecessaria != null ? formatBRL0(mediaNecessaria) : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {monthsLeft > 0 ? `nos próximos ${monthsLeft} mês(es)` : "ano encerrado"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
