"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouter, useSearchParams } from "next/navigation";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL } from "./_meta";

type Option = { value: string; label: string };

export function ClientFilters({
  services,
  owners,
  cities,
  segments,
}: {
  services: Option[];
  owners: string[];
  cities: string[];
  segments: string[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function push(params: URLSearchParams) {
    params.delete("pagina"); // qualquer filtro novo volta à página 1
    router.push(`/clientes?${params.toString()}`);
  }

  function update(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    push(params);
  }

  function onSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    update("q", String(new FormData(e.currentTarget).get("q") ?? "").trim());
  }

  // Atalhos rápidos (chips) — visões mais usadas da carteira.
  const chips: { key: string; label: string; params: Record<string, string> }[] = [
    { key: "ativos", label: "Ativos", params: { status: "ACTIVE" } },
    { key: "inadimplentes", label: "Inadimplentes", params: { situacao: "inadimplente" } },
    { key: "renovacao", label: "Renovação ≤ 30d", params: { renovacao: "30" } },
    { key: "pausados", label: "Pausados", params: { status: "PAUSED" } },
    { key: "cancelados", label: "Cancelados", params: { status: "CHURNED" } },
  ];
  function isChipActive(p: Record<string, string>) {
    return Object.entries(p).every(([k, v]) => sp.get(k) === v);
  }
  function toggleChip(p: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    const active = isChipActive(p);
    for (const [k, v] of Object.entries(p)) {
      if (active) params.delete(k);
      else params.set(k, v);
    }
    push(params);
  }

  const hasAny = Array.from(sp.keys()).some((k) => k !== "pagina");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button key={c.key} type="button" onClick={() => toggleChip(c.params)}>
            <Badge variant={isChipActive(c.params) ? "default" : "outline"}>
              {c.label}
            </Badge>
          </button>
        ))}
        {hasAny && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => router.push("/clientes")}
          >
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 items-end">
        <form onSubmit={onSearch} className="col-span-2">
          <Label className="text-xs">Buscar</Label>
          <Input
            name="q"
            defaultValue={sp.get("q") ?? ""}
            placeholder="Nome, doc, e-mail, responsável…"
          />
        </form>

        <div>
          <Label className="text-xs">Status</Label>
          <Select
            value={sp.get("status") ?? ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">Todos</option>
            {CLIENT_STATUSES.filter((s) => s !== "LEAD").map((s) => (
              <option key={s} value={s}>
                {CLIENT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Serviço</Label>
          <Select
            value={sp.get("servico") ?? ""}
            onChange={(e) => update("servico", e.target.value)}
          >
            <option value="">Todos</option>
            {services.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Responsável</Label>
          <Select
            value={sp.get("responsavel") ?? ""}
            onChange={(e) => update("responsavel", e.target.value)}
          >
            <option value="">Todos</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Cidade</Label>
          <Select
            value={sp.get("cidade") ?? ""}
            onChange={(e) => update("cidade", e.target.value)}
          >
            <option value="">Todas</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Segmento</Label>
          <Select
            value={sp.get("segmento") ?? ""}
            onChange={(e) => update("segmento", e.target.value)}
          >
            <option value="">Todos</option>
            {segments.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Entrada de</Label>
          <Input
            type="date"
            defaultValue={sp.get("entradaDe") ?? ""}
            onChange={(e) => update("entradaDe", e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Entrada até</Label>
          <Input
            type="date"
            defaultValue={sp.get("entradaAte") ?? ""}
            onChange={(e) => update("entradaAte", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
