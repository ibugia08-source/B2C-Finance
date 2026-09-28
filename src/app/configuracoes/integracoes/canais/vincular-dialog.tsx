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
import { vincularCanalAction } from "@/lib/actions/messaging-identities";

/** Vincular um Telegram (User ID) ou WhatsApp (número) a um usuário do workspace (só administrador). */
export function VincularDialog({ usuarios }: { usuarios: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [canal, setCanal] = useState<"TELEGRAM" | "WHATSAPP">("TELEGRAM");
  const [pendente, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErro(null); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Vincular canal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular canal</DialogTitle>
          <DialogDescription>
            A partir daqui, mensagens deste Telegram ou WhatsApp serão atendidas pelo agente com as permissões do usuário escolhido.
          </DialogDescription>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setErro(null);
              const r = await vincularCanalAction(fd);
              if (r.ok) setOpen(false);
              else setErro(r.error);
            })
          }
          className="space-y-3"
        >
          <div>
            <Label htmlFor="canal-tipo">Canal *</Label>
            <Select
              id="canal-tipo"
              name="channel"
              value={canal}
              onChange={(e) => setCanal(e.target.value === "WHATSAPP" ? "WHATSAPP" : "TELEGRAM")}
            >
              <option value="TELEGRAM">Telegram</option>
              <option value="WHATSAPP">WhatsApp</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="canal-usuario">Usuário *</Label>
            <Select id="canal-usuario" name="userId" required defaultValue="">
              <option value="" disabled>Escolha o usuário</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </Select>
          </div>
          {canal === "TELEGRAM" ? (
            <>
              <div>
                <Label htmlFor="canal-tg-id">Telegram User ID *</Label>
                <Input
                  id="canal-tg-id"
                  name="externalIdentifier"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{1,16}"
                  autoComplete="off"
                  placeholder="123456789"
                  aria-describedby="canal-tg-ajuda"
                />
                <p id="canal-tg-ajuda" className="mt-1 text-caption text-muted-foreground">
                  Só números. A pessoa descobre o dela mandando /start para o bot. O @username não serve como identificação.
                </p>
              </div>
              <div>
                <Label htmlFor="canal-tg-user">Username (opcional)</Label>
                <Input id="canal-tg-user" name="username" autoComplete="off" placeholder="@usuario" aria-describedby="canal-tg-user-ajuda" />
                <p id="canal-tg-user-ajuda" className="mt-1 text-caption text-muted-foreground">
                  Só para você reconhecer na lista.
                </p>
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="canal-wa">Número do WhatsApp *</Label>
              <Input
                id="canal-wa"
                name="externalIdentifier"
                required
                inputMode="tel"
                autoComplete="off"
                placeholder="(71) 99999-0000"
                aria-describedby="canal-wa-ajuda"
              />
              <p id="canal-wa-ajuda" className="mt-1 text-caption text-muted-foreground">
                Com DDD. Número de fora do Brasil: inclua o código do país (ex.: +1 415 555 0100).
              </p>
            </div>
          )}
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
