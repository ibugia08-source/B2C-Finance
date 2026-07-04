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
import { saveGoal } from "@/lib/actions/goals";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";

export function GoalDialog({ initial, trigger }: { initial?: any; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova meta
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar meta" : "Nova meta"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await saveGoal(fd);
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
            <Label>Tipo</Label>
            <Select name="type" defaultValue={initial?.type ?? "economia"}>
              <option value="economia">Economia</option>
              <option value="quitacao">Quitação</option>
              <option value="investimento">Investimento</option>
              <option value="reserva">Reserva</option>
            </Select>
          </div>
          <div>
            <Label>Prioridade (1-5)</Label>
            <Input name="priority" type="number" min={1} max={5} defaultValue={initial?.priority ?? 3} />
          </div>
          <div>
            <Label>Valor alvo</Label>
            <Input name="targetAmount" defaultValue={initial?.targetAmount?.toString().replace(".", ",") ?? "0,00"} />
          </div>
          <div>
            <Label>Valor atual</Label>
            <Input name="currentAmount" defaultValue={initial?.currentAmount?.toString().replace(".", ",") ?? "0,00"} />
          </div>
          <div className="col-span-2">
            <Label>Prazo</Label>
            <Input
              type="date"
              name="deadline"
              defaultValue={initial?.deadline ? formatDateInput(initial.deadline) : ""}
            />
          </div>
          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea name="notes" defaultValue={initial?.notes ?? ""} />
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
