"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import {
  setGeneratedContractStatus,
  deleteGeneratedContract,
} from "@/lib/actions/contract-templates";
import { GENERATED_STATUS_LABEL } from "./_meta";
import { Download, Trash2 } from "lucide-react";

/** Ações de um contrato gerado: baixar DOCX, mudar status, excluir. */
export function GeneratedContractActions({
  contract,
}: {
  contract: { id: string; name: string; status: string };
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-1 justify-end">
      <Select
        className="h-8 w-auto text-xs"
        value={contract.status}
        onChange={(e) =>
          start(async () => {
            const res = await setGeneratedContractStatus(contract.id, e.target.value as any);
            if (!res.ok) setError(res.error);
          })
        }
        disabled={pending}
        aria-label="Status do contrato"
      >
        {Object.entries(GENERATED_STATUS_LABEL).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </Select>
      <Button size="icon" variant="ghost" asChild title="Baixar DOCX">
        <a href={`/api/arquivos/contrato/${contract.id}`}>
          <Download className="h-4 w-4" />
        </a>
      </Button>
      <Dialog open={confirming} onOpenChange={(o) => { setConfirming(o); if (!o) setError(null); }}>
        <DialogTrigger asChild>
          <Button size="icon" variant="ghost" title="Excluir contrato gerado" className="text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir contrato gerado?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            “{contract.name}” e o arquivo DOCX serão removidos. Essa ação não pode ser desfeita.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => start(async () => {
                const res = await deleteGeneratedContract(contract.id);
                if (res.ok) setConfirming(false); else setError(res.error);
              })}
            >
              {pending ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
