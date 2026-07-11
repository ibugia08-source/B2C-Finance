"use client";
import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { SlidersHorizontal, X } from "lucide-react";

/**
 * "Mais filtros" do ciclo de Recebimentos — simples por padrão, avançado
 * sob demanda. Filtros ativos viram chips removíveis + "Limpar filtros".
 * Parâmetros: mod (MRR/TCV) · cliente · vmin/vmax (R$) · vde/vate (venc.).
 */

const FILTER_KEYS = ["mod", "cliente", "vmin", "vmax", "vde", "vate"] as const;

export function CycleFilters({
  clients,
}: {
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);

  const current = Object.fromEntries(
    FILTER_KEYS.map((k) => [k, sp.get(k) ?? ""])
  ) as Record<(typeof FILTER_KEYS)[number], string>;

  function pushWith(next: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const k of FILTER_KEYS) {
      const v = (next[k] ?? "").trim();
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearAll() {
    pushWith({});
  }

  function removeOne(key: string) {
    pushWith({ ...current, [key]: "" });
  }

  const clientName = (id: string) =>
    clients.find((c) => c.id === id)?.name ?? id;

  const activeChips: { key: string; label: string }[] = [];
  if (current.mod)
    activeChips.push({ key: "mod", label: `Modalidade: ${current.mod}` });
  if (current.cliente)
    activeChips.push({ key: "cliente", label: `Cliente: ${clientName(current.cliente)}` });
  if (current.vmin)
    activeChips.push({ key: "vmin", label: `Valor ≥ R$ ${current.vmin}` });
  if (current.vmax)
    activeChips.push({ key: "vmax", label: `Valor ≤ R$ ${current.vmax}` });
  if (current.vde)
    activeChips.push({ key: "vde", label: `Venc. a partir de ${brDate(current.vde)}` });
  if (current.vate)
    activeChips.push({ key: "vate", label: `Venc. até ${brDate(current.vate)}` });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> Mais filtros
            {activeChips.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5">
                {activeChips.length}
              </span>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mais filtros</DialogTitle>
          </DialogHeader>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              pushWith({
                mod: String(fd.get("mod") ?? ""),
                cliente: String(fd.get("cliente") ?? ""),
                vmin: String(fd.get("vmin") ?? ""),
                vmax: String(fd.get("vmax") ?? ""),
                vde: String(fd.get("vde") ?? ""),
                vate: String(fd.get("vate") ?? ""),
              });
              setOpen(false);
            }}
          >
            <div>
              <Label>Modalidade</Label>
              <Select name="mod" defaultValue={current.mod}>
                <option value="">Todas</option>
                <option value="MRR">MRR (recorrente)</option>
                <option value="TCV">TCV (contrato fechado)</option>
              </Select>
            </div>
            <div>
              <Label>Cliente</Label>
              <Select name="cliente" defaultValue={current.cliente}>
                <option value="">Todos</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Valor mínimo (R$)</Label>
              <Input name="vmin" inputMode="decimal" placeholder="0,00"
                defaultValue={current.vmin} />
            </div>
            <div>
              <Label>Valor máximo (R$)</Label>
              <Input name="vmax" inputMode="decimal" placeholder="0,00"
                defaultValue={current.vmax} />
            </div>
            <div>
              <Label>Vencimento a partir de</Label>
              <Input type="date" name="vde" defaultValue={current.vde} />
            </div>
            <div>
              <Label>Vencimento até</Label>
              <Input type="date" name="vate" defaultValue={current.vate} />
            </div>
            <DialogFooter className="col-span-full">
              <Button
                type="button"
                variant="outline"
                onClick={() => { clearAll(); setOpen(false); }}
              >
                Limpar filtros
              </Button>
              <Button type="submit">Aplicar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {activeChips.map((c) => (
        <Badge key={c.key} variant="secondary" className="gap-1 pr-1">
          {c.label}
          <button
            type="button"
            aria-label={`Remover filtro ${c.label}`}
            className="rounded-full hover:bg-muted-foreground/20 p-0.5"
            onClick={() => removeOne(c.key)}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      {activeChips.length > 0 && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearAll}>
          Limpar filtros
        </Button>
      )}
    </div>
  );
}

function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
