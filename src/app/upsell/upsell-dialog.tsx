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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { saveUpsell } from "@/lib/actions/upsells";
import { Plus, TrendingUp, X } from "lucide-react";
import { formatDateInput, formatDecimalInput as fmt, parseBRL, formatBRL } from "@/lib/format";
import { UPSELL_STATUSES, UPSELL_STATUS_LABEL } from "./_meta";

type Opt = { id: string; name: string };
type ServiceLine = { serviceId: string; unitPrice: number };

/**
 * Form único de oportunidade de upsell — usado no módulo /upsell, na Gestão
 * do Mês e na ficha do cliente (com `fixedClient`). Associa VÁRIOS serviços,
 * cada um com seu valor; o valor da oportunidade sugere a soma automática.
 */
export function UpsellDialog({
  clients,
  services,
  offers,
  initial,
  fixedClient,
  trigger,
}: {
  clients: Opt[];
  services: Opt[];
  offers: Opt[];
  initial?: any;
  /** Cliente pré-fixado (Gestão do Mês / ficha do cliente). */
  fixedClient?: Opt;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const linesFromInitial = () =>
    (initial?.services as ServiceLine[] | undefined)?.map((s) => ({
      serviceId: s.serviceId,
      unitPrice: Number(s.unitPrice),
    })) ?? [];
  const [lines, setLines] = useState<ServiceLine[]>(linesFromInitial);
  const [valueStr, setValueStr] = useState<string>(fmt(initial?.value) ?? "");
  const [valueTouched, setValueTouched] = useState<boolean>(!!initial?.id);

  // O componente fica montado (renderiza o próprio trigger): a cada ABERTURA
  // o estado ressincroniza com `initial` — Cancelar não vaza dados para a
  // próxima edição/criação.
  function resetState() {
    setError(null);
    setLines(linesFromInitial());
    setValueStr(fmt(initial?.value) ?? "");
    setValueTouched(!!initial?.id);
  }

  const serviceName = useMemo(
    () => new Map(services.map((s) => [s.id, s.name])),
    [services]
  );
  const sum = lines.reduce((s, l) => s + l.unitPrice, 0);
  const available = services.filter((s) => !lines.some((l) => l.serviceId === s.id));

  function addLine(serviceId: string) {
    if (!serviceId) return;
    setLines((cur) => [...cur, { serviceId, unitPrice: 0 }]);
  }
  function setLinePrice(serviceId: string, raw: string) {
    const price = parseBRL(raw);
    setLines((cur) =>
      cur.map((l) => (l.serviceId === serviceId ? { ...l, unitPrice: price } : l))
    );
    if (!valueTouched) setValueStr(""); // segue a soma
  }
  function removeLine(serviceId: string) {
    setLines((cur) => cur.filter((l) => l.serviceId !== serviceId));
  }

  const effectiveValue = valueTouched && valueStr.trim() ? valueStr : "";

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
          <Button>
            <Plus className="h-4 w-4 mr-1" /> Nova oportunidade
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {initial?.id
              ? "Editar oportunidade"
              : fixedClient
                ? (
                    <span className="inline-flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> Upsell — {fixedClient.name}
                    </span>
                  )
                : "Nova oportunidade de upsell"}
          </DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              setError(null);
              const res = await saveUpsell(fd);
              if (res.ok) setOpen(false);
              else setError(res.error);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          <input type="hidden" name="services" value={JSON.stringify(lines)} />

          {fixedClient ? (
            <input type="hidden" name="clientId" value={fixedClient.id} />
          ) : (
            <div className="col-span-full">
              <Label>Cliente *</Label>
              <Select name="clientId" defaultValue={initial?.clientId ?? ""} required>
                <option value="">Selecione…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* ===== Serviços da oportunidade (vários, cada um com valor) ===== */}
          <div className="col-span-full rounded-lg border bg-muted/30 p-3">
            <Label>Serviços do upsell</Label>
            {lines.length > 0 && (
              <div className="mt-2 space-y-2">
                {lines.map((l) => (
                  <div key={l.serviceId} className="flex items-center gap-2">
                    <Badge variant="outline" className="shrink-0 max-w-[45%] truncate">
                      {serviceName.get(l.serviceId) ?? "serviço"}
                    </Badge>
                    <Input
                      inputMode="decimal"
                      placeholder="0,00"
                      className="h-9"
                      defaultValue={l.unitPrice > 0 ? fmt(l.unitPrice) : ""}
                      onChange={(e) => setLinePrice(l.serviceId, e.target.value)}
                      aria-label={`Valor de ${serviceName.get(l.serviceId) ?? "serviço"}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => removeLine(l.serviceId)}
                      aria-label="Remover serviço"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {available.length > 0 && (
              <Select
                className="mt-2"
                value=""
                onChange={(e) => addLine(e.target.value)}
                aria-label="Adicionar serviço"
              >
                <option value="">+ adicionar serviço…</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
            {sum > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Soma dos serviços: <span className="font-medium">{formatBRL(sum)}</span>
                {!effectiveValue && " — usada como valor da oportunidade."}
              </p>
            )}
          </div>

          <div className="col-span-full">
            <Label>Descrição da oportunidade</Label>
            <Input
              name="title"
              defaultValue={initial?.title ?? ""}
              placeholder="ex.: adicionar Google Ads ao plano atual"
            />
          </div>

          <div>
            <Label>Valor da oportunidade (R$)</Label>
            <Input
              name="value"
              inputMode="decimal"
              placeholder={sum > 0 ? fmt(sum) : "0,00"}
              value={effectiveValue}
              onChange={(e) => {
                setValueTouched(true);
                setValueStr(e.target.value);
              }}
            />
          </div>
          <div>
            <Label>Responsável</Label>
            <Input
              name="responsible"
              defaultValue={initial?.responsible ?? ""}
              placeholder="vazio = responsável do cliente"
            />
          </div>

          <div>
            <Label>Oferta sugerida</Label>
            <Select name="offerId" defaultValue={initial?.offerId ?? ""}>
              <option value="">—</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Previsão de fechamento</Label>
            <Input
              type="date"
              name="expectedCloseAt"
              defaultValue={
                initial?.expectedCloseAt ? formatDateInput(initial.expectedCloseAt) : ""
              }
            />
          </div>

          {initial?.id && (
            <div>
              <Label>Status</Label>
              <Select name="status" defaultValue={initial?.status ?? "OPPORTUNITY"}>
                {UPSELL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {UPSELL_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="col-span-full">
            <Label>Observações</Label>
            <Textarea name="notes" defaultValue={initial?.notes ?? ""} />
          </div>

          {error && <p className="col-span-full text-sm text-destructive">{error}</p>}

          <DialogFooter className="col-span-full">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
