import { PageHeader } from "@/components/page-header";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { sugerirProvisoes } from "@/lib/services/tax-provision";
import { monthLabel } from "@/lib/format";
import { PainelDeImpostos } from "./painel";
import { competenciaDaUrl } from "@/lib/competence";

/**
 * IMPOSTOS: PROVISÃO E RESERVA (F3.3 · ref. 01 §3.8).
 *
 * Provisionar reconhece a OBRIGAÇÃO no resultado. A sugestão de reserva de
 * caixa saiu em 10/09/2026 junto com as reservas (CashBox): o dinheiro do
 * imposto agora aparece como compromisso quando a guia é lançada em contas a
 * pagar, que é um fato, e não uma intenção guardada numa caixinha.
 */
export const dynamic = "force-dynamic";

export default async function ImpostosPage({
  searchParams,
}: {
  searchParams?: { mes?: string };
}) {
  const viewer = await requirePagePermission("contabil.visualizar");

  const { competence, ano, mes } = competenciaDaUrl(searchParams?.mes);

  const sugestoes = await sugerirProvisoes(competence);

  return (
    <div>
      <PageHeader
        title="Impostos"
        description={`${monthLabel(new Date(ano, mes - 1, 1))} — provisão tributária do resultado`}
      />

      <PainelDeImpostos
        competence={competence}
        sugestoes={sugestoes}
        podeLancar={can(viewer, "contabil.lancar")}
      />

    </div>
  );
}
