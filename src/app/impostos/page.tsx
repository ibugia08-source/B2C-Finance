import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { sugerirProvisoes } from "@/lib/services/tax-provision";
import { formatBRL, monthLabel } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { PainelDeImpostos } from "./painel";
import { competenciaDaUrl } from "@/lib/competence";

/**
 * IMPOSTOS: PROVISÃO E RESERVA (F3.3 · ref. 01 §3.8).
 *
 * Duas colunas de propósito, porque são DOIS EVENTOS e não um: provisionar
 * reconhece a obrigação no resultado; reservar segrega o caixa. Juntá-las
 * numa ação só é o que faz o imposto ser contado duas vezes — uma como
 * despesa tributária e outra como saída de caixa. O erro é invisível no
 * extrato e só aparece quando o lucro do ano não bate com o do contador.
 *
 * E o sistema NUNCA transfere: ele sugere e anota que alguém transferiu.
 */
export const dynamic = "force-dynamic";

export default async function ImpostosPage({
  searchParams,
}: {
  searchParams?: { mes?: string };
}) {
  const viewer = await requirePagePermission("contabil.visualizar");

  const { competence, ano, mes } = competenciaDaUrl(searchParams?.mes);

  const [sugestoes, reservas] = await Promise.all([
    sugerirProvisoes(competence),
    prisma.cashBox.findMany({
      where: { restricted: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, currentAmount: true },
    }),
  ]);

  const reservado = reservas.reduce((s, r) => s + Number(r.currentAmount), 0);
  const aProvisionar = sugestoes.reduce((s, x) => s + x.valor, 0);

  return (
    <div>
      <PageHeader
        title="Impostos"
        description={`${monthLabel(new Date(ano, mes - 1, 1))} — provisão do resultado e reserva de caixa, separadas`}
      />

      <PainelDeImpostos
        competence={competence}
        sugestoes={sugestoes}
        podeLancar={can(viewer, "contabil.lancar")}
      />

      <h2 className="mb-2 mt-6 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Reservas restritas
      </h2>
      <Card>
        <CardContent className="p-0">
          {reservas.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-dense text-muted-foreground">
              Nenhuma reserva marcada como restrita. Reservas restritas ficam
              fora da liquidez disponível — é o que impede aprovar uma despesa
              contra o imposto do mês seguinte.
            </p>
          ) : (
            <ul className="divide-y divide-border-soft">
              {reservas.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-3.5 py-2.5">
                  <span>{r.name}</span>
                  <span className="tabular-nums">{formatBRL(Number(r.currentAmount))}</span>
                </li>
              ))}
              <li className="flex items-center justify-between bg-surface-sunken px-3.5 py-2.5 font-medium">
                <span>Reservado (fora do disponível)</span>
                <span className="tabular-nums">{formatBRL(reservado)}</span>
              </li>
            </ul>
          )}
        </CardContent>
      </Card>

      {aProvisionar > reservado ? (
        <p className="mt-3 text-dense text-warning">
          A provisão do mês ({formatBRL(aProvisionar)}) está acima do que há
          guardado nas reservas restritas ({formatBRL(reservado)}).
        </p>
      ) : null}
    </div>
  );
}
