"use client";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

export function SeletorDeCloser({ nomes, atual }: { nomes: string[]; atual: string }) {
  const router = useRouter();
  return (
    <Select
      aria-label="Painel de qual closer"
      value={atual}
      onChange={(e) => router.push(`/funil/closer?closer=${encodeURIComponent(e.target.value)}`)}
    >
      {nomes.map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </Select>
  );
}
