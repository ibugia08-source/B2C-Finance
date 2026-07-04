"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";

export function ExpenseFilters({ people }: { people: any[] }) {
  const router = useRouter();
  const sp = useSearchParams();

  function update(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    const qs = params.toString();
    router.push(qs ? `/despesas?${qs}` : "/despesas");
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
      <div>
        <Label className="text-xs">Mês</Label>
        <Input
          type="month"
          defaultValue={sp.get("mes") ?? ""}
          onChange={(e) => update("mes", e.target.value)}
        />
      </div>
      <div className="w-full sm:w-44">
        <Label className="text-xs">Status</Label>
        <Select defaultValue={sp.get("status") ?? ""} onChange={(e) => update("status", e.target.value)}>
          <option value="">Todos</option>
          <option value="pendente">A vencer</option>
          <option value="pago">Pago</option>
          <option value="cancelado">Cancelado</option>
        </Select>
      </div>
      <div className="w-full sm:w-48">
        <Label className="text-xs">Pessoa</Label>
        <Select defaultValue={sp.get("pessoa") ?? ""} onChange={(e) => update("pessoa", e.target.value)}>
          <option value="">Todas</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <Button variant="outline" type="button" onClick={() => router.push("/despesas")}>
        Mês atual
      </Button>
    </div>
  );
}
