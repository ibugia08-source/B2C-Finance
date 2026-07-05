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
import { ContractDialog } from "./contract-dialog";
import { Pencil, Trash2, RefreshCw, Square, Receipt } from "lucide-react";
import {
  deleteContract,
  endContract,
  cancelContract,
  renewContract,
  generateContractBillings,
} from "@/lib/actions/contracts";

export function ContractActions({
  contract,
  clients,
  plans,
  services,
}: {
  contract: any;
  clients: { id: string; name: string }[];
  plans: any[];
  services: any[];
}) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const live = ["ACTIVE", "RENEWAL", "OVERDUE", "PENDING"].includes(contract.status);

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex gap-1 justify-end">
        {live && (
          <Button
            variant="ghost"
            size="icon"
            title="Gerar cobranças deste contrato"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await generateContractBillings(contract.id);
                setFeedback(
                  res.ok
                    ? `${res.created ?? 0} cobrança(s) gerada(s)`
                    : res.error
                );
              })
            }
          >
            <Receipt className="h-4 w-4" />
          </Button>
        )}
        {live && <RenewDialog contractId={contract.id} onDone={setFeedback} />}
        <ContractDialog
          clients={clients}
          plans={plans}
          services={services}
          initial={contract}
          trigger={
            <Button variant="ghost" size="icon" title="Editar">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
        {live && (
          <Button
            variant="ghost"
            size="icon"
            title="Encerrar contrato"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Encerrar o contrato "${contract.title}"?`)) return;
              start(async () => {
                const res = await endContract(contract.id);
                if (!res.ok) setFeedback(res.error);
              });
            }}
          >
            <Square className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          title="Excluir"
          disabled={pending}
          onClick={() => {
            if (
              !confirm(
                `Excluir o contrato "${contract.title}"? (contratos com cobranças devem ser cancelados)`
              )
            )
              return;
            start(async () => {
              const res = await deleteContract(contract.id);
              if (!res.ok) setFeedback(res.error);
            });
          }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {feedback && (
        <p className="text-xs text-muted-foreground max-w-[220px] text-right">
          {feedback}
        </p>
      )}
    </div>
  );
}

function RenewDialog({
  contractId,
  onDone,
}: {
  contractId: string;
  onDone: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Renovar contrato">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renovar contrato</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              const res = await renewContract(contractId, fd);
              setOpen(false);
              onDone(res.ok ? "Contrato renovado ✅" : res.error);
            })
          }
          className="space-y-3"
        >
          <div>
            <Label>Renovar por quantos meses?</Label>
            <Input type="number" name="months" min={1} defaultValue={12} required />
            <p className="text-xs text-muted-foreground mt-1">
              Estende a vigência, atualiza a próxima renovação e soma o novo
              período ao TCV.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Renovando…" : "Renovar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
