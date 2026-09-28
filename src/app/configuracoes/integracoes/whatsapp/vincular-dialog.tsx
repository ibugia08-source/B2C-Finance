"use client";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { vincularWhatsAppAction } from "@/lib/actions/messaging-identities";

/** Vincular um número de WhatsApp a um usuário do workspace (só administrador). */
export function VincularDialog({ usuarios }: { usuarios: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErro(null); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Vincular WhatsApp
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular WhatsApp</DialogTitle>
          <DialogDescription>
            A partir daqui, mensagens deste número serão atendidas pelo agente com as permissões do usuário escolhido.
          </DialogDescription>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setErro(null);
              const r = await vincularWhatsAppAction(fd);
              if (r.ok) setOpen(false);
              else setErro(r.error);
            })
          }
          className="space-y-3"
        >
          <div>
            <Label htmlFor="wa-usuario">Usuário *</Label>
            <Select id="wa-usuario" name="userId" required defaultValue="">
              <option value="" disabled>Escolha o usuário</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="wa-telefone">Número do WhatsApp *</Label>
            <Input
              id="wa-telefone"
              name="telefone"
              required
              inputMode="tel"
              autoComplete="off"
              placeholder="(71) 99999-0000"
              aria-describedby="wa-telefone-ajuda"
            />
            <p id="wa-telefone-ajuda" className="mt-1 text-caption text-muted-foreground">
              Com DDD. Número de fora do Brasil: inclua o código do país (ex.: +1 415 555 0100).
            </p>
          </div>
          {erro && (
            <p role="alert" className="text-dense text-danger-ink">
              {erro}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? "Vinculando…" : "Vincular"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
