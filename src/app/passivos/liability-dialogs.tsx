"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  saveLiability, deleteLiability, amortizeLiability, saveLoan, deleteLoan,
} from "@/lib/actions/assets";
import { Plus, Pencil, Trash2, MinusCircle } from "lucide-react";
import { formatDateInput } from "@/lib/format";

import { LIABILITY_TYPE_LABEL } from "./_meta";

const fmt = (v: any) => (v != null ? Number(v).toFixed(2).replace(".", ",") : "");

export function LiabilityDialog({ initial, trigger }: { initial?: any; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? <Button><Plus className="h-4 w-4 mr-1" /> Novo passivo</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{initial ? "Editar passivo" : "Novo passivo"}</DialogTitle></DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await saveLiability(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="grid grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          <div className="col-span-2">
            <Label>Nome *</Label>
            <Input name="name" defaultValue={initial?.name ?? ""} required
              placeholder="Parcelamento Simples, dívida fornecedor X…" />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="type" defaultValue={initial?.type ?? "OTHER"}>
              {Object.entries(LIABILITY_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Valor total (R$) *</Label>
            <Input name="totalValue" inputMode="decimal" required placeholder="0,00"
              defaultValue={fmt(initial?.totalValue)} />
          </div>
          <div>
            <Label>Saldo devedor (R$)</Label>
            <Input name="remainingValue" inputMode="decimal" placeholder="= total"
              defaultValue={fmt(initial?.remainingValue)} />
          </div>
          <div>
            <Label>Parcela mensal (R$)</Label>
            <Input name="monthlyPayment" inputMode="decimal" placeholder="0,00"
              defaultValue={fmt(initial?.monthlyPayment)} />
          </div>
          <div>
            <Label>Nº parcelas</Label>
            <Input type="number" min={1} name="installments" defaultValue={initial?.installments ?? ""} />
          </div>
          <div>
            <Label>Vencimento final</Label>
            <Input type="date" name="dueDate"
              defaultValue={initial?.dueDate ? formatDateInput(initial.dueDate) : ""} />
          </div>
          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea name="notes" defaultValue={initial?.notes ?? ""} />
          </div>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LiabilityActions({ liability }: { liability: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <AmortizeDialog liabilityId={liability.id} />
      <LiabilityDialog initial={liability} trigger={
        <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
      } />
      <Button variant="ghost" size="icon" disabled={pending}
        onClick={() => {
          if (!confirm(`Excluir o passivo "${liability.name}"?`)) return;
          start(async () => {
            const res = await deleteLiability(liability.id);
            if (!res.ok) alert(res.error);
          });
        }}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function AmortizeDialog({ liabilityId }: { liabilityId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Registrar amortização (reduz saldo devedor)">
          <MinusCircle className="h-4 w-4 text-emerald-600" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader><DialogTitle>Amortizar dívida</DialogTitle></DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await amortizeLiability(liabilityId, fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="space-y-3"
        >
          <div>
            <Label>Valor pago (R$) *</Label>
            <Input name="amount" inputMode="decimal" required placeholder="0,00" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Amortizar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ===== Empréstimos =====

export function LoanDialog({ initial, trigger }: { initial?: any; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline"><Plus className="h-4 w-4 mr-1" /> Novo empréstimo</Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar empréstimo" : "Novo empréstimo"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await saveLoan(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="grid grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          <div className="col-span-2">
            <Label>Credor *</Label>
            <Input name="lender" defaultValue={initial?.lender ?? ""} required
              placeholder="Banco, financeira, pessoa…" />
          </div>
          <div>
            <Label>Valor tomado (R$) *</Label>
            <Input name="principal" inputMode="decimal" required placeholder="0,00"
              defaultValue={fmt(initial?.principal)} />
          </div>
          <div>
            <Label>Juros (% a.m.)</Label>
            <Input name="interestRate" inputMode="decimal" placeholder="2,5"
              defaultValue={initial?.interestRate != null ? (Number(initial.interestRate) * 100).toFixed(2).replace(".", ",") : ""} />
          </div>
          <div>
            <Label>Nº parcelas *</Label>
            <Input type="number" min={1} name="installments" required
              defaultValue={initial?.installments ?? 12} />
          </div>
          <div>
            <Label>Valor da parcela (R$)</Label>
            <Input name="installmentValue" inputMode="decimal" placeholder="0,00"
              defaultValue={fmt(initial?.installmentValue)} />
          </div>
          <div>
            <Label>Saldo devedor (R$)</Label>
            <Input name="remainingValue" inputMode="decimal" placeholder="= valor tomado"
              defaultValue={fmt(initial?.remainingValue)} />
          </div>
          <div>
            <Label>1º vencimento</Label>
            <Input type="date" name="firstDueDate"
              defaultValue={initial?.firstDueDate ? formatDateInput(initial.firstDueDate) : ""} />
          </div>
          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea name="notes" defaultValue={initial?.notes ?? ""} />
          </div>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LoanActions({ loan }: { loan: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <LoanDialog initial={loan} trigger={
        <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
      } />
      <Button variant="ghost" size="icon" disabled={pending}
        onClick={() => {
          if (!confirm(`Excluir o empréstimo de "${loan.lender}"? (remove também o passivo vinculado)`)) return;
          start(async () => {
            const res = await deleteLoan(loan.id);
            if (!res.ok) alert(res.error);
          });
        }}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
