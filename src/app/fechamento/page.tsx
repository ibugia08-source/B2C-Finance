import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { motivosDeReconferencia, periodoDe } from "@/lib/services/closing-period";
import { Reconferir } from "./reconferir";
import { resumoDoFechamento } from "@/lib/services/closing-checklist";
import { monthLabel } from "@/lib/format";
import { PeriodBadge } from "@/components/period-badge";
import { ChecklistFechamento } from "./checklist";
import { RotinaMensal } from "./rotina";

/**
 * FECHAMENTO DO MÊS (F2.2 · ref. 01 §5.3; 02 §4.6).
 *
 * A tela responde a UMA pergunta: dá para fechar este mês, e o que falta?
 *
 * Os dezesseis itens de §5.3 aparecem com dono e link. O que ainda não pode
 * ser medido aparece dizendo isso — dezesseis verdes num sistema que mede
 * nove seria a pior coisa que esta tela poderia fazer.
 */
export const dynamic = "force-dynamic";

export default async function FechamentoPage({
  searchParams,
}: {
  searchParams?: { mes?: string };
}) {
  const viewer = await requirePagePermission("fechamento.fechar");

  const hoje = new Date();
  // O mês que se fecha por padrão é o ANTERIOR (02 §4.6: dia 1 abre a
  // competência nova e inicia o fechamento da que acabou). Abrir na
  // competência corrente faria a tela sugerir fechar um mês em andamento.
  const padrao = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const competence =
    searchParams?.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.mes)
      ? searchParams.mes
      : `${padrao.getFullYear()}-${String(padrao.getMonth() + 1).padStart(2, "0")}`;
  const [ano, mes] = competence.split("-").map(Number);

  const [periodo, resumo, motivos] = await Promise.all([
    periodoDe(competence),
    resumoDoFechamento(competence),
    motivosDeReconferencia(competence),
  ]);

  const podeFechar = can(viewer, "fechamento.fechar");
  const podeReabrir = can(viewer, "fechamento.reabrir");

  const anterior = new Date(ano, mes - 2, 1);
  const seguinte = new Date(ano, mes, 1);
  const url = (d: Date) =>
    `/fechamento?mes=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div>
      <PageHeader
        title="Fechamento do mês"
        description={`${monthLabel(new Date(ano, mes - 1, 1))} — o que falta para fechar, de quem é e onde se resolve`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodBadge periodo={periodo} podeFechar={podeFechar} podeReabrir={podeReabrir} />
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2 text-dense">
        <Link href={url(anterior)} className="text-brand hover:underline">
          ← {monthLabel(anterior)}
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link href={url(seguinte)} className="text-brand hover:underline">
          {monthLabel(seguinte)} →
        </Link>
      </div>

      {motivos.length > 0 ? (
        <Reconferir competence={competence} motivos={motivos} />
      ) : null}

      <RotinaMensal competence={competence} estado={periodo.estado} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Conferidos" value={String(resumo.ok)} intent="positive" />
        <StatCard
          title="Pendentes"
          value={String(resumo.pendentes)}
          intent={resumo.pendentes > 0 ? "warning" : "default"}
        />
        <StatCard title="Casos a resolver" value={String(resumo.casos)} />
        <StatCard title="Ainda não medidos" value={String(resumo.naoMedidos)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <ChecklistFechamento itens={resumo.itens} />
        </CardContent>
      </Card>
    </div>
  );
}
