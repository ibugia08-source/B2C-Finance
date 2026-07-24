"use client";
import { useMemo, useState, useTransition } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Plus } from "lucide-react";
import { includeClientInMonth } from "@/lib/actions/billings";
import { formatDateInput } from "@/lib/format";
import { PAYMENT_METHOD_LABEL } from "./_meta";

/**
 * "Incluir cliente no mês" de verdade: escolhe um cliente da BASE (ativo ou
 * inativo) e o sistema puxa tudo do cadastro — valor (mensalidade MRR ou
 * total TCV), vencimento (dia de pagamento aplicado ao mês aberto) e
 * descrição. Tudo editável, nada digitado do zero. A seção "Já foi pago?"
 * registra o pagamento (data retroativa) no mesmo passo — é o fluxo de
 * preenchimento de histórico de meses passados.
 */
export type IncludeClientOption = {
  id: string;
  name: string;
  modality: string | null; // MRR | TCV | null
  monthlyValue: number | null;
  totalContractValue: number | null;
  paymentDay: number | null;
  active: boolean;
};

function dueDateFor(year: number, month: number, paymentDay: number | null): Date {
  const lastDay = new Date(year, month, 0).getDate();
  const desired = paymentDay == null ? 5 : Math.trunc(paymentDay);
  const day = Math.min(Math.max(desired, 1), lastDay);
  return new Date(year, month - 1, day);
}

function toMoney(v: number | null): string {
  return v != null && v > 0 ? v.toFixed(2).replace(".", ",") : "";
}

export function IncludeClientDialog({
  clients,
  contracts,
  accounts,
  month,
  year,
}: {
  clients: IncludeClientOption[];
  contracts: { id: string; title: string; clientId: string }[];
  accounts: { id: string; name: string }[];
  month: number;
  year: number;
}) {
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [paid, setPaid] = useState(false);
  const [paidAt, setPaidAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const compLabel = `${String(month).padStart(2, "0")}/${year}`;
  const client = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);
  const clientContracts = useMemo(
    () => contracts.filter((c) => c.clientId === clientId),
    [contracts, clientId]
  );
  const isTCV = client?.modality === "TCV";

  function selectClient(id: string) {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    const due = dueDateFor(year, month, c.paymentDay);
    const tcv = c.modality === "TCV";
    setAmount(toMoney(tcv ? c.totalContractValue : c.monthlyValue));
    setDueDate(formatDateInput(due));
    setDescription(tcv ? `Contrato — ${compLabel}` : `Mensalidade — ${compLabel}`);
    setPaidAt(formatDateInput(due));
  }

  function reset(next: boolean) {
    setOpen(next);
    if (next) {
      setClientId("");
      setAmount("");
      setDueDate("");
      setDescription("");
      setPaid(false);
      setPaidAt("");
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button title="Adiciona um cliente da sua base à lista deste mês — valor, vencimento e descrição vêm do cadastro">
          <Plus className="h-4 w-4 mr-1" /> Incluir cliente no mês
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Incluir cliente em {compLabel}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await includeClientInMonth(fd);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              if (res.warning) alert(res.warning);
              setOpen(false);
            })
          }
          className="grid grid-cols-2 gap-3"
        >
          <input type="hidden" name="competence" value={`${year}-${String(month).padStart(2, "0")}`} />
          <input type="hidden" name="paid" value={String(paid)} />

          <div className="col-span-2">
            <Label>Cliente</Label>
            <Select
              name="clientId"
              value={clientId}
              onChange={(e) => selectClient(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (inativo)"}
                </option>
              ))}
            </Select>
            {client && (
              <p className="mt-1 text-xs text-muted-foreground">
                {isTCV
                  ? "TCV — valor total do contrato, reconhecido neste mês."
                  : "MRR — mensalidade recorrente do cadastro."}
              </p>
            )}
          </div>

          <div>
            <Label>Valor (R$)</Label>
            <Input
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={client ? "informe o valor" : "selecione o cliente"}
              required
            />
          </div>
          <div>
            <Label>Vencimento</Label>
            <Input
              type="date"
              name="dueDate"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          </div>

          <div className="col-span-2">
            <Label>Descrição</Label>
            <Input
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          {clientContracts.length > 0 && (
            <div className="col-span-2">
              <Label>Contrato (opcional)</Label>
              <Select name="contractId" defaultValue="">
                <option value="">—</option>
                {clientContracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="col-span-2 rounded-lg border bg-muted/30 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox checked={paid} onChange={() => setPaid(!paid)} />
              Já foi pago? (registrar o pagamento junto)
            </label>
            {paid && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <Label>Data do pagamento</Label>
                  <Input
                    type="date"
                    name="paidAt"
                    value={paidAt}
                    onChange={(e) => setPaidAt(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label>Valor pago (R$)</Label>
                  <Input
                    name="paidAmount"
                    inputMode="decimal"
                    placeholder={amount || "igual ao valor"}
                  />
                </div>
                <div>
                  <Label>Forma</Label>
                  <Select name="method" defaultValue="PIX">
                    {Object.entries(PAYMENT_METHOD_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Conta de destino</Label>
                  <Select name="accountId" defaultValue="">
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
          </div>

          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !clientId}>
              {pending ? "Incluindo…" : paid ? "Incluir e registrar pagamento" : "Incluir no mês"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
