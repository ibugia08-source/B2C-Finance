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
import { saveRule } from "@/lib/actions/rules";
import { Plus } from "lucide-react";

export function RuleDialog({
  categories,
  cards,
  initial,
  trigger,
}: {
  categories: any[];
  cards: any[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova regra
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar regra" : "Nova regra"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await saveRule(fd);
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
            <Label>Prioridade</Label>
            <Input name="priority" type="number" defaultValue={initial?.priority ?? 100} />
          </div>
          <div className="flex items-center gap-2 sm:pt-6">
            <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} />
            <Label>Ativa</Label>
          </div>

          <div className="col-span-2 border-t pt-3">
            <p className="text-sm font-semibold">Condições</p>
          </div>
          <div className="col-span-2">
            <Label>Descrição contém</Label>
            <Input name="descriptionContains" defaultValue={initial?.descriptionContains ?? ""} placeholder="Ex: META, UBER, POSTO..." />
          </div>
          <div>
            <Label>Cartão</Label>
            <Select name="cardId" defaultValue={initial?.cardId ?? ""}>
              <option value="">Qualquer</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Valor maior que</Label>
            <Input name="amountGreaterThan" defaultValue={initial?.amountGreaterThan ?? ""} placeholder="0,00" />
          </div>
          <div>
            <Label>Valor menor que</Label>
            <Input name="amountLessThan" defaultValue={initial?.amountLessThan ?? ""} placeholder="0,00" />
          </div>

          <div className="col-span-2 border-t pt-3">
            <p className="text-sm font-semibold">Ações</p>
          </div>
          <div>
            <Label>Categoria</Label>
            <Select name="categoryId" defaultValue={initial?.categoryId ?? ""}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Responsável (nome)</Label>
            <Input name="responsibleName" defaultValue={initial?.responsibleName ?? ""} />
          </div>
          <div>
            <Label>Pertence a</Label>
            <Select name="belongsTo" defaultValue={initial?.belongsTo ?? ""}>
              <option value="">—</option>
              <option value="pessoal">Pessoal</option>
              <option value="empresa">Empresa</option>
              <option value="terceiro">Terceiro</option>
              <option value="familiar">Familiar</option>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select name="status" defaultValue={initial?.status ?? ""}>
              <option value="">—</option>
              <option value="pendente">Pendente</option>
              <option value="pago">Pago</option>
              <option value="devendo">Devendo</option>
              <option value="reembolsado">Reembolsado</option>
            </Select>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" name="reimbursable" defaultChecked={initial?.reimbursable ?? false} />
            <Label>Marcar como reembolsável</Label>
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
