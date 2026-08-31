"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Filtros do DRE (02 §4.5).
 *
 * A BASE é o filtro que mais muda o número e o que mais confunde quando não
 * está visível: competência responde "quanto o mês GEROU", caixa responde
 * "quanto ENTROU e SAIU no mês". São perguntas diferentes, e o v1 produzia
 * dois "resultado do mês" que nunca batiam justamente por não dizer qual
 * estava respondendo.
 */
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function FiltrosDre({
  competence,
  base,
  agencyId,
  agencias,
  comProLabore,
}: {
  competence: string;
  base: string;
  agencyId: string | null;
  agencias: { id: string; name: string }[];
  comProLabore: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function trocar(chave: string, valor: string | null) {
    const p = new URLSearchParams(params?.toString() ?? "");
    if (valor === null || valor === "") p.delete(chave);
    else p.set(chave, valor);
    router.push(`/dre?${p.toString()}`);
  }

  const hoje = new Date();
  const opcoes: { valor: string; rotulo: string }[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    opcoes.push({
      valor: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      rotulo: `${MESES[d.getMonth()]} de ${d.getFullYear()}`,
    });
  }

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-48">
          <Label htmlFor="dre-mes">Mês</Label>
          <Select id="dre-mes" value={competence} onChange={(e) => trocar("mes", e.target.value)}>
            {opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>{o.rotulo}</option>
            ))}
          </Select>
        </div>

        <div className="min-w-52">
          <Label htmlFor="dre-base">Base</Label>
          <Select id="dre-base" value={base} onChange={(e) => trocar("base", e.target.value)}>
            <option value="competencia">Competência — o que o mês gerou</option>
            <option value="caixa">Caixa — o que entrou e saiu no mês</option>
          </Select>
        </div>

        {agencias.length > 1 ? (
          <div className="min-w-44">
            <Label htmlFor="dre-agencia">Agência</Label>
            <Select
              id="dre-agencia"
              value={agencyId ?? ""}
              onChange={(e) => trocar("agencia", e.target.value || null)}
            >
              <option value="">Consolidado</option>
              {agencias.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </div>
        ) : null}

        <label className="flex cursor-pointer items-center gap-2 pb-2 text-dense">
          <Checkbox
            checked={!comProLabore}
            onChange={() => trocar("prolabore", comProLabore ? "fora" : null)}
          />
          Ver sem o pró-labore
        </label>
      </CardContent>
    </Card>
  );
}
