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
import { Textarea } from "@/components/ui/textarea";
import { saveClientContact, deleteClientContact } from "@/lib/actions/clients";
import { Plus, Pencil, Trash2 } from "lucide-react";

export function ContactDialog({
  clientId,
  initial,
  trigger,
}: {
  clientId: string;
  initial?: any;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-1" /> Novo contato
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar contato" : "Novo contato"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await saveClientContact(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <input type="hidden" name="clientId" value={clientId} />
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div>
            <Label>Nome *</Label>
            <Input name="name" defaultValue={initial?.name ?? ""} required />
          </div>
          <div>
            <Label>Cargo / função</Label>
            <Input name="role" defaultValue={initial?.role ?? ""} />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input type="email" name="email" defaultValue={initial?.email ?? ""} />
          </div>
          <div>
            <Label>WhatsApp / Telefone</Label>
            <Input name="phone" defaultValue={initial?.phone ?? ""} />
          </div>

          <div className="col-span-full flex items-center gap-2">
            <input
              type="checkbox"
              id={`isPrimary-${initial?.id ?? "new"}`}
              name="isPrimary"
              defaultChecked={initial?.isPrimary ?? false}
              className="h-4 w-4"
            />
            <Label htmlFor={`isPrimary-${initial?.id ?? "new"}`}>
              Contato principal
            </Label>
          </div>

          <div className="col-span-full">
            <Label>Observações</Label>
            <Textarea name="notes" defaultValue={initial?.notes ?? ""} />
          </div>

          {error && <p className="col-span-full text-sm text-destructive">{error}</p>}

          <DialogFooter className="col-span-full">
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

export function ContactActions({ contact }: { contact: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1">
      <ContactDialog
        clientId={contact.clientId}
        initial={contact}
        trigger={
          <Button variant="ghost" size="icon">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Excluir o contato "${contact.name}"?`)) return;
          start(async () => {
            const res = await deleteClientContact(contact.id);
            if (!res.ok) alert(res.error);
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
