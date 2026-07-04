"use client";
import { useState } from "react";
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
import { saveAccountCard } from "@/lib/actions/account-cards";
import { Plus } from "lucide-react";

export function AccountCardDialog({
  cardId,
  initial,
  trigger,
}: {
  cardId: string;
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" /> Adicionar cartão
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar cartão" : "Novo cartão"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await saveAccountCard(fd);
            setOpen(false);
          }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <input type="hidden" name="cardId" value={cardId} />
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div className="col-span-2">
            <Label>Nome do cartão</Label>
            <Input
              name="name"
              defaultValue={initial?.name ?? ""}
              placeholder="Ex.: Físico Israel"
              required
            />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="kind" defaultValue={initial?.kind ?? "fisico"}>
              <option value="fisico">Físico</option>
              <option value="virtual">Virtual</option>
            </Select>
          </div>
          <div>
            <Label>Últimos 4 dígitos</Label>
            <Input
              name="lastDigits"
              defaultValue={initial?.lastDigits ?? ""}
              maxLength={4}
              inputMode="numeric"
              placeholder="0000"
            />
          </div>
          <div className="col-span-2">
            <Label>Limite individual</Label>
            <Input
              name="limit"
              defaultValue={initial?.limit?.toString().replace(".", ",") ?? "0,00"}
            />
          </div>

          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
