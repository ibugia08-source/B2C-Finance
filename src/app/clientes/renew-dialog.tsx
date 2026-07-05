"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { renewClientContract } from "@/lib/actions/contracts";
import { RefreshCw } from "lucide-react";

/**
 * Renovação pela carteira: novo prazo, valor, forma e modalidade de
 * pagamento. TCV renovado paga o valor cheio de novo no mês (nova cobrança);
 * MRR segue com as cobranças mensais do novo período.
 */
export function RenewClientDialog({
  contract,
  clientName,
  trigger,
}: {
  contract: { id: string; type: string; totalValue: number; monthlyValue: number };
  clientName: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isTcv = contract.type === "TCV";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="text-amber-600 border-amber-500/50">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Renovar
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renovar contrato — {clientName}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await renewClientContract(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="grid grid-cols-2 gap-3"
        >
          <input type="hidden" name="contractId" value={contract.id} />
          <div>
            <Label>Prazo do novo contrato (meses) *</Label>
            <Input type="number" min={1} name="months" required defaultValue={12} />
          </div>
          <div>
            <Label>{isTcv ? "Valor cheio da renovação (R$) *" : "Valor total do novo ciclo (R$)"}</Label>
            <Input
              name="totalValue"
              inputMode="decimal"
              required={isTcv}
              defaultValue={contract.totalValue > 0 ? contract.totalValue.toFixed(2).replace(".", ",") : ""}
            />
          </div>
          <div>
            <Label>Forma de pagamento</Label>
            <Select name="paymentMethod" defaultValue="">
              <option value="">—</option>
              <option value="pix">Pix</option>
              <option value="boleto">Boleto</option>
              <option value="cartao">Cartão</option>
              <option value="transferencia">Transferência</option>
              <option value="outro">Outro</option>
            </Select>
          </div>
          <div>
            <Label>Modalidade</Label>
            <Select name="paymentMode" defaultValue="">
              <option value="">—</option>
              <option value="a_vista">À vista</option>
              <option value="parcelado">Parcelado</option>
              <option value="mensal">Mensal</option>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Detalhes</Label>
            <Textarea name="details" placeholder="condições, descontos, observações do novo ciclo…" />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            {isTcv
              ? "TCV: o valor cheio entra como nova cobrança no mês da renovação e conta no financeiro."
              : "MRR: o mensal passa a ser o valor do ciclo ÷ prazo e as cobranças do novo período são geradas."}
            {" "}O cliente volta ao status Ativo (renovado).
          </p>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Renovando…" : "Renovar contrato"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
