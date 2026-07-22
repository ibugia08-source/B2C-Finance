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
  saveEmployee, deleteEmployee, ensurePayroll, addPayrollItem,
  deletePayrollItem, setPayrollStatus, saveCommission, deleteCommission,
} from "@/lib/actions/payroll";
import {
  Plus, Pencil, Trash2, Play, CheckCircle2, BadgeDollarSign, Percent, RefreshCw,
} from "lucide-react";
import { formatDateInput, formatDecimalInput as fmt } from "@/lib/format";

import { EMPLOYEE_TYPE_LABEL, ITEM_KIND_LABEL } from "./_meta";


export function EmployeeDialog({ initial, trigger }: { initial?: any; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline"><Plus className="h-4 w-4 mr-1" /> Colaborador</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar colaborador" : "Novo colaborador"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await saveEmployee(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="grid grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          <div className="col-span-2">
            <Label>Nome *</Label>
            <Input name="name" defaultValue={initial?.name ?? ""} required />
          </div>
          <div>
            <Label>Cargo / função</Label>
            <Input name="role" defaultValue={initial?.role ?? ""}
              placeholder="Gestor de tráfego, designer…" />
          </div>
          <div>
            <Label>Vínculo</Label>
            <Select name="type" defaultValue={initial?.type ?? "PJ"}>
              {Object.entries(EMPLOYEE_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Salário fixo (R$)</Label>
            <Input name="baseSalary" inputMode="decimal" placeholder="0,00"
              defaultValue={fmt(initial?.baseSalary)} />
          </div>
          <div>
            <Label>Início</Label>
            <Input type="date" name="startedAt"
              defaultValue={initial?.startedAt ? formatDateInput(initial.startedAt) : ""} />
          </div>
          <div className="col-span-2">
            <Label>Status</Label>
            <Select name="active" defaultValue={String(initial?.active ?? true)}>
              <option value="true">Ativo</option>
              <option value="false">Desligado</option>
            </Select>
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

export function EmployeeActions({ employee }: { employee: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <EmployeeDialog initial={employee} trigger={
        <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
      } />
      <Button variant="ghost" size="icon" disabled={pending}
        onClick={() => {
          if (!confirm(`Excluir "${employee.name}"?`)) return;
          start(async () => {
            const res = await deleteEmployee(employee.id);
            if (!res.ok) alert(res.error);
          });
        }}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

// ===== Folha do mês =====

export function GeneratePayrollButton({
  month,
  year,
  exists = false,
}: {
  month: number;
  year: number;
  /** true quando a folha já foi gerada — vira "Atualizar" (puxa comissões novas) */
  exists?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant={exists ? "outline" : "default"} disabled={pending}
        onClick={() => start(async () => {
          const res = await ensurePayroll(month, year);
          if (!res.ok) setError(res.error);
        })}>
        {exists ? <RefreshCw className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
        {pending ? "Processando…" : exists ? "Atualizar folha" : "Gerar folha do mês"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ===== Comissões =====

export function CommissionDialog({
  employees,
  clients,
  defaultMonth,
  defaultEmployeeId,
  trigger,
}: {
  employees: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  defaultMonth: string; // "YYYY-MM"
  defaultEmployeeId?: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <Percent className="h-4 w-4 mr-1" /> Nova comissão
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Registrar comissão</DialogTitle></DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await saveCommission(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="grid grid-cols-2 gap-3"
        >
          <div className="col-span-2">
            <Label>Colaborador *</Label>
            <Select name="employeeId" required defaultValue={defaultEmployeeId ?? ""}>
              <option value="">Selecione…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Competência *</Label>
            <Input type="month" name="competencia" required defaultValue={defaultMonth} />
          </div>
          <div>
            <Label>Valor (R$)</Label>
            <Input name="amount" inputMode="decimal" placeholder="0,00" />
            <p className="text-[10px] text-muted-foreground mt-0.5">vazio = base × percentual</p>
          </div>
          <div>
            <Label>Base de cálculo (R$)</Label>
            <Input name="basisAmount" inputMode="decimal" placeholder="ex.: 5000,00" />
          </div>
          <div>
            <Label>Percentual (%)</Label>
            <Input name="rate" inputMode="decimal" placeholder="ex.: 10" />
          </div>
          <div className="col-span-2">
            <Label>Cliente (opcional)</Label>
            <Select name="clientId" defaultValue="">
              <option value="">—</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Observação</Label>
            <Input name="notes" placeholder="ex.: venda contrato de tráfego junho" />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            A comissão entra na folha da competência ao clicar em “Gerar/Atualizar folha”
            e soma no total a pagar.
          </p>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Registrar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteCommissionButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="icon" disabled={pending}
      onClick={() => {
        if (!confirm("Excluir esta comissão pendente?")) return;
        start(async () => {
          const res = await deleteCommission(id);
          if (!res.ok) alert(res.error);
        });
      }}>
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

export function PayrollItemDialog({
  payrollId,
  employees,
  trigger,
}: {
  payrollId: string;
  employees: { id: string; name: string }[];
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-1" /> Adicionar item
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Item da folha</DialogTitle></DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await addPayrollItem(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="space-y-3"
        >
          <input type="hidden" name="payrollId" value={payrollId} />
          <div>
            <Label>Colaborador *</Label>
            <Select name="employeeId" required defaultValue="">
              <option value="">Selecione…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="kind" defaultValue="BONUS">
              {Object.entries(ITEM_KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Valor (R$) *</Label>
            <Input name="amount" inputMode="decimal" required placeholder="0,00" />
            <p className="text-xs text-muted-foreground mt-1">
              Descontos entram automaticamente como negativo no total.
            </p>
          </div>
          <div>
            <Label>Observação</Label>
            <Input name="notes" placeholder="opcional" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Adicionar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteItemButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="icon" disabled={pending}
      onClick={() => {
        if (!confirm("Remover este item da folha?")) return;
        start(async () => {
          const res = await deletePayrollItem(id);
          if (!res.ok) alert(res.error);
        });
      }}>
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
}

export function PayrollStatusButtons({ runId, status }: { runId: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set(s: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    start(async () => {
      setError(null);
      const res = await setPayrollStatus(runId, s);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {status === "DRAFT" && (
          <Button variant="outline" disabled={pending} onClick={() => set("APPROVED")}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> Aprovar
          </Button>
        )}
        {status !== "PAID" && (
          <Button disabled={pending}
            onClick={() =>
              set(
                "PAID",
                "Marcar folha como PAGA? Isso cria a despesa correspondente no financeiro."
              )
            }>
            <BadgeDollarSign className="h-4 w-4 mr-1" /> Marcar como paga
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
