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
import { saveTransaction } from "@/lib/actions/transactions";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";

export function TransactionDialog({
  cards,
  people,
  categories,
  accounts,
  trigger,
  initial,
}: {
  cards: any[];
  people: any[];
  categories: any[];
  accounts: any[];
  trigger?: React.ReactNode;
  initial?: any;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova transação
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar transação" : "Nova transação"}</DialogTitle>
        </DialogHeader>

        <form
          action={async (fd) => {
            await saveTransaction(fd);
            setOpen(false);
          }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div className="col-span-1">
            <Label>Data</Label>
            <Input
              name="date"
              type="date"
              defaultValue={initial?.date ? formatDateInput(initial.date) : formatDateInput(new Date())}
              required
            />
          </div>

          <div className="col-span-1">
            <Label>Valor</Label>
            <Input name="amount" defaultValue={initial?.amount?.toString().replace(".", ",") ?? ""} placeholder="0,00" required />
          </div>

          <div className="col-span-2">
            <Label>Descrição</Label>
            <Input name="description" defaultValue={initial?.description ?? ""} required />
          </div>

          <div>
            <Label>Tipo</Label>
            <Select name="type" defaultValue={initial?.type ?? "despesa"}>
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
              <option value="transferencia">Transferência</option>
              <option value="ajuste">Ajuste</option>
            </Select>
          </div>

          <div>
            <Label>Origem</Label>
            <Select name="origin" defaultValue={initial?.origin ?? "cartao"}>
              <option value="cartao">Cartão</option>
              <option value="pix">Pix</option>
              <option value="debito">Débito</option>
              <option value="boleto">Boleto</option>
              <option value="dinheiro">Dinheiro</option>
            </Select>
          </div>

          <div>
            <Label>Cartão</Label>
            <Select name="cardId" defaultValue={initial?.cardId ?? ""}>
              <option value="">—</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Conta</Label>
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
            <Label>Categoria</Label>
            <Select name="categoryId" defaultValue={initial?.categoryId ?? ""}>
              <option value="">— (auto via regras)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
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
            <Label>Quem pagou</Label>
            <Select name="payerId" defaultValue={initial?.payerId ?? ""}>
              <option value="">—</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Pertence a</Label>
            <Select name="belongsTo" defaultValue={initial?.belongsTo ?? "pessoal"}>
              <option value="pessoal">Pessoal</option>
              <option value="empresa">Empresa</option>
              <option value="terceiro">Terceiro</option>
              <option value="familiar">Familiar</option>
            </Select>
          </div>

          <div>
            <Label>Status</Label>
            <Select name="status" defaultValue={initial?.status ?? "pendente"}>
              <option value="pendente">Pendente</option>
              <option value="pago">Pago</option>
              <option value="devendo">Devendo</option>
              <option value="reembolsado">Reembolsado</option>
              <option value="cancelado">Cancelado</option>
            </Select>
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" name="reimbursable" defaultChecked={initial?.reimbursable} />
            <Label>Reembolsável</Label>
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
