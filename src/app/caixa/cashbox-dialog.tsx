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
import { Textarea } from "@/components/ui/textarea";
import { saveCashBox } from "@/lib/actions/cashboxes";
import { Plus } from "lucide-react";

export function CashBoxDialog({
  accounts,
  initial,
  trigger,
}: {
  accounts: any[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Novo caixa
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar caixa" : "Novo caixa"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await saveCashBox(fd);
            setOpen(false);
          }}
          className="space-y-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          <div>
            <Label>Nome</Label>
            <Input name="name" defaultValue={initial?.name ?? ""} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Valor atual</Label>
              <Input
                name="currentAmount"
                defaultValue={initial?.currentAmount?.toString().replace(".", ",") ?? "0,00"}
                required
              />
            </div>
            <div>
              <Label>Valor alvo (opcional)</Label>
              <Input
                name="targetAmount"
                defaultValue={initial?.targetAmount?.toString().replace(".", ",") ?? ""}
                placeholder="0,00"
              />
            </div>
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="type" defaultValue={initial?.type ?? "PERSONAL"}>
              <option value="PERSONAL">Caixa pessoal</option>
              <option value="EMERGENCY">Reserva de emergência</option>
              <option value="INVESTMENT">Investimento</option>
              <option value="COMPANY">Empresa</option>
              <option value="GOAL">Objetivo específico</option>
              <option value="OTHER">Outro</option>
            </Select>
          </div>
          <div>
            <Label>Conta vinculada (opcional)</Label>
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
            <Label>Observações</Label>
            <Textarea name="notes" defaultValue={initial?.notes ?? ""} />
          </div>
          <DialogFooter>
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
