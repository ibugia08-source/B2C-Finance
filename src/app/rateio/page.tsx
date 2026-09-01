import { PageHeader } from "@/components/page-header";
import { MonthNav } from "@/components/month-nav";
import { MetricCard } from "@/components/metric-card";
import { EmptyState } from "@/components/empty-state";
import { Megaphone } from "lucide-react";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { formatBRL, monthLabel } from "@/lib/format";
import { despesasParaRatear, resumoDoRateio } from "@/lib/services/allocation";
import { escopoAtual, whereDoCliente } from "@/lib/services/data-scope";
import { PainelDeRateio } from "./painel";

/**
 * RATEIO DE MÍDIA (F3.4 · ref. 01 §4.7; 02 §4.4).
 *
 * A tela responde uma pergunta só: de quem é este gasto de tráfego?
 *
 * "Não alocado" é INFORMAÇÃO, não pendência a esconder (01 §4.7). Mídia que
 * a agência gastou em campanha própria, teste ou prospecção não tem cliente —
 * e forçar um dono para zerar o contador é como a margem de um cliente
 * qualquer passa a carregar custo que não é dele.
 *
 * O que esta tela NÃO faz, e é bom que não faça: mexer no resultado do mês.
 * A despesa já está reconhecida e postada; rateio distribui, não lança.
 */
export const dynamic = "force-dynamic";

export default async function RateioPage({
  searchParams,
}: {
  searchParams?: { mes?: string };
}) {
  const viewer = await requirePagePermission("rateios.visualizar");

  const hoje = new Date();
  const competence =
    searchParams?.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.mes)
      ? searchParams.mes
      : `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const [ano, mes] = competence.split("-").map(Number);

  const scope = await escopoAtual();
  const [despesas, resumo, clientes, agencias, servicos, regras] = await Promise.all([
    despesasParaRatear(competence),
    resumoDoRateio(competence),
    prisma.client.findMany({
      where: { ...(await whereDoCliente(scope)), status: { not: "LEAD" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.agency.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.service.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.allocationRule.count({ where: { active: true } }),
  ]);

  const podeEditar = can(viewer, "rateios.editar");

  return (
    <div>
      <PageHeader
        title="Rateio de mídia"
        description={`${monthLabel(new Date(ano, mes - 1, 1))} — de quem é cada gasto de tráfego`}
        actions={<MonthNav month={mes} year={ano} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          title="Mídia do mês"
          value={formatBRL(resumo.totalMidia)}
          basis="competencia"
          hint={`${resumo.despesas} ${resumo.despesas === 1 ? "lançamento" : "lançamentos"}`}
        />
        <MetricCard
          title="Com dono"
          value={formatBRL(resumo.alocado)}
          basis="competencia"
          tone="positive"
        />
        <MetricCard
          title="Sem dono"
          value={formatBRL(resumo.naoAlocado)}
          basis="competencia"
          tone={resumo.naoAlocado > 0 ? "warning" : "default"}
          hint={
            resumo.semNenhumRateio > 0
              ? `${resumo.semNenhumRateio} ${resumo.semNenhumRateio === 1 ? "lançamento sem nenhuma linha" : "lançamentos sem nenhuma linha"}`
              : "Sobra distribuída à parte"
          }
          help="Mídia sem cliente não é erro: campanha própria, teste e prospecção ficam aqui de propósito. O que não pode é a sobra sumir da tela."
        />
        <MetricCard
          title="Rateio concluído"
          value={resumo.percentualConcluido === null ? null : `${resumo.percentualConcluido}%`}
          nullReason="Sem mídia lançada neste mês"
          tone={
            resumo.percentualConcluido === null
              ? "default"
              : resumo.percentualConcluido >= 90
                ? "positive"
                : "warning"
          }
          hint="Medido em valor, não em quantidade"
        />
      </div>

      {despesas.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Nenhuma despesa de mídia neste mês"
          description="Entram aqui os lançamentos marcados como Anúncios (tráfego). É o único rateio que o fechamento cobra."
        />
      ) : (
        <PainelDeRateio
          competence={competence}
          despesas={despesas}
          clientes={clientes}
          agencias={agencias}
          servicos={servicos}
          regrasAtivas={regras}
          podeEditar={podeEditar}
        />
      )}
    </div>
  );
}
