"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { AVISOS_PROATIVOS, CHAVES_DE_AVISO } from "@/lib/messaging/notifications";
import { preferenciasCanalAction } from "@/lib/actions/messaging-identities";

export type Envios = { manha: boolean; noite: boolean; avisos: string[] };

/**
 * O que este vínculo RECEBE sem pedir: relatórios diários e avisos. Tudo
 * desligado por padrão — ninguém recebe só por estar vinculado.
 */
export function EnviosDialog({ id, canal, usuario, envios }: { id: string; canal: string; usuario: string; envios: Envios }) {
  const [open, setOpen] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErro(null); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">Envios</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Envios para {usuario} ({canal})</DialogTitle>
          <DialogDescription>
            O que chega sem a pessoa pedir. Cada relatório respeita as permissões dela: o que ela não pode ver no B2C Finance não aparece,
            e quem não pode ver relatórios não recebe, mesmo marcado.
          </DialogDescription>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setErro(null);
              const r = await preferenciasCanalAction(id, fd);
              if (r.ok) setOpen(false);
              else setErro(r.error);
            })
          }
          className="space-y-4"
        >
          <fieldset className="space-y-2">
            <legend className="mb-1 text-dense font-medium">Relatórios diários</legend>
            <label className="flex items-center gap-2 text-dense">
              <Checkbox name="receiveMorningReport" defaultChecked={envios.manha} /> Relatório da manhã
            </label>
            <label className="flex items-center gap-2 text-dense">
              <Checkbox name="receiveEveningReport" defaultChecked={envios.noite} /> Relatório da noite
            </label>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-dense font-medium">Avisos</legend>
            {CHAVES_DE_AVISO.map((k) => (
              <label key={k} className="flex items-center gap-2 text-dense">
                <Checkbox name="notificationEvents" value={k} defaultChecked={envios.avisos.includes(k)} />
                {AVISOS_PROATIVOS[k].label}
              </label>
            ))}
            <p className="text-caption text-muted-foreground">
              Preparado: a preferência fica guardada, mas o envio automático de avisos ainda não está ligado.
            </p>
          </fieldset>
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
              {pendente ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
