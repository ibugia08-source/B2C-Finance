"use client";
import { useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { setTransactionResponsible } from "@/lib/actions/transactions";

export function ResponsibleSelect({
  txId,
  value,
  people,
}: {
  txId: string;
  value: string | null;
  people: { id: string; name: string }[];
}) {
  // Otimista: o select muda na hora; a gravação + refresh acontecem em
  // background (sem travar a página inteira a cada atribuição).
  const [local, setLocal] = useState(value ?? "");
  const [, start] = useTransition();

  return (
    <Select
      value={local}
      onChange={(e) => {
        const next = e.target.value;
        setLocal(next);
        start(() => setTransactionResponsible(txId, next || null));
      }}
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
