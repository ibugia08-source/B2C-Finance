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
import { saveContract } from "@/lib/actions/contracts";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_TYPE_LABEL,
  RECURRENCE_LABEL,
} from "./_meta";

type ServiceOpt = { id: string; name: string; defaultPrice: number | null };
type PlanOpt = {
  id: string;
  name: string;
  type: string;
  recurrence: string;
  monthlyPrice: number;
  setupFee: number | null;
  defaultDuration: number | null;
  serviceIds: string[];
};

const fmtMoney = (v: number | null | undefined) =>
  v != null ? Number(v).toFixed(2).replace(".", ",") : "";

export function ContractDialog({
  clients,
  plans,
  services,
  initial,
  defaultClientId,
  trigger,
}: {
  clients: { id: string; name: string }[];
  plans: PlanOpt[];
  services: ServiceOpt[];
  initial?: any;
  defaultClientId?: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Serviços selecionados (id → preço em texto BRL)
  const initialSel: Record<string, string> = {};
  for (const cs of initial?.services ?? []) {
    initialSel[cs.serviceId] = fmtMoney(cs.unitPrice);
  }
  const [selected, setSelected] = useState<Record<string, string>>(initialSel);
  // Campos que o plano pré-preenche
  const [monthly, setMonthly] = useState<string>(fmtMoney(initial?.monthlyValue));
  const [setup, setSetup] = useState<string>(fmtMoney(initial?.setupFee));
  const [type, setType] = useState<string>(initial?.type ?? "MRR");
  const [recurrence, setRecurrence] = useState<string>(initial?.recurrence ?? "MONTHLY");

  function applyPlan(planId: string) {
    const p = plans.find((x) => x.id === planId);
    if (!p) return;
    setMonthly(fmtMoney(p.monthlyPrice));
    setSetup(fmtMoney(p.setupFee));
    setType(p.type);
    setRecurrence(p.recurrence);
    const sel: Record<string, string> = {};
    for (const sid of p.serviceIds) {
      const svc = services.find((s) => s.id === sid);
      sel[sid] = fmtMoney(svc?.defaultPrice ?? 0);
    }
    setSelected(sel);
  }

  function toggleService(id: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else {
        const svc = services.find((s) => s.id === id);
        next[id] = fmtMoney(svc?.defaultPrice ?? 0);
      }
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Novo contrato
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar contrato" : "Novo contrato"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await saveContract(fd);
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
              defaultValue={initial?.clientId ?? defaultClientId ?? ""}
              required
            >
              <option value="">Selecione…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Plano (pré-preenche)</Label>
            <Select
              name="planId"
              defaultValue={initial?.planId ?? ""}
              onChange={(e) => applyPlan(e.target.value)}
            >
              <option value="">Sem plano</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>

          <div className="col-span-full">
            <Label>Título do contrato *</Label>
            <Input name="title" defaultValue={initial?.title ?? ""} required
              placeholder="Gestão de tráfego — Plano Avançado" />
          </div>

          <div>
            <Label>Tipo</Label>
            <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(CONTRACT_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Periodicidade</Label>
            <Select
              name="recurrence"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
            >
              {Object.entries(RECURRENCE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Valor mensal reconhecido (R$)</Label>
            <Input name="monthlyValue" inputMode="decimal" placeholder="0,00"
              value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">
              Vazio + valor total + fim → calculado (total ÷ meses).
            </p>
          </div>
          <div>
            <Label>Valor total do contrato — TCV (R$)</Label>
            <Input name="totalValue" inputMode="decimal" placeholder="0,00"
              defaultValue={fmtMoney(initial?.totalValue)} />
            <p className="text-xs text-muted-foreground mt-1">
              Vazio + mensal + fim → calculado (mensal × meses).
            </p>
          </div>

          <div>
            <Label>Setup (R$)</Label>
            <Input name="setupFee" inputMode="decimal" placeholder="0,00"
              value={setup} onChange={(e) => setSetup(e.target.value)} />
          </div>
          <div>
            <Label>Dia de vencimento</Label>
            <Input type="number" min={1} max={28} name="billingDay"
              defaultValue={initial?.billingDay ?? 5} />
          </div>

          <div>
            <Label>Início *</Label>
            <Input type="date" name="startDate" required
              defaultValue={initial?.startDate ? formatDateInput(initial.startDate) : ""} />
          </div>
          <div>
            <Label>Fim (vigência)</Label>
            <Input type="date" name="endDate"
              defaultValue={initial?.endDate ? formatDateInput(initial.endDate) : ""} />
          </div>

          <div>
            <Label>Próxima renovação</Label>
            <Input type="date" name="renewalDate"
              defaultValue={initial?.renewalDate ? formatDateInput(initial.renewalDate) : ""} />
          </div>
          <div>
            <Label>Status</Label>
            <Select name="status" defaultValue={initial?.status ?? "ACTIVE"}>
              {Object.entries(CONTRACT_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>

          <div className="col-span-full flex items-center gap-2">
            <input type="checkbox" id="autoRenew" name="autoRenew"
              defaultChecked={initial?.autoRenew ?? false} className="h-4 w-4" />
            <Label htmlFor="autoRenew">Renovação automática</Label>
          </div>

          <div className="col-span-full">
            <Label className="mb-1 block">Serviços contratados</Label>
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Cadastre serviços primeiro em /servicos.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-md border p-3">
                {services.map((s) => {
                  const checked = s.id in selected;
                  return (
                    <div key={s.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="services"
                        value={s.id}
                        checked={checked}
                        onChange={() => toggleService(s.id)}
                        className="h-4 w-4"
                      />
                      <span className="flex-1 text-sm">{s.name}</span>
                      {checked && (
                        <Input
                          name={`price_${s.id}`}
                          inputMode="decimal"
                          className="h-8 w-28 text-right"
                          value={selected[s.id]}
                          onChange={(e) =>
                            setSelected((prev) => ({ ...prev, [s.id]: e.target.value }))
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="col-span-full">
            <Label>Observações</Label>
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
