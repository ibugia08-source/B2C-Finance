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
import { saveUpsell } from "@/lib/actions/upsells";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";
import { UPSELL_STATUSES, UPSELL_STATUS_LABEL } from "./_meta";

type Opt = { id: string; name: string };

export function UpsellDialog({
  clients,
  services,
  offers,
  initial,
  trigger,
}: {
  clients: Opt[];
  services: Opt[];
  offers: Opt[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const fmt = (v: any) =>
    v != null ? Number(v).toFixed(2).replace(".", ",") : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova oportunidade
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {initial?.id ? "Editar oportunidade" : "Nova oportunidade de upsell"}
          </DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await saveUpsell(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div className="col-span-full">
            <Label>Cliente *</Label>
            <Select name="clientId" defaultValue={initial?.clientId ?? ""} required>
              <option value="">Selecione…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Serviço sugerido</Label>
            <Select name="serviceId" defaultValue={initial?.serviceId ?? ""}>
              <option value="">—</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Oferta sugerida</Label>
            <Select name="offerId" defaultValue={initial?.offerId ?? ""}>
              <option value="">—</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="col-span-full">
            <Label>Descrição da oportunidade</Label>
            <Input
              name="title"
              defaultValue={initial?.title ?? ""}
              placeholder="ex.: adicionar Google Ads ao plano atual"
            />
          </div>

          <div>
            <Label>Valor potencial (R$) *</Label>
            <Input
              name="value"
              inputMode="decimal"
              placeholder="0,00"
              defaultValue={fmt(initial?.value)}
              required
            />
          </div>
          <div>
            <Label>Responsável</Label>
            <Input
              name="responsible"
              defaultValue={initial?.responsible ?? ""}
              placeholder="vazio = responsável do cliente"
            />
          </div>

          <div>
            <Label>Status</Label>
            <Select name="status" defaultValue={initial?.status ?? "OPPORTUNITY"}>
              {UPSELL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {UPSELL_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Previsão de fechamento</Label>
            <Input
              type="date"
              name="expectedCloseAt"
              defaultValue={
                initial?.expectedCloseAt ? formatDateInput(initial.expectedCloseAt) : ""
              }
            />
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
