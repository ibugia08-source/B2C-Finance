"use client";
import { useState, useTransition } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { launchResultToCash } from "@/lib/actions/cashboxes";
import { formatBRL, parseBRL } from "@/lib/format";
import { Wallet } from "lucide-react";

/**
 * Botão + modal "Lançar ao caixa" (Dashboard). Só é renderizado quando o
 * resultado do mês é positivo. Permite lançar o valor total ou parcial do
 * resultado disponível (resultado − já lançado) ao Caixa operacional.
 */
export function LaunchToCash({
  year,
  month,
  resultado,
  alreadyLaunched,
}: {
  year: number;
  month: number;
  resultado: number;
  alreadyLaunched: number;
}) {
  const disponivel = Math.max(0, resultado - alreadyLaunched);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(disponivel.toFixed(2).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (resultado <= 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={disponivel <= 0}
        onClick={(e) => {
          e.stopPropagation();
          setValue(disponivel.toFixed(2).replace(".", ","));
          setError(null);
          setOpen(true);
        }}
      >
        <Wallet className="h-3.5 w-3.5 mr-1.5" />
        {disponivel > 0 ? "Lançar ao caixa" : "Resultado já lançado"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Lançar resultado ao caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
              <Row label="Resultado do mês" value={formatBRL(resultado)} />
              {alreadyLaunched > 0 && (
                <Row label="Já lançado" value={`− ${formatBRL(alreadyLaunched)}`} muted />
              )}
              <Row label="Disponível para lançar" value={formatBRL(disponivel)} strong />
            </div>
            <div>
              <Label htmlFor="launch-value">Valor a lançar (R$)</Label>
              <Input
                id="launch-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Destino: <strong>Caixa operacional</strong> · origem: Resultado do mês.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const amount = parseBRL(value);
                  if (!amount || amount <= 0) { setError("Informe um valor válido."); return; }
                  if (amount > disponivel + 0.005) { setError("Valor acima do disponível."); return; }
                  const res = await launchResultToCash({ year, month, amount });
                  if (res.ok) setOpen(false);
                  else setError(res.error);
                })
              }
            >
              {pending ? "Lançando…" : "Lançar ao caixa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={muted ? "text-muted-foreground" : "text-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : muted ? "text-muted-foreground" : ""}`}>{value}</span>
    </div>
  );
}
