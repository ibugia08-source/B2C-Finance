"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouter, useSearchParams } from "next/navigation";
import { BILLING_STATUS_LABEL } from "./_meta";

type Opt = { value: string; label: string };

export function BillingFilters({
  clients,
  contracts,
  services,
  collectors,
}: {
  clients: Opt[];
  contracts: Opt[];
  services: Opt[];
  collectors: string[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function update(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    router.push(`/cobrancas?${params.toString()}`);
  }

  const chips: { key: string; label: string; params: Record<string, string> }[] = [
    { key: "hoje", label: "Hoje", params: { periodo: "dia" } },
    { key: "semana", label: "Semana", params: { periodo: "semana" } },
    { key: "mes", label: "Mês", params: { periodo: "mes" } },
    { key: "vencidas", label: "Vencidas", params: { status: "OVERDUE" } },
    { key: "avencer", label: "A vencer", params: { avencer: "1" } },
    { key: "parciais", label: "Parciais", params: { status: "PARTIAL" } },
    { key: "pagas", label: "Pagas", params: { status: "PAID" } },
  ];
  function isActive(p: Record<string, string>) {
    return Object.entries(p).every(([k, v]) => sp.get(k) === v);
  }
  function toggle(p: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    const active = isActive(p);
    for (const [k, v] of Object.entries(p)) {
      if (active) params.delete(k);
      else params.set(k, v);
    }
    router.push(`/cobrancas?${params.toString()}`);
  }

  const hasAny = Array.from(sp.keys()).length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button key={c.key} type="button" onClick={() => toggle(c.params)}>
            <Badge variant={isActive(c.params) ? "default" : "outline"}>{c.label}</Badge>
          </button>
        ))}
        {hasAny && (
          <Button variant="ghost" size="sm" onClick={() => router.push("/cobrancas")}>
            Limpar
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 items-end">
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={sp.get("status") ?? ""} onChange={(e) => update("status", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(BILLING_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Cliente</Label>
          <Select value={sp.get("cliente") ?? ""} onChange={(e) => update("cliente", e.target.value)}>
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Contrato</Label>
          <Select value={sp.get("contrato") ?? ""} onChange={(e) => update("contrato", e.target.value)}>
            <option value="">Todos</option>
            {contracts.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Serviço</Label>
          <Select value={sp.get("servico") ?? ""} onChange={(e) => update("servico", e.target.value)}>
            <option value="">Todos</option>
            {services.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Responsável</Label>
          <Select value={sp.get("responsavel") ?? ""} onChange={(e) => update("responsavel", e.target.value)}>
            <option value="">Todos</option>
            {collectors.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Valor mínimo (R$)</Label>
          <Input inputMode="decimal" defaultValue={sp.get("valorMin") ?? ""}
            onBlur={(e) => update("valorMin", e.target.value)} placeholder="0,00" />
        </div>
        <div>
          <Label className="text-xs">Vencimento de</Label>
          <Input type="date" defaultValue={sp.get("vencDe") ?? ""}
            onChange={(e) => update("vencDe", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Vencimento até</Label>
          <Input type="date" defaultValue={sp.get("vencAte") ?? ""}
            onChange={(e) => update("vencAte", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
