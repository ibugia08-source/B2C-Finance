"use client";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
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
import { salvarNicho } from "@/lib/actions/niches";

/**
 * Cadastro de nicho (só ADMIN). Nome que normaliza igual a um nicho
 * existente é recusado pela action — a mensagem aparece aqui, no diálogo.
 */
export function NicheDialog({
  initial,
  trigger,
}: {
  initial?: { id: string; name: string };
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();
  const id = initial?.id ?? "novo";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setErro(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Novo nicho
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Renomear nicho" : "Novo nicho"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setErro(null);
              const res = await salvarNicho(fd);
              if (res.ok) setOpen(false);
              else setErro(res.error);
            })
          }
          className="space-y-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          <div>
            <Label htmlFor={`nicho-nome-${id}`}>Nome do nicho *</Label>
            <Input
              id={`nicho-nome-${id}`}
              name="name"
              defaultValue={initial?.name ?? ""}
              required
              maxLength={80}
              placeholder="ex.: Odontologia"
              aria-describedby={`nicho-nome-ajuda-${id}`}
            />
            <p id={`nicho-nome-ajuda-${id}`} className="mt-1 text-caption text-muted-foreground">
              {initial
                ? "Renomear atualiza o nicho em todos os clientes que o usam."
                : "Cada nicho é cadastrado uma vez e vale para toda a plataforma."}
            </p>
          </div>
          {erro && (
            <p role="alert" className="text-dense text-danger-ink">
              {erro}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
