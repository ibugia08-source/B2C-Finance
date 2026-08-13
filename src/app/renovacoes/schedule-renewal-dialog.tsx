"use client";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { scheduleClientRenewal } from "@/lib/actions/renewals";
import { MONTHS } from "@/app/clientes/_meta";
import { CalendarPlus } from "lucide-react";

/**
 * Agendar renovação manualmente: escolhe o cliente e o mês em que ele deve
 * aparecer na lista de renovações (Gestão do Mês e módulo Renovações).
 * Grava Client.renewalMonth — a mesma agenda editável da carteira.
 */
export function ScheduleRenewalDialog({
  clients,
  defaultMonth,
  trigger,
}: {
  clients: { id: string; name: string }[];
  defaultMonth: number; // 1-12 (mês em exibição)
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [clientId, setClientId] = useState("");
  const [month, setMonth] = useState(defaultMonth);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(term));
  }, [clients, q]);

  function submit() {
    if (!clientId) {
      setError("Selecione o cliente.");
      return;
    }
    start(async () => {
      setError(null);
      const res = await scheduleClientRenewal(clientId, month);
      if (res.ok) {
        setOpen(false);
        setClientId("");
        setQ("");
      } else setError(res.error);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          // Ressincroniza com o mês em exibição a cada abertura (o componente
          // fica montado enquanto o usuário navega entre meses).
          setMonth(defaultMonth);
          setError(null);
        } else setError(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Agendar renovação
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agendar renovação</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Buscar cliente</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filtrar por nome…"
            />
          </div>
          <div>
            <Label>Cliente *</Label>
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— selecionar —</option>
              {filtered.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Mês da renovação *</Label>
            <Select value={String(month)} onChange={(e) => setMonth(parseInt(e.target.value, 10))}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              O cliente passa a aparecer na lista de renovações deste mês
              (agenda anual — a mesma coluna Renovação da carteira).
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Salvando…" : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
