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
  clients = [],
  services = [],
  initial,
  trigger,
}: {
  people: any[];
  categories: any[];
  accounts: any[];
  clients?: { id: string; name: string }[];
  services?: { id: string; name: string }[];
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

          {/* ===== Classificação gerencial (agência) ===== */}
          <div className="col-span-2 border-t pt-3 mt-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Gestão da agência (opcional)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Tipo de despesa</Label>
                <Select name="expenseType" defaultValue={initial?.expenseType ?? ""}>
                  <option value="">—</option>
                  <option value="FIXED">Fixa</option>
                  <option value="VARIABLE">Variável</option>
                  <option value="TOOL">Ferramenta</option>
                  <option value="ADS">Tráfego / Ads</option>
                  <option value="TAX">Imposto</option>
                  <option value="CARD">Cartão</option>
                  <option value="LOAN">Empréstimo</option>
                  <option value="PAYROLL">Equipe / Folha</option>
                  <option value="OTHER">Geral</option>
                </Select>
              </div>
              <div>
                <Label>Recorrência</Label>
                <Select name="recurrence" defaultValue={initial?.recurrence ?? ""}>
                  <option value="">—</option>
                  <option value="NONE">Única</option>
                  <option value="MONTHLY">Mensal</option>
                  <option value="QUARTERLY">Trimestral</option>
                  <option value="SEMIANNUAL">Semestral</option>
                  <option value="ANNUAL">Anual</option>
                </Select>
              </div>
              <div>
                <Label>Cliente vinculado</Label>
                <Select name="clientId" defaultValue={initial?.clientId ?? ""}>
                  <option value="">—</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Serviço vinculado</Label>
                <Select name="serviceId" defaultValue={initial?.serviceId ?? ""}>
                  <option value="">—</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </div>
            </div>
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
