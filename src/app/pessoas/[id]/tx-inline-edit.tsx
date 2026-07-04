"use client";
import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { setPersonTxStatus, setPersonTxCategory } from "@/lib/actions/people";
import { setTransactionResponsible } from "@/lib/actions/transactions";

export function StatusSelect({
  txId,
  value,
}: {
  txId: string;
  value: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Select
      defaultValue={value}
      disabled={pending}
      onChange={(e) => start(() => setPersonTxStatus(txId, e.target.value))}
      className="h-8 text-sm"
    >
      <option value="pendente">Pendente</option>
      <option value="pago">Pago</option>
      <option value="devendo">Devendo</option>
      <option value="reembolsado">Reembolsado</option>
      <option value="cancelado">Cancelado</option>
    </Select>
  );
}

export function CategorySelect({
  txId,
  value,
  categories,
}: {
  txId: string;
  value: string | null;
  categories: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  return (
    <Select
      defaultValue={value ?? ""}
      disabled={pending}
      onChange={(e) =>
        start(() => setPersonTxCategory(txId, e.target.value || null))
      }
      className="h-8 text-sm"
    >
      <option value="">—</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

export function ResponsibleInline({
  txId,
  value,
  people,
}: {
  txId: string;
  value: string | null;
  people: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  return (
    <Select
      defaultValue={value ?? ""}
      disabled={pending}
      onChange={(e) =>
        start(() => setTransactionResponsible(txId, e.target.value || null))
      }
      className="h-8 text-sm"
    >
      <option value="">—</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}
