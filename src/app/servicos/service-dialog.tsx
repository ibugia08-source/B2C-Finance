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
import { saveService } from "@/lib/actions/services";
import { Plus } from "lucide-react";

export const SERVICE_CATEGORIES = [
  "Tráfego pago",
  "Social media",
  "Web / Sites",
  "SEO",
  "CRM",
  "Consultoria",
  "IA",
  "Automação",
  "Método CFC",
  "Outros",
];

export function ServiceDialog({
  initial,
  trigger,
}: {
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Novo serviço
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar serviço" : "Novo serviço"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await saveService(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div>
            <Label>Nome *</Label>
            <Input name="name" defaultValue={initial?.name ?? ""} required />
          </div>
          <div>
            <Label>Categoria</Label>
            <Select name="category" defaultValue={initial?.category ?? ""}>
              <option value="">—</option>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Status</Label>
            <Select name="active" defaultValue={String(initial?.active ?? true)}>
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
            </Select>
          </div>

          <div className="col-span-full">
            <Label>Descrição</Label>
            <Textarea name="description" defaultValue={initial?.description ?? ""} />
          </div>
          <p className="col-span-full text-xs text-muted-foreground">
            Os valores de venda ficam nas <span className="font-medium">Ofertas (Planos)</span> —
            o serviço é só o catálogo do que a agência entrega.
          </p>

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
