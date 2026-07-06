"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouter, useSearchParams } from "next/navigation";
import { CONTRACT_STATUS_LABEL, CONTRACT_TYPE_LABEL } from "./_meta";

type Opt = { value: string; label: string };

export function ContractFilters({
  clients,
  services,
}: {
  clients: Opt[];
  services: Opt[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function update(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    router.push(`/acordos?${params.toString()}`);
  }

  const chips: { key: string; label: string; params: Record<string, string> }[] = [
    { key: "ativos", label: "Ativos", params: { status: "ACTIVE" } },
    { key: "renovacao", label: "Renovação ≤ 30d", params: { renovacao: "30" } },
    { key: "vencidos", label: "Vencidos", params: { vencidos: "1" } },
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
    router.push(`/acordos?${params.toString()}`);
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
          <Button variant="ghost" size="sm" onClick={() => router.push("/acordos")}>
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 items-end">
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={sp.get("status") ?? ""} onChange={(e) => update("status", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(CONTRACT_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select value={sp.get("tipo") ?? ""} onChange={(e) => update("tipo", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(CONTRACT_TYPE_LABEL).map(([v, l]) => (
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
          <Label className="text-xs">Serviço</Label>
          <Select value={sp.get("servico") ?? ""} onChange={(e) => update("servico", e.target.value)}>
            <option value="">Todos</option>
            {services.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="text-xs">Renovação em (dias)</Label>
          <Input
            type="number"
            min={1}
            defaultValue={sp.get("renovacao") ?? ""}
            onChange={(e) => update("renovacao", e.target.value)}
            placeholder="30"
          />
        </div>
        <div>
          <Label className="text-xs">Início de</Label>
          <Input type="date" defaultValue={sp.get("inicioDe") ?? ""}
            onChange={(e) => update("inicioDe", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Início até</Label>
          <Input type="date" defaultValue={sp.get("inicioAte") ?? ""}
            onChange={(e) => update("inicioAte", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Fim de</Label>
          <Input type="date" defaultValue={sp.get("fimDe") ?? ""}
            onChange={(e) => update("fimDe", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Fim até</Label>
          <Input type="date" defaultValue={sp.get("fimAte") ?? ""}
            onChange={(e) => update("fimAte", e.target.value)} />
        </div>
      </div>
    </div>
  );
}
