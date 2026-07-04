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
import { payInvoice } from "@/lib/actions/invoices";
import { formatBRL } from "@/lib/format";

export function PayInvoiceDialog({ invoice }: { invoice: any }) {
  const [open, setOpen] = useState(false);
  const remaining = Math.max(0, invoice.total - invoice.paid);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={invoice.status === "paga"}>
          Registrar pagamento
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pagar fatura</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            await payInvoice(fd);
            setOpen(false);
          }}
          className="space-y-3"
        >
          <input type="hidden" name="id" value={invoice.id} />
          <p className="text-sm text-muted-foreground">
            Total: {formatBRL(invoice.total)} · Pago: {formatBRL(invoice.paid)} · Restante: {formatBRL(remaining)}
          </p>
          <div>
            <Label>Valor a pagar</Label>
            <Input name="amount" defaultValue={remaining.toFixed(2).replace(".", ",")} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit">Confirmar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
