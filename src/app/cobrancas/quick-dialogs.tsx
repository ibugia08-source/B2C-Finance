"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wallet, BadgeCheck } from "lucide-react";
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
import { saveIncome } from "@/lib/actions/incomes";
import { saveExpense } from "@/lib/actions/expenses";
import { generateApproveAndPayPayroll } from "@/lib/actions/payroll";
import { EXPENSE_TYPE_LABEL } from "@/app/despesas/_meta";

/**
 * Lançamentos RÁPIDOS da Gestão do Mês — a linha da planilha, não o
 * formulário completo: 4-5 campos com defaults do mês selecionado.
 * O cadastro completo continua nas telas próprias (link em cada seção).
 */

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Data default dentro da competência: hoje (se for o mês) ou dia 1º. */
function defaultDateFor(month: number, year: number): string {
  const now = new Date();
  if (now.getFullYear() === year && now.getMonth() + 1 === month) return toDateInput(now);
  return toDateInput(new Date(year, month - 1, 1));
}

// ===== Outras Entradas =====

export function EntradaQuickDialog({ month, year }: { month: number; year: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const competence = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" /> Nova entrada
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova entrada — {String(month).padStart(2, "0")}/{year}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              try {
                await saveIncome(fd);
                setOpen(false);
                router.refresh();
              } catch (e: any) {
                setError(e?.message ?? "Falha ao lançar a entrada.");
              }
            })
          }
          className="grid grid-cols-2 gap-3"
        >
          <input type="hidden" name="competence" value={competence} />
          <div className="col-span-2">
            <Label>Descrição *</Label>
            <Input
              name="description"
              required
              placeholder="ex.: Projeto de site — Grafitel"
            />
          </div>
          <div>
            <Label>Valor (R$) *</Label>
            <Input name="amount" inputMode="decimal" required placeholder="0,00" />
          </div>
          <div>
            <Label>Data *</Label>
            <Input
              type="date"
              name="receivedAt"
              defaultValue={defaultDateFor(month, year)}
              required
            />
          </div>
          <div className="col-span-2">
            <Label>Situação</Label>
            <Select name="status" defaultValue="RECEIVED">
              <option value="RECEIVED">Recebido</option>
              <option value="EXPECTED">Previsto</option>
            </Select>
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Entrada avulsa fora das mensalidades (projeto, venda pontual,
            reembolso…). Recuperações de inadimplência entram sozinhas quando o
            pagamento atrasado é registrado.
          </p>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Lançando…" : "Lançar entrada"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ===== Contas a Pagar =====

export function ContaQuickDialog({
  month,
  year,
  categories,
}: {
  month: number;
  year: number;
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" /> Nova conta
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conta a pagar — {String(month).padStart(2, "0")}/{year}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await saveExpense(fd);
              if (res.ok) {
                setOpen(false);
                router.refresh();
              } else setError(res.error);
            })
          }
          className="grid grid-cols-2 gap-3"
        >
          <div className="col-span-2">
            <Label>Descrição *</Label>
            <Input name="description" required placeholder="ex.: Aluguel escritório" />
          </div>
          <div>
            <Label>Valor (R$) *</Label>
            <Input name="amount" inputMode="decimal" required placeholder="0,00" />
          </div>
          <div>
            <Label>Vencimento *</Label>
            <Input
              type="date"
              name="dueDate"
              defaultValue={defaultDateFor(month, year)}
              required
            />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="expenseType" defaultValue="FIXED">
              {Object.entries(EXPENSE_TYPE_LABEL)
                .filter(([v]) => v !== "CARD")
                .map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label>Categoria</Label>
            <Select name="categoryId" defaultValue="">
              <option value="">— sem categoria —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Repetir</Label>
            <Select name="recurrence" defaultValue="NONE">
              <option value="NONE">Só este mês</option>
              <option value="MONTHLY">Todo mês</option>
            </Select>
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Cartões, faturas e parcelamentos ficam em Contas a Pagar.
          </p>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar conta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ===== Folha =====

export function PagarFolhaButton({
  month,
  year,
  runStatus,
  total,
}: {
  month: number;
  year: number;
  runStatus: string | null;
  total: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (runStatus === "PAID") {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
        <BadgeCheck className="h-4 w-4" /> Folha paga
      </span>
    );
  }

  const label = runStatus == null ? "Gerar e pagar folha" : "Pagar folha";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Wallet className="h-4 w-4 mr-1" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Pagar folha de {String(month).padStart(2, "0")}/{year}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {runStatus == null
            ? "A folha da competência será gerada com os salários dos colaboradores ativos e as comissões do mês, aprovada e marcada como PAGA."
            : "A folha será aprovada e marcada como PAGA."}{" "}
          Isso cria a despesa de folha no mês
          {total > 0
            ? ` (total atual: ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})`
            : ""}{" "}
          e quita as comissões aprovadas. Ajustes finos (bônus, descontos,
          adiantamentos) ficam na tela Folha.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await generateApproveAndPayPayroll(month, year);
                if (res.ok) {
                  setOpen(false);
                  router.refresh();
                } else setError(res.error);
              })
            }
          >
            {pending ? "Pagando…" : "Confirmar pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
