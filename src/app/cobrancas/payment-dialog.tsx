"use client";
import { useState, useTransition } from "react";
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
import { registerBillingPayment } from "@/lib/actions/billings";
import { formatDateInput } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "./_meta";

/** Registra pagamento total (valor pré-preenchido) ou parcial (edite o valor). */
export function PaymentDialog({
  billing,
  accounts,
  trigger,
}: {
  billing: { id: string; openAmount: number; description: string };
  accounts: { id: string; name: string }[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">{billing.description}</p>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await registerBillingPayment(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-2 gap-3"
        >
          <input type="hidden" name="billingId" value={billing.id} />
          <div>
            <Label>Valor (R$)</Label>
            <Input
              name="amount"
              inputMode="decimal"
              defaultValue={billing.openAmount.toFixed(2).replace(".", ",")}
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Menor que o saldo → pagamento parcial.
            </p>
          </div>
          <div>
            <Label>Data</Label>
            <Input type="date" name="paidAt" defaultValue={formatDateInput(new Date())} required />
          </div>
          <div>
            <Label>Forma</Label>
            <Select name="method" defaultValue="PIX">
              {Object.entries(PAYMENT_METHOD_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Conta de destino</Label>
            <Select name="accountId" defaultValue="">
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Observação</Label>
            <Input name="notes" placeholder="opcional" />
          </div>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Registrando…" : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
