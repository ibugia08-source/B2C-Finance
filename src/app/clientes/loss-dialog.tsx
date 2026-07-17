"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { markClientLost } from "@/lib/actions/clients";
import { UserX } from "lucide-react";

/** Motivos padronizados de perda (o detalhe livre complementa). */
const LOSS_REASONS = [
  "Preço / orçamento",
  "Insatisfação com resultados",
  "Fim de contrato (não renovou)",
  "Problemas financeiros do cliente",
  "Foi para a concorrência",
  "Encerrou a operação",
  "Outro",
];

/**
 * Perda de cliente pela carteira: informa a DATA da saída e o MOTIVO.
 * Ao confirmar, o cliente vira Perdido (sai da lista padrão) e a perda
 * entra nos indicadores de churn com snapshot da receita perdida.
 */
export function ClientLossDialog({
  clientId,
  clientName,
  trigger,
}: {
  clientId: string;
  clientName: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" title="Perda de cliente">
            <UserX className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Perda de cliente — {clientName}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const motivo = String(fd.get("motivo") ?? "").trim();
            const detalhes = String(fd.get("detalhes") ?? "").trim();
            const reason = detalhes
              ? motivo ? `${motivo} — ${detalhes}` : detalhes
              : motivo;
            const res = await markClientLost(
              clientId,
              String(fd.get("lostAt") ?? ""),
              reason
            );
            if (res.ok) setOpen(false);
            else setError(res.error);
          })}
          className="space-y-3"
        >
          <div>
            <Label>Data da saída *</Label>
            <Input type="date" name="lostAt" required defaultValue={todayStr} />
          </div>
          <div>
            <Label>Motivo da perda *</Label>
            <Select name="motivo" required defaultValue="">
              <option value="" disabled>
                Selecione o motivo…
              </option>
              {LOSS_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Detalhes (opcional)</Label>
            <Textarea
              name="detalhes"
              placeholder="contexto da perda, feedback do cliente…"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            O cliente ficará com status <strong>Perdido</strong> e sairá da lista
            de clientes. A perda entra nos indicadores de churn. Para revê-lo,
            use o chip/filtro “Perdidos”.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Registrando…" : "Registrar perda"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
