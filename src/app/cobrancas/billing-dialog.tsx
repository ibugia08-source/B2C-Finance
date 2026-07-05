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
import { saveBilling } from "@/lib/actions/billings";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";
import { REVENUE_TYPE_LABEL } from "./_meta";

export function BillingDialog({
  clients,
  contracts,
  services,
  initial,
  trigger,
}: {
  clients: { id: string; name: string }[];
  contracts: { id: string; title: string; clientId: string }[];
  services: { id: string; name: string }[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState<string>(initial?.clientId ?? "");

  const clientContracts = contracts.filter((c) => c.clientId === clientId);
  const now = new Date();
  const defaultCompetence = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const initialCompetence = initial
    ? `${initial.competenceYear}-${String(initial.competenceMonth).padStart(2, "0")}`
    : defaultCompetence;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova cobrança
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar cobrança" : "Nova cobrança manual"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await saveBilling(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div>
            <Label>Cliente *</Label>
            <Select
              name="clientId"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Contrato (opcional)</Label>
            <Select name="contractId" defaultValue={initial?.contractId ?? ""}>
              <option value="">Avulsa (sem contrato)</option>
              {clientContracts.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </Select>
          </div>

          <div className="col-span-full">
            <Label>Descrição *</Label>
            <Input name="description" defaultValue={initial?.description ?? ""} required
              placeholder="Mensalidade — Gestão de tráfego" />
          </div>

          <div>
            <Label>Valor esperado (R$) *</Label>
            <Input name="amount" inputMode="decimal" required placeholder="0,00"
              defaultValue={
                initial?.amount != null
                  ? Number(initial.amount).toFixed(2).replace(".", ",")
                  : ""
              } />
          </div>
          <div>
            <Label>Vencimento *</Label>
            <Input type="date" name="dueDate" required
              defaultValue={initial?.dueDate ? formatDateInput(initial.dueDate) : ""} />
          </div>

          <div>
            <Label>Mês de referência *</Label>
            <Input type="month" name="competence" defaultValue={initialCompetence} required />
          </div>
          <div>
            <Label>Tipo de receita</Label>
            <Select name="revenueType" defaultValue={initial?.revenueType ?? "ONE_TIME"}>
              {Object.entries(REVENUE_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Serviço (se aplicável)</Label>
            <Select name="serviceId" defaultValue={initial?.serviceId ?? ""}>
              <option value="">—</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Responsável pela cobrança</Label>
            <Input name="collector" defaultValue={initial?.collector ?? ""} />
          </div>

          <div className="col-span-full">
            <Label>Observação</Label>
            <Textarea name="notes" defaultValue={initial?.notes ?? ""} />
          </div>

          {error && <p className="col-span-full text-sm text-destructive">{error}</p>}

          <DialogFooter className="col-span-full">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
