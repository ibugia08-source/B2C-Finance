"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { showUndoToast } from "@/components/undo-toast";
import { definirBaseDeValoracaoAction } from "@/lib/actions/metricas-comerciais";

const ROTULOS = {
  PRIMEIRO_MES: "Primeiro mês da mensalidade",
  CONTRATO: "Valor total do contrato (mensalidade × prazo)",
} as const;

/**
 * A BASE DE VALORAÇÃO DO MRR — parâmetro OBRIGATÓRIO do ROAS (01 §7.5).
 *
 * Fica na tela, e não escondido em configurações, porque é a escolha que
 * decide se o ROAS de uma mensalidade de R$ 2.000 vale 2.000 ou 24.000. Quem
 * lê o número precisa ver qual base está valendo.
 */
export function BaseDeValoracaoSelector({
  atual,
  podeEditar,
}: {
  atual: "PRIMEIRO_MES" | "CONTRATO" | null;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="min-w-0">
          <p className="text-body font-medium">Como o MRR é valorizado no ROAS</p>
          <p className="mt-0.5 text-dense text-muted-foreground">
            {atual
              ? ROTULOS[atual]
              : "Ainda não escolhido — por isso o ROAS aparece sem valor. Uma mensalidade de R$ 2.000 vale 2.000 ou 24.000 conforme a escolha, e as duas se chamariam ROAS."}
          </p>
        </div>
        {podeEditar ? (
          <Select
            aria-label="Base de valoração do MRR"
            className="w-full sm:w-auto"
            value={atual ?? ""}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value as "PRIMEIRO_MES" | "CONTRATO";
              if (!v) return;
              start(async () => {
                await definirBaseDeValoracaoAction(v);
                showUndoToast({ message: "Base de valoração definida." });
                router.refresh();
              });
            }}
          >
            <option value="">Escolha…</option>
            <option value="PRIMEIRO_MES">{ROTULOS.PRIMEIRO_MES}</option>
            <option value="CONTRATO">{ROTULOS.CONTRATO}</option>
          </Select>
        ) : null}
      </CardContent>
    </Card>
  );
}
