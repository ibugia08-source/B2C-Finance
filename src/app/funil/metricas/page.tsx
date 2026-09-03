import { PageHeader } from "@/components/page-header";
import { MonthNav } from "@/components/month-nav";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { formatBRL, monthLabel } from "@/lib/format";
import { metricasComerciais } from "@/lib/metrics/commercial";
import { getMetricSpec } from "@/lib/metrics/registry";
import { BaseDeValoracaoSelector } from "./base";
import { competenciaDaUrl } from "@/lib/competence";

/**
 * MÉTRICAS COMERCIAIS (F4.6 · ref. 01 §7.5).
 *
 * Toda métrica vem do REGISTRY: nome, descrição e fórmula na tela saem de
 * lá, nunca escritos aqui. É o que impede a tela e o dicionário de métricas
 * de divergirem — quando a fórmula mudar, muda num lugar só.
 *
 * E toda métrica que não dá para calcular aparece como "—" COM O MOTIVO. Um
 * CPL de R$ 0,00 porque ninguém lançou o gasto em anúncios parece resultado
 * excelente, e é a leitura mais cara possível.
 */
export const dynamic = "force-dynamic";

const DINHEIRO = new Set(["cpl", "cpmql", "custo_por_agendamento", "custo_por_reuniao", "cac", "tcv_comercial", "novo_mrr"]);
const PERCENTUAL = new Set(["comparecimento", "conversao_reuniao"]);
const VEZES = new Set(["roas", "pipeline_coverage"]);

const ORDEM = [
  "cpl", "cpmql", "custo_por_agendamento", "custo_por_reuniao",
  "comparecimento", "conversao_reuniao", "cac", "roas",
  "tcv_comercial", "novo_mrr", "pipeline_coverage",
];

function formatar(key: string, valor: number | null): string | null {
  if (valor === null) return null;
  if (DINHEIRO.has(key)) return formatBRL(valor);
  if (PERCENTUAL.has(key)) return `${valor}%`;
  if (VEZES.has(key)) return `${valor.toFixed(2)}×`;
  return String(valor);
}

export default async function MetricasComerciaisPage({
  searchParams,
}: {
  searchParams?: { mes?: string };
}) {
  const viewer = await requirePagePermission("comercial.visualizar");

  const { competence, ano, mes } = competenciaDaUrl(searchParams?.mes);

  const m = await metricasComerciais(competence);

  return (
    <div>
      <PageHeader
        title="Métricas comerciais"
        description={`${monthLabel(new Date(ano, mes - 1, 1))} — o que o dinheiro de aquisição comprou`}
        actions={<MonthNav month={mes} year={ano} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ORDEM.map((key) => {
          const spec = getMetricSpec(key);
          const v = m.metricas[key];
          if (!spec || !v) return null;
          return (
            <MetricCard
              key={key}
              title={spec.name}
              value={formatar(key, v.valor)}
              nullReason={v.motivoDoNulo ?? undefined}
              help={`${spec.description} ${spec.formulaDescription}`}
              basis={DINHEIRO.has(key) ? "competencia" : undefined}
              size="sm"
            />
          );
        })}
      </div>

      <BaseDeValoracaoSelector
        atual={m.baseUsada}
        podeEditar={can(viewer, "comercial.metas")}
      />

      <h2 className="mb-2 mt-6 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Os números que alimentam as contas
      </h2>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border-soft">
            {[
              ["Gasto em anúncios", formatBRL(m.gastoEmAds)],
              ["Leads criados", String(m.leads)],
              ["Leads qualificados", String(m.leadsQualificados)],
              ["Agendamentos", String(m.agendamentos)],
              ["Reuniões realizadas", String(m.reunioesRealizadas)],
              ["No-shows", String(m.noShows)],
              ["Vendas ganhas", String(m.ganhas)],
              ["Vendas perdidas", String(m.perdidas)],
              ["Clientes novos", String(m.novosClientes)],
            ].map(([rotulo, valor]) => (
              <li key={rotulo} className="flex items-center justify-between px-3.5 py-2">
                <span className="text-dense">{rotulo}</span>
                <span className="tabular-nums text-dense">{valor}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="mt-3 text-dense text-muted-foreground">
        O CAC usa o gasto de mídia como “custos comerciais definidos”. Enquanto
        não houver uma marcação própria de despesa comercial (comissão,
        ferramenta de prospecção, salário do time), ele é um piso — e está dito
        aqui em vez de parecer o número final.
      </p>
    </div>
  );
}
