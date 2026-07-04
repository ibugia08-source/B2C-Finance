"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function CardDetailFilters({
  people,
  categories,
}: {
  people: any[];
  categories: any[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const path = usePathname();

  function update(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    router.push(`${path}?${params.toString()}`);
  }

  function clear() {
    router.push(path);
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
      <div>
        <Label className="text-xs">Mês</Label>
        <Input
          type="month"
          defaultValue={sp.get("mes") ?? ""}
          onChange={(e) => update("mes", e.target.value)}
        />
      </div>
      <div>
        <Label className="text-xs">Pessoa</Label>
        <Select
          defaultValue={sp.get("pessoa") ?? ""}
          onChange={(e) => update("pessoa", e.target.value)}
        >
          <option value="">Todas</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label className="text-xs">Categoria</Label>
        <Select
          defaultValue={sp.get("categoria") ?? ""}
          onChange={(e) => update("categoria", e.target.value)}
        >
          <option value="">Todas</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label className="text-xs">Status</Label>
        <Select
          defaultValue={sp.get("status") ?? ""}
          onChange={(e) => update("status", e.target.value)}
        >
          <option value="">Todos</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
          <option value="devendo">Devendo</option>
          <option value="reembolsado">Reembolsado</option>
          <option value="cancelado">Cancelado</option>
        </Select>
      </div>
      <Button variant="outline" type="button" onClick={clear}>
        Limpar
      </Button>
    </div>
  );
}
