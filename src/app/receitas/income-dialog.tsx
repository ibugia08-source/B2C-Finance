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
import { saveIncome } from "@/lib/actions/incomes";
import { Plus } from "lucide-react";
import { formatDateInput } from "@/lib/format";

export function IncomeDialog({
  accounts,
  people,
  categories,
  clients = [],
  contracts = [],
  costCenters = [],
  initial,
  trigger,
}: {
  accounts: any[];
  people: any[];
  categories: any[];
  clients?: { id: string; name: string }[];
  contracts?: { id: string; title: string; clientId: string }[];
  costCenters?: { id: string; name: string }[];
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova receita
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar receita" : "Nova receita"}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await saveIncome(fd);
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
            <Label>Valor</Label>
            <Input
              name="amount"
              defaultValue={initial?.amount?.toString().replace(".", ",") ?? "0,00"}
              required
            />
          </div>
          <div>
            <Label>Data de recebimento</Label>
            <Input
              type="date"
              name="receivedAt"
              defaultValue={
                initial?.receivedAt
                  ? formatDateInput(initial.receivedAt)
                  : formatDateInput(new Date())
              }
              required
            />
          </div>

          <div>
            <Label>Origem</Label>
            <Select name="sourceType" defaultValue={initial?.sourceType ?? "BANK_ACCOUNT"}>
              <option value="BANK_ACCOUNT">Conta bancária</option>
              <option value="PIX">Pix</option>
              <option value="TRANSFER">Transferência</option>
              <option value="CASH">Dinheiro em espécie</option>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Receita não pode entrar em cartão de crédito.
            </p>
          </div>

          <div>
            <Label>Tipo</Label>
            <Select name="incomeType" defaultValue={initial?.incomeType ?? "OTHER"}>
              <option value="SALARY">Salário</option>
              <option value="EARNINGS">Rendimentos</option>
              <option value="COMPANY_WITHDRAWAL">Retirada da empresa</option>
              <option value="SALE">Venda</option>
              <option value="OTHER">Outro</option>
            </Select>
          </div>

          <div>
            <Label>Conta de destino</Label>
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
            <Label>Pessoa relacionada</Label>
            <Select name="personId" defaultValue={initial?.personId ?? ""}>
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

          <div>
            <Label>Status</Label>
            <Select name="status" defaultValue={initial?.status ?? "RECEIVED"}>
              <option value="RECEIVED">Recebido</option>
              <option value="EXPECTED">Previsto</option>
              <option value="LATE">Atrasado</option>
            </Select>
          </div>

          {/* ===== Classificação gerencial (agência) ===== */}
          <div className="col-span-2 border-t pt-3 mt-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Gestão da agência (opcional)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Tipo de receita</Label>
                <Select name="revenueType" defaultValue={initial?.revenueType ?? ""}>
                  <option value="">—</option>
                  <option value="MRR">Recorrente (MRR)</option>
                  <option value="TCV">Contrato fechado (TCV)</option>
                  <option value="ONE_TIME">Avulsa</option>
                  <option value="SETUP">Setup</option>
                  <option value="RECOVERY">Recuperação de inadimplência</option>
                  <option value="OTHER">Outra</option>
                </Select>
              </div>
              <div>
                <Label>Competência</Label>
                <Input
                  type="month"
                  name="competence"
                  defaultValue={
                    initial?.competenceYear && initial?.competenceMonth
                      ? `${initial.competenceYear}-${String(initial.competenceMonth).padStart(2, "0")}`
                      : ""
                  }
                />
              </div>
              <div>
                <Label>Cliente</Label>
                <Select name="clientId" defaultValue={initial?.clientId ?? ""}>
                  <option value="">—</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Contrato</Label>
                <Select name="contractId" defaultValue={initial?.contractId ?? ""}>
                  <option value="">—</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>Centro de custo</Label>
                <Select name="costCenterId" defaultValue={initial?.costCenterId ?? ""}>
                  <option value="">—</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
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
