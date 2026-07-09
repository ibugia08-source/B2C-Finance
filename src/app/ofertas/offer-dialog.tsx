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
import { Checkbox } from "@/components/ui/checkbox";
import { saveOffer } from "@/lib/actions/offers";
import { Plus } from "lucide-react";

export const OFFER_MODALITY_LABEL: Record<string, string> = {
  MRR: "MRR (recorrente mensal)",
  TCV: "TCV (valor fechado)",
  CUSTOM: "Personalizado",
};

const PAYMENT_METHODS = ["Pix", "Boleto", "Cartão", "Transferência", "Outro"];

type ServiceOption = { id: string; name: string };

export function OfferDialog({
  services,
  initial,
  trigger,
}: {
  services: ServiceOption[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    new Set<string>(initial?.serviceIds ?? [])
  );

  const fmt = (v: any) =>
    v != null ? Number(v).toFixed(2).replace(".", ",") : "";

  function toggleService(id: string) {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
        if (o) setSelectedServices(new Set<string>(initial?.serviceIds ?? []));
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova oferta
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Editar oferta" : "Nova oferta"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              // Serviços selecionados entram como múltiplos serviceIds.
              selectedServices.forEach((id) => fd.append("serviceIds", id));
              const res = await saveOffer(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div className="col-span-full">
            <Label>Nome da oferta *</Label>
            <Input
              name="name"
              defaultValue={initial?.name ?? ""}
              placeholder="ex.: Avançado Óticas"
              required
            />
          </div>

          <div>
            <Label>Modalidade</Label>
            <Select name="modality" defaultValue={initial?.modality ?? "MRR"}>
              {Object.entries(OFFER_MODALITY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Valor padrão (R$)</Label>
            <Input
              name="defaultValue"
              inputMode="decimal"
              placeholder="0,00"
              defaultValue={fmt(initial?.defaultValue)}
            />
          </div>

          <div>
            <Label>Duração padrão (meses)</Label>
            <Input
              name="durationMonths"
              type="number"
              min={1}
              placeholder="ex.: 3"
              defaultValue={initial?.durationMonths ?? ""}
            />
          </div>
          <div>
            <Label>Forma de pagamento</Label>
            <Select name="paymentMethod" defaultValue={initial?.paymentMethod ?? ""}>
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>

          <div className="col-span-full">
            <Label>Serviços incluídos</Label>
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">
                Cadastre serviços em /servicos para incluí-los na oferta.
              </p>
            ) : (
              <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 rounded-lg border p-3 max-h-44 overflow-y-auto">
                {services.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 text-sm cursor-pointer rounded-md px-1.5 py-1 hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={selectedServices.has(s.id)}
                      onChange={() => toggleService(s.id)}
                    />
                    <span className="truncate">{s.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Status</Label>
            <Select name="active" defaultValue={String(initial?.active ?? true)}>
              <option value="true">Ativa</option>
              <option value="false">Inativa</option>
            </Select>
          </div>
          <div className="hidden sm:block" />

          <div className="col-span-full">
            <Label>Descrição</Label>
            <Textarea
              name="description"
              defaultValue={initial?.description ?? ""}
              placeholder="o que esta oferta entrega para o cliente"
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
