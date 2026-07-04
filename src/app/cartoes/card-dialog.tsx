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
import { saveCard } from "@/lib/actions/cards";
import { Plus } from "lucide-react";

export function CardDialog({
  people,
  accounts = [],
  initial,
  trigger,
}: {
  people: any[];
  accounts?: any[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova conta bancária
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar conta bancária" : "Nova conta bancária"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await saveCard(fd);
            setOpen(false);
          }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          <div className="col-span-2">
            <Label>Nome</Label>
            <Input name="name" defaultValue={initial?.name ?? ""} required />
          </div>
          <div>
            <Label>Banco</Label>
            <Input name="bank" defaultValue={initial?.bank ?? ""} />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="type" defaultValue={initial?.type ?? "pessoal"}>
              <option value="pessoal">Pessoal</option>
              <option value="empresarial">Empresarial</option>
              <option value="terceiro">Terceiro</option>
            </Select>
          </div>
          <div>
            <Label>Titular</Label>
            <Select name="holderId" defaultValue={initial?.holderId ?? ""}>
              <option value="">—</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Conta vinculada</Label>
            <Select name="accountId" defaultValue={initial?.accountId ?? ""}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Limite total</Label>
            <Input name="limitTotal" defaultValue={initial?.limitTotal?.toString().replace(".", ",") ?? "0,00"} />
          </div>
          <div>
            <Label>Dia de fechamento</Label>
            <Input name="closingDay" type="number" min={1} max={31} defaultValue={initial?.closingDay ?? 1} />
          </div>
          <div>
            <Label>Dia de vencimento</Label>
            <Input name="dueDay" type="number" min={1} max={31} defaultValue={initial?.dueDay ?? 10} />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} />
            <Label>Ativo</Label>
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
