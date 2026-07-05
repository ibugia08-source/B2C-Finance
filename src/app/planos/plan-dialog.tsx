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
import { savePlan } from "@/lib/actions/plans";
import { Plus } from "lucide-react";
import { CONTRACT_TYPE_LABEL, RECURRENCE_LABEL } from "@/app/contratos/_meta";

export function PlanDialog({
  services,
  initial,
  trigger,
}: {
  services: { id: string; name: string }[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const included: string[] =
    initial?.services?.map((s: any) => s.serviceId) ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Novo plano
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar plano" : "Novo plano"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await savePlan(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div>
            <Label>Nome *</Label>
            <Input name="name" defaultValue={initial?.name ?? ""} required
              placeholder="Básico, Avançado, Completo…" />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="type" defaultValue={initial?.type ?? "MRR"}>
              {Object.entries(CONTRACT_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Valor padrão mensal (R$)</Label>
            <Input name="monthlyPrice" inputMode="decimal" placeholder="0,00" required
              defaultValue={
                initial?.monthlyPrice != null
                  ? Number(initial.monthlyPrice).toFixed(2).replace(".", ",")
                  : ""
              } />
          </div>
          <div>
            <Label>Setup (R$)</Label>
            <Input name="setupFee" inputMode="decimal" placeholder="0,00"
              defaultValue={
                initial?.setupFee != null
                  ? Number(initial.setupFee).toFixed(2).replace(".", ",")
                  : ""
              } />
          </div>

          <div>
            <Label>Periodicidade</Label>
            <Select name="recurrence" defaultValue={initial?.recurrence ?? "MONTHLY"}>
              {Object.entries(RECURRENCE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Duração padrão (meses)</Label>
            <Input type="number" min={1} name="defaultDuration"
              defaultValue={initial?.defaultDuration ?? ""} placeholder="12" />
          </div>

          <div className="col-span-full">
            <Label className="mb-1 block">Serviços inclusos</Label>
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Cadastre serviços primeiro em /servicos.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto rounded-md border p-3">
                {services.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="serviceIds"
                      value={s.id}
                      defaultChecked={included.includes(s.id)}
                      className="h-4 w-4"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Status</Label>
            <Select name="active" defaultValue={String(initial?.active ?? true)}>
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
            </Select>
          </div>
          <div>
            <Label>Descrição</Label>
            <Input name="description" defaultValue={initial?.description ?? ""} />
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
