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
import { renewClientFlow } from "@/lib/actions/renewals";
import { showUndoToast } from "@/components/undo-toast";
import { RefreshCw } from "lucide-react";

/**
 * "SIM, RENOVOU" — o pop-up completo da renovação: novo prazo e valores do
 * contrato, forma de pagamento, lançamento nos recebimentos (mês atual ou
 * outro), situação do pagamento (aberto/total/parcial) e — para MRR — se o
 * cliente permanece na lista de recebimentos mensais. Funciona também para
 * cliente sem contrato cadastrado (renova pelo cadastro).
 */
export function RenewFlowDialog({
  client,
  modality,
  contract,
  defaultCompetence,
  canRegisterPayment,
  trigger,
}: {
  client: { id: string; name: string };
  modality: string | null; // MRR | TCV | null
  contract: {
    id: string;
    type: string;
    totalValue: number;
    monthlyValue: number;
  } | null;
  defaultCompetence: string; // "YYYY-MM"
  canRegisterPayment: boolean;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [launch, setLaunch] = useState(true);
  const [payStatus, setPayStatus] = useState("aberto");
  const [keepMonthly, setKeepMonthly] = useState(true);

  const isMrr = contract ? contract.type === "MRR" : modality !== "TCV";
  const defaultValue = contract
    ? contract.type === "TCV"
      ? contract.totalValue
      : 0
    : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setError(null);
          setLaunch(true);
          setPayStatus("aberto");
          setKeepMonthly(true);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="text-success border-success/40">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Sim, renovou
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Renovação — {client.name}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await renewClientFlow(fd);
              if (res.ok) {
                setOpen(false);
                showUndoToast({
                  message: res.warning
                    ? `${client.name}: renovação registrada. ${res.warning}`
                    : `${client.name}: renovação registrada.`,
                });
              } else setError(res.error);
            })
          }
          className="grid grid-cols-2 gap-3"
        >
          <input type="hidden" name="clientId" value={client.id} />
          {contract && <input type="hidden" name="contractId" value={contract.id} />}

          <div>
            <Label>Prazo do novo contrato (meses) *</Label>
            <Input type="number" min={1} name="months" required defaultValue={12} />
          </div>
          <div>
            <Label>
              {isMrr ? "Valor total do novo ciclo (R$) *" : "Valor cheio da renovação (R$) *"}
            </Label>
            <Input
              name="totalValue"
              inputMode="decimal"
              required
              defaultValue={
                defaultValue > 0 ? defaultValue.toFixed(2).replace(".", ",") : ""
              }
              placeholder={isMrr ? "mensal × prazo" : "valor pago no fechamento"}
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
            <Label>Modalidade de pagamento</Label>
            <Select name="paymentMode" defaultValue="">
              <option value="">—</option>
              <option value="a_vista">À vista</option>
              <option value="parcelado">Parcelado</option>
              <option value="mensal">Mensal</option>
            </Select>
          </div>

          {isMrr && (
            <div className="col-span-2 rounded-lg border bg-muted/30 p-3">
              <Label>Manter o cliente na lista de recebimentos mensais?</Label>
              <Select
                name="keepMonthly"
                value={keepMonthly ? "1" : "0"}
                onChange={(e) => setKeepMonthly(e.target.value === "1")}
              >
                <option value="1">Sim — segue pagando mensalidade (MRR)</option>
                <option value="0">Não — pagou o ciclo cheio (vira TCV)</option>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {keepMonthly
                  ? "O mensal passa a ser o valor do ciclo ÷ prazo e as mensalidades seguem sendo geradas."
                  : "O cliente deixa de gerar mensalidade automática — o valor cheio entra no mês escolhido, como TCV."}
              </p>
            </div>
          )}

          <div className="col-span-2 rounded-lg border bg-muted/30 p-3 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Lançar no módulo de recebimentos?</Label>
              <Select
                name="launch"
                value={launch ? "1" : "0"}
                onChange={(e) => setLaunch(e.target.value === "1")}
              >
                <option value="1">Sim — lançar a cobrança</option>
                <option value="0">Não — só registrar a renovação</option>
              </Select>
            </div>
            {launch && (
              <>
                <div>
                  <Label>Em qual mês?</Label>
                  <Input type="month" name="competence" defaultValue={defaultCompetence} />
                </div>
                {canRegisterPayment && (
                  <div>
                    <Label>Situação do pagamento</Label>
                    <Select
                      name="payStatus"
                      value={payStatus}
                      onChange={(e) => setPayStatus(e.target.value)}
                    >
                      <option value="aberto">Em aberto</option>
                      <option value="total">Pgto total (já pagou)</option>
                      <option value="parcial">Pgto parcial</option>
                    </Select>
                  </div>
                )}
                {canRegisterPayment && payStatus === "parcial" && (
                  <div className="col-span-2">
                    <Label>Valor já pago (R$) *</Label>
                    <Input name="paidAmount" inputMode="decimal" required placeholder="0,00" />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="col-span-2">
            <Label>Detalhes</Label>
            <Textarea
              name="details"
              placeholder="condições, descontos, observações do novo ciclo…"
            />
          </div>

          <p className="col-span-2 text-xs text-muted-foreground">
            A renovação atualiza contrato e cadastro (prazo, valores e próxima
            renovação) e fica registrada no histórico do cliente.
            {!contract && " Cliente sem contrato: a renovação é registrada pelo cadastro."}
          </p>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Renovando…" : "Confirmar renovação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
