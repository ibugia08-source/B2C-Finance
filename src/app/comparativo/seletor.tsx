"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Escolha dos dois meses (F2.5).
 *
 * A lista cobre os 24 meses anteriores: comparar com o mesmo mês do ano
 * passado é a comparação que mais se faz num negócio sazonal, e ela precisa
 * caber sem digitar data.
 */
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function SeletorDeMeses({ a, b }: { a: string; b: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const hoje = new Date();
  const opcoes: { valor: string; rotulo: string }[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    opcoes.push({ valor, rotulo: `${MESES[d.getMonth()]} de ${d.getFullYear()}` });
  }

  function trocar(qual: "a" | "b", valor: string) {
    const p = new URLSearchParams(params?.toString() ?? "");
    p.set(qual, valor);
    router.push(`/comparativo?${p.toString()}`);
  }

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-52">
          <Label htmlFor="mes-a">Comparar</Label>
          <Select id="mes-a" value={a} onChange={(e) => trocar("a", e.target.value)}>
            {opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Select>
        </div>
        <span className="pb-2 text-muted-foreground">com</span>
        <div className="min-w-52">
          <Label htmlFor="mes-b">&nbsp;</Label>
          <Select id="mes-b" value={b} onChange={(e) => trocar("b", e.target.value)}>
            {opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
