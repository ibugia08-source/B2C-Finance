"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";
import { addPastDelinquency } from "@/lib/actions/receivables-inline";

/**
 * Registro manual de inadimplência de MÊS ANTERIOR: cria a cobrança vencida
 * na competência informada (histórico do cliente + relatórios). Não cria
 * Receita Extra — Receita Extra é apenas manual.
 */

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function PastDelinquencyDialog({
  clients,
}: {
  clients: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const years: number[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) years.push(y);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <AlertTriangle className="h-4 w-4 mr-1 text-amber-500" /> Adicionar inadimplência anterior
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar inadimplência anterior</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Registra um valor não pago de um mês passado. Entra no histórico do
          cliente e nos relatórios; não cria Receita Extra.
        </p>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await addPastDelinquency(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-2 gap-3"
        >
          <div className="col-span-full">
            <Label>Cliente *</Label>
            <Select name="clientId" required defaultValue="">
              <option value="">Selecione…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Mês de referência *</Label>
            <Select name="refMonth" defaultValue={String(prev.getMonth() + 1)}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Ano de referência *</Label>
            <Select name="refYear" defaultValue={String(prev.getFullYear())}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Valor inadimplente (R$) *</Label>
            <Input name="amount" inputMode="decimal" placeholder="0,00" required />
          </div>
          <div>
            <Label>Vencimento original</Label>
            <Input type="date" name="dueDate" />
          </div>
          <div className="col-span-full">
            <Label>Observação (opcional)</Label>
            <Textarea name="notes" rows={2} />
          </div>
          {error && <p className="col-span-full text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-full">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Registrando…" : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
