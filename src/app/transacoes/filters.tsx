"use client";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";

export function Filters({
  cards,
  people,
  categories,
}: {
  cards: any[];
  people: any[];
  categories: any[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function update(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    router.push(`/transacoes?${params.toString()}`);
  }

  function clear() {
    router.push("/transacoes");
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 items-end">
      <div>
        <Label className="text-xs">Mês</Label>
        <Input type="month" defaultValue={sp.get("mes") ?? ""} onChange={(e) => update("mes", e.target.value)} />
      </div>
      <div>
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
      <div>
        <Label className="text-xs">Cartão</Label>
        <Select defaultValue={sp.get("cartao") ?? ""} onChange={(e) => update("cartao", e.target.value)}>
          <option value="">Todos</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label className="text-xs">Categoria</Label>
        <Select defaultValue={sp.get("categoria") ?? ""} onChange={(e) => update("categoria", e.target.value)}>
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
        <Select defaultValue={sp.get("status") ?? ""} onChange={(e) => update("status", e.target.value)}>
          <option value="">Todos</option>
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
          <option value="devendo">Devendo</option>
          <option value="reembolsado">Reembolsado</option>
          <option value="cancelado">Cancelado</option>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Tipo</Label>
        <Select defaultValue={sp.get("tipo") ?? ""} onChange={(e) => update("tipo", e.target.value)}>
          <option value="">Todos</option>
          <option value="despesa">Despesa</option>
          <option value="receita">Receita</option>
          <option value="transferencia">Transferência</option>
          <option value="ajuste">Ajuste</option>
        </Select>
      </div>
      <div>
        <Button variant="outline" type="button" onClick={clear}>
          Limpar
        </Button>
      </div>
    </div>
  );
}
