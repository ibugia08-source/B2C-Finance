"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";
import { EXPENSE_TYPE_LABEL } from "./expense-dialog";

export function ExpenseFilters() {
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
    <div className="flex flex-col sm:flex-row sm:items-end gap-3 flex-wrap">
      <div>
        <Label className="text-xs">Mês</Label>
        <Input
          type="month"
          defaultValue={sp.get("mes") ?? ""}
          onChange={(e) => update("mes", e.target.value)}
        />
      </div>
      <div className="w-full sm:w-40">
        <Label className="text-xs">Status</Label>
        <Select
          value={sp.get("status") ?? ""}
          onChange={(e) => update("status", e.target.value)}
        >
          <option value="">Todos</option>
          <option value="pendente">Pendente</option>
          <option value="vencida">Vencida</option>
          <option value="pago">Paga</option>
          <option value="cancelado">Cancelada</option>
        </Select>
      </div>
      <div className="w-full sm:w-44">
        <Label className="text-xs">Tipo</Label>
        <Select
          value={sp.get("tipo") ?? ""}
          onChange={(e) => update("tipo", e.target.value)}
        >
          <option value="">Todos</option>
          {Object.entries(EXPENSE_TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-full sm:w-40">
        <Label className="text-xs">Recorrência</Label>
        <Select
          value={sp.get("recorrente") ?? ""}
          onChange={(e) => update("recorrente", e.target.value)}
        >
          <option value="">Todas</option>
          <option value="sim">Recorrentes</option>
          <option value="nao">Não recorrentes</option>
        </Select>
      </div>
      <Button variant="outline" type="button" onClick={() => router.push("/despesas")}>
        Limpar
      </Button>
    </div>
  );
}
