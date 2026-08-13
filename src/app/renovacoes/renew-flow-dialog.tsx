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
import { parseBRL, formatBRL } from "@/lib/format";
import { RefreshCw } from "lucide-react";

/**
 * "SIM, RENOVOU" — o pop-up completo da renovação. A MODALIDADE do contrato
 * renovado (MRR/TCV) segue a mesma lógica do cadastro de cliente:
 *  - MRR → informa a MENSALIDADE + confirma o dia de pagamento mensal;
 *    o cliente segue entrando todo mês na lista de recebimentos.
 *  - TCV → informa o VALOR TOTAL do contrato renovado; o valor cheio entra
 *    no mês escolhido, sem mensalidade automática.
 * Também decide o lançamento nos recebimentos (mês atual ou outro) e a
 * situação do pagamento (aberto/total/parcial). Funciona para cliente sem
 * contrato cadastrado (renova pelo cadastro).
 */
export function RenewFlowDialog({
  client,
  modality,
  contract,
  expectedValue = 0,
  defaults,
  defaultCompetence,
  canRegisterPayment,
  trigger,
}: {
  client: { id: string; name: string };
  modality: string | null; // modalidade ATUAL (MRR | TCV | null)
  contract: {
    id: string;
    type: string;
    totalValue: number;
    monthlyValue: number;
  } | null;
  /** Sugestão TCV: valor da última adesão (regra central) — nunca o
   * totalValue acumulado do contrato. */
  expectedValue?: number;
  /** Defaults MRR vindos do cadastro (mensalidade e dia de pagamento). */
  defaults?: { monthlyValue: number | null; paymentDay: number | null };
  defaultCompetence: string; // "YYYY-MM"
  canRegisterPayment: boolean;
  trigger?: React.ReactNode;
}) {
  const currentIsMrr = contract ? contract.type === "MRR" : modality !== "TCV";

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [mod, setMod] = useState<"MRR" | "TCV">(currentIsMrr ? "MRR" : "TCV");
  const [months, setMonths] = useState(12);
  const [monthlyStr, setMonthlyStr] = useState("");
  const [launch, setLaunch] = useState(true);
  const [payStatus, setPayStatus] = useState("aberto");

  const defaultMonthly =
    defaults?.monthlyValue && defaults.monthlyValue > 0
      ? defaults.monthlyValue
      : contract && contract.monthlyValue > 0
        ? contract.monthlyValue
        : null;

  function resetState() {
    setError(null);
    setMod(currentIsMrr ? "MRR" : "TCV");
    setMonths(12);
    // Mensalidade pré-preenchida com o valor atual do cadastro (editável).
    setMonthlyStr(
      defaultMonthly != null ? defaultMonthly.toFixed(2).replace(".", ",") : ""
    );
    setLaunch(true);
    setPayStatus("aberto");
  }

  const monthlyNum = monthlyStr.trim()
    ? parseBRL(monthlyStr)
    : defaultMonthly ?? 0;
  const cycleTotal = monthlyNum > 0 ? monthlyNum * Math.max(1, months) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) resetState();
        else setError(null);
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

          {/* ===== Modalidade do contrato renovado (mesma lógica do cadastro) ===== */}
          <div className="col-span-2">
            <Label>Modalidade do contrato renovado *</Label>
            <Select
              name="modality"
              value={mod}
              onChange={(e) => setMod(e.target.value === "TCV" ? "TCV" : "MRR")}
            >
              <option value="MRR">MRR — mensalidade recorrente</option>
              <option value="TCV">TCV — valor fechado (pago no ato)</option>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {mod === "MRR"
                ? "O cliente entra todos os meses na lista de recebimentos enquanto estiver ativo."
                : "O valor total entra integralmente no mês escolhido e não é dividido nos meses seguintes."}
              {(currentIsMrr ? "MRR" : "TCV") !== mod &&
                " O cadastro do cliente muda de modalidade junto."}
            </p>
          </div>

          <div>
            <Label>Prazo do novo contrato (meses) *</Label>
            <Input
              type="number"
              min={1}
              name="months"
              required
              value={months}
              onChange={(e) => setMonths(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </div>

          {mod === "MRR" ? (
            <>
              <div>
                <Label>Valor da mensalidade (R$) *</Label>
                <Input
                  name="monthlyValue"
                  inputMode="decimal"
                  required
                  value={monthlyStr}
                  onChange={(e) => setMonthlyStr(e.target.value)}
                  placeholder={
                    defaultMonthly
                      ? defaultMonthly.toFixed(2).replace(".", ",")
                      : "0,00"
                  }
                />
                {cycleTotal > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Ciclo: {formatBRL(cycleTotal)} ({months}× {formatBRL(monthlyNum)})
                  </p>
                )}
              </div>
              <div>
                <Label>Dia de pagamento mensal (1-31) *</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  name="paymentDay"
                  required
                  defaultValue={defaults?.paymentDay ?? ""}
                  placeholder="ex.: 5"
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
            </>
          ) : (
            <>
              <div>
                <Label>Valor total do contrato renovado (R$) *</Label>
                <Input
                  name="totalValue"
                  inputMode="decimal"
                  required
                  defaultValue={
                    expectedValue > 0
                      ? expectedValue.toFixed(2).replace(".", ",")
                      : ""
                  }
                  placeholder="valor pago no fechamento"
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
            </>
          )}

          {/* ===== Lançamento nos recebimentos ===== */}
          <div className="col-span-2 rounded-lg border bg-muted/30 p-3 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Lançar no módulo de recebimentos?</Label>
              <Select
                name="launch"
                value={launch ? "1" : "0"}
                onChange={(e) => setLaunch(e.target.value === "1")}
              >
                <option value="1">
                  {mod === "MRR"
                    ? "Sim — lançar a mensalidade"
                    : "Sim — lançar o valor total"}
                </option>
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
            A renovação atualiza contrato e cadastro (modalidade, valores,
            prazo e próxima renovação) e fica registrada no histórico do
            cliente.
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
