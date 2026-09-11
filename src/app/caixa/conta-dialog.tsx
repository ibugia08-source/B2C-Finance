"use client";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
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
import { salvarConta, TIPOS_DE_CONTA } from "@/lib/actions/contas";
import { formatDecimalInput } from "@/lib/format";

/**
 * Cadastro de conta. Todo campo tem LABEL persistente e id próprio (DS-10):
 * a auditoria achou selects e datas sem nome na árvore de acessibilidade e
 * campos identificados só pelo placeholder, que some quando se digita.
 */
export function ContaDialog({
  initial,
  trigger,
}: {
  initial?: {
    id: string;
    name: string;
    bank: string | null;
    type: string;
    balance: string;
    active: boolean;
  };
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();
  const id = initial?.id ?? "nova";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setErro(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-1 h-4 w-4" aria-hidden /> Nova conta
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Editar conta" : "Nova conta"}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setErro(null);
              const res = await salvarConta(fd);
              if (res.ok) setOpen(false);
              else setErro(res.error);
            })
          }
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}

          <div className="sm:col-span-2">
            <Label htmlFor={`conta-nome-${id}`}>Nome da conta *</Label>
            <Input
              id={`conta-nome-${id}`}
              name="name"
              defaultValue={initial?.name ?? ""}
              required
              aria-describedby={`conta-nome-ajuda-${id}`}
            />
            <p id={`conta-nome-ajuda-${id}`} className="mt-1 text-caption text-muted-foreground">
              Como você chama esta conta no dia a dia — é este nome que aparece
              na composição da liquidez.
            </p>
          </div>

          <div>
            <Label htmlFor={`conta-banco-${id}`}>Banco</Label>
            <Input id={`conta-banco-${id}`} name="bank" defaultValue={initial?.bank ?? ""} />
          </div>

          <div>
            <Label htmlFor={`conta-tipo-${id}`}>Tipo</Label>
            <Select id={`conta-tipo-${id}`} name="type" defaultValue={initial?.type ?? "corrente"}>
              {TIPOS_DE_CONTA.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor={`conta-saldo-${id}`}>Saldo atual (R$)</Label>
            <Input
              id={`conta-saldo-${id}`}
              name="balance"
              inputMode="decimal"
              defaultValue={initial ? formatDecimalInput(initial.balance) : ""}
              placeholder="0,00"
              aria-describedby={`conta-saldo-ajuda-${id}`}
            />
            <p id={`conta-saldo-ajuda-${id}`} className="mt-1 text-caption text-muted-foreground">
              O saldo de hoje, como está no extrato. É daqui que a projeção de
              caixa parte.
            </p>
          </div>

          <div>
            <Label htmlFor={`conta-status-${id}`}>Situação</Label>
            <Select
              id={`conta-status-${id}`}
              name="active"
              defaultValue={String(initial?.active ?? true)}
            >
              <option value="true">Ativa — entra no caixa</option>
              <option value="false">Encerrada — fica fora do caixa</option>
            </Select>
          </div>

          {erro && (
            <p role="alert" className="sm:col-span-2 text-dense text-danger-ink">
              {erro}
            </p>
          )}

          <DialogFooter className="sm:col-span-2">
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
