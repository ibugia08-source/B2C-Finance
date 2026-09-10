"use client";
import { useEffect, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { lembrarFiltroDoFluxo } from "@/lib/actions/fluxo";

/**
 * BARRA DE HORIZONTE E RECORTE (02 §4.4).
 *
 * Chips de 7/15/30 dias + intervalo livre, conta e agência. Tudo vive na
 * QUERYSTRING: a tela é server-side, então o filtro é um link — volta, avança
 * e recarrega funcionam sem estado escondido, e a visão salva é só a
 * querystring guardada.
 *
 * O intervalo livre ACEITA PASSADO: conferir a semana que passou contra o
 * extrato é metade do uso real desta tela, e proibir a data de ontem obrigaria
 * a pessoa a fazer essa conta fora do sistema.
 *
 * A escolha é LEMBRADA por pessoa (SavedView) a cada troca — sem botão de
 * "salvar preferência", porque preferência que precisa ser salva à mão é
 * preferência que ninguém salva.
 */
export function FiltrosDoFluxo({
  horizonte,
  de,
  ate,
  contaId,
  agenciaId,
  contas,
  agencias,
}: {
  horizonte: "7" | "15" | "30" | "custom";
  de: string;
  ate: string;
  contaId: string;
  agenciaId: string;
  contas: { id: string; nome: string }[];
  agencias: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  // Guarda o filtro que está no ar. Roda depois da navegação, então o que é
  // lembrado é sempre o que a pessoa está de fato vendo.
  const querystring = sp.toString();
  useEffect(() => {
    const t = setTimeout(() => void lembrarFiltroDoFluxo(querystring), 800);
    return () => clearTimeout(t);
  }, [querystring]);

  function navegar(mudancas: Record<string, string | null>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  const chips: { valor: "7" | "15" | "30"; rotulo: string }[] = [
    { valor: "7", rotulo: "Próximos 7 dias" },
    { valor: "15", rotulo: "15 dias" },
    { valor: "30", rotulo: "30 dias" },
  ];

  return (
    <div className="mb-4 space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5" role="group"
        aria-label="Horizonte da projeção">
        {chips.map((c) => (
          <Button
            key={c.valor}
            size="sm"
            variant={horizonte === c.valor ? "default" : "outline"}
            aria-pressed={horizonte === c.valor}
            disabled={pending}
            onClick={() => navegar({ h: c.valor, de: null, ate: null })}
          >
            {c.rotulo}
          </Button>
        ))}
        <Button
          size="sm"
          variant={horizonte === "custom" ? "default" : "outline"}
          aria-pressed={horizonte === "custom"}
          disabled={pending}
          onClick={() => navegar({ h: "custom", de, ate })}
        >
          Personalizado
        </Button>
      </div>

      {horizonte === "custom" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="fluxo-de" className="mb-1 block text-caption">De</Label>
            <Input
              id="fluxo-de" type="date" defaultValue={de} className="h-9 w-[9.5rem]"
              onChange={(e) => navegar({ h: "custom", de: e.target.value, ate })}
            />
          </div>
          <div>
            <Label htmlFor="fluxo-ate" className="mb-1 block text-caption">Até</Label>
            <Input
              id="fluxo-ate" type="date" defaultValue={ate} className="h-9 w-[9.5rem]"
              onChange={(e) => navegar({ h: "custom", de, ate: e.target.value })}
            />
          </div>
          <p className="pb-2 text-caption text-muted-foreground">
            Aceita datas passadas — conferir a semana que passou é metade do uso.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="fluxo-conta" className="mb-1 block text-caption">Conta</Label>
          <Select
            id="fluxo-conta" className="h-9 w-52" defaultValue={contaId}
            onChange={(e) => navegar({ conta: e.target.value || null })}
          >
            <option value="">Todas as contas ativas</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Select>
        </div>
        {agencias.length > 1 ? (
          <div>
            <Label htmlFor="fluxo-agencia" className="mb-1 block text-caption">Agência</Label>
            <Select
              id="fluxo-agencia" className="h-9 w-52" defaultValue={agenciaId}
              onChange={(e) => navegar({ agencia: e.target.value || null })}
            >
              <option value="">Todas as agências</option>
              {agencias.map((a) => (
                <option key={a.id} value={a.id}>{a.nome}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
    </div>
  );
}
