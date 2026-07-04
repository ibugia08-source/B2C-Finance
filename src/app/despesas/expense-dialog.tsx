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
import { saveExpense } from "@/lib/actions/expenses";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";

export function ExpenseDialog({
  people,
  categories,
  accounts,
  initial,
  trigger,
}: {
  people: any[];
  categories: any[];
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
            <Plus className="h-4 w-4 mr-1" /> Nova despesa
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar despesa" : "Nova despesa"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await saveExpense(fd);
            setOpen(false);
          }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div className="col-span-2">
            <Label>Descrição</Label>
            <Input name="description" defaultValue={initial?.description ?? ""} required />
          </div>

          <div>
            <Label>Valor total</Label>
            <Input
              name="amount"
              defaultValue={initial?.amount?.toString().replace(".", ",") ?? "0,00"}
              required
            />
          </div>
          <div>
            <Label>Data da despesa</Label>
            <Input
              type="date"
              name="date"
              defaultValue={
                initial?.date ? formatDateInput(initial.date) : formatDateInput(new Date())
              }
              required
            />
          </div>

          <div>
            <Label>Forma de pagamento</Label>
            <Select name="origin" defaultValue={initial?.origin ?? "debito"}>
              <option value="debito">Cartão de débito</option>
              <option value="pix">Pix</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="boleto">Boleto</option>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select name="status" defaultValue={initial?.status ?? "pendente"}>
              <option value="pendente">A vencer / pendente</option>
              <option value="pago">Pago</option>
              <option value="cancelado">Cancelado</option>
            </Select>
          </div>

          <div>
            <Label>Data de vencimento</Label>
            <Input
              type="date"
              name="dueDate"
              defaultValue={initial?.dueDate ? formatDateInput(initial.dueDate) : ""}
            />
          </div>
          <div>
            <Label>Nº de parcelas</Label>
            <Input
              name="installments"
              type="number"
              min={1}
              max={60}
              defaultValue={initial?.installmentsCount ?? 1}
            />
          </div>

          <div>
            <Label>Pessoa responsável</Label>
            <Select name="responsibleId" defaultValue={initial?.responsibleId ?? ""}>
              <option value="">—</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
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

          <div className="col-span-2">
            <Label>Conta de origem (opcional)</Label>
            <Select name="accountId" defaultValue={initial?.accountId ?? ""}>
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
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
