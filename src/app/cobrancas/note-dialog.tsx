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
import { Textarea } from "@/components/ui/textarea";
import { addCollectionNote, rescheduleBilling } from "@/lib/actions/billings";
import { COLLECTION_STATUS_LABEL } from "./_meta";

/** Observação / promessa de pagamento (alimenta o histórico de cobrança). */
export function NoteDialog({
  billingId,
  promise,
  trigger,
}: {
  billingId: string;
  promise?: boolean; // pré-seleciona "Prometeu pagar"
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
          <DialogTitle>
            {promise ? "Registrar promessa de pagamento" : "Observação de cobrança"}
          </DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await addCollectionNote(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-2 gap-3"
        >
          <input type="hidden" name="billingId" value={billingId} />
          <div>
            <Label>Status do contato</Label>
            <Select name="status" defaultValue={promise ? "PROMISED" : "CONTACTED"}>
              {Object.entries(COLLECTION_STATUS_LABEL)
                .filter(([v]) => v !== "PAID")
                .map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
            </Select>
          </div>
          <div>
            <Label>Canal</Label>
            <Select name="channel" defaultValue="whatsapp">
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="telefone">Telefone</option>
              <option value="outro">Outro</option>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>{promise ? "Detalhes da promessa *" : "Observação *"}</Label>
            <Textarea
              name="message"
              required
              placeholder={
                promise
                  ? "Cliente prometeu pagar dia 15 via Pix…"
                  : "Resumo do contato…"
              }
            />
          </div>
          <div className="col-span-2">
            <Label>{promise ? "Data prometida / follow-up" : "Próximo follow-up"}</Label>
            <Input type="date" name="nextActionAt" />
          </div>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reagendar vencimento. */
export function RescheduleDialog({
  billingId,
  trigger,
}: {
  billingId: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reagendar cobrança</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await rescheduleBilling(billingId, fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="space-y-3"
        >
          <div>
            <Label>Novo vencimento *</Label>
            <Input type="date" name="dueDate" required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Reagendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
