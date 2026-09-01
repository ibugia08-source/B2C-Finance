import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { painelDoCloser } from "@/lib/services/commercial-goals";
import { SeletorDeCloser } from "./seletor";

/**
 * HOME DO CLOSER (F4.5 · ref. 02 §5.4).
 *
 * "Closer: vendas x meta, pipeline por estágio, conversão, tempo por etapa;
 * ações."
 *
 * A ordem da tela é a da spec e não é acidental: primeiro o que ele fez
 * (vendas x meta), depois o que ele tem (pipeline), depois como ele está
 * indo (conversão) e por último o que fazer AGORA — as paradas e as vendas
 * que ele ganhou e não entregou. Painel que termina em número, e não em ação,
 * é painel que se olha uma vez por mês.
 *
 * §5.4 também diz: "Nenhum painel de papel mostra resultado, folha ou caixa
 * sem permissão de campo." Esta tela não mostra nenhum dos três — só o que é
 * do funil.
 */
export const dynamic = "force-dynamic";

export default async function CloserPage({
  searchParams,
}: {
  searchParams?: { closer?: string };
}) {
  const viewer = await requirePagePermission("comercial.visualizar");

  const closers = await prisma.opportunity.findMany({
    where: { closer: { not: null } },
    distinct: ["closer"],
    orderBy: { closer: "asc" },
    select: { closer: true },
  });
  const nomes = [
    ...new Set([viewer.name, ...closers.map((c) => c.closer!)].filter((x): x is string => !!x)),
  ].sort();

  const closer =
    searchParams?.closer && nomes.includes(searchParams.closer)
      ? searchParams.closer
      : (viewer.name ?? nomes[0] ?? "Sem nome");

  const p = await painelDoCloser(closer);

  return (
    <div>
      <PageHeader
        title="Painel do closer"
        description={`${p.diasUteisDecorridos} de ${p.diasUteisNoMes} dias úteis do mês`}
        actions={nomes.length > 1 ? <SeletorDeCloser nomes={nomes} atual={closer} /> : undefined}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          title="Vendas no mês"
          value={String(p.vendas)}
          tone={p.metaDeVendas && p.vendas >= p.metaDeVendas ? "positive" : "default"}
          hint={p.metaDeVendas ? `meta ${p.metaDeVendas}` : "sem meta definida"}
        />
        <MetricCard
          title="Valor vendido"
          value={formatBRL(p.valorVendido)}
          basis="competencia"
          tone={p.metaDeValor && p.valorVendido >= p.metaDeValor ? "positive" : "default"}
          hint={p.metaDeValor ? `meta ${formatBRL(p.metaDeValor)}` : "sem meta definida"}
        />
        <MetricCard
          title="Conversão do mês"
          value={p.conversao === null ? null : `${p.conversao}%`}
          nullReason="Nenhuma venda decidida no mês"
          hint={`${p.vendas} ganhas · ${p.perdidasNoMes} perdidas`}
          help="Ganhas ÷ (ganhas + perdidas) no mês. Dividir pelo funil inteiro misturaria vendas que ainda nem foram trabalhadas, e a taxa cairia toda vez que entrasse lead novo."
        />
        <MetricCard
          title="Paradas"
          value={String(p.paradas.length)}
          tone={p.paradas.length > 0 ? "warning" : "positive"}
          hint="Sem mudança de etapa há 7 dias ou mais"
        />
      </div>

      <h2 className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Pipeline por etapa
      </h2>
      <Card className="mb-4">
        <CardContent className="p-0">
          <ul className="divide-y divide-border-soft">
            {p.porEtapa.map((e) => (
              <li key={e.etapa} className="flex items-center justify-between px-3.5 py-2.5">
                <span>
                  {e.titulo}
                  <span className="ml-1.5 text-caption text-muted-foreground">
                    {e.quantidade} {e.quantidade === 1 ? "oportunidade" : "oportunidades"}
                  </span>
                </span>
                <span className="tabular-nums">{formatBRL(e.valor)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <h2 className="mb-2 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        O que fazer agora
      </h2>
      <Card>
        <CardContent className="p-0">
          {p.paradas.length === 0 && p.semHandoff.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-dense text-muted-foreground">
              Nada parado e nenhuma venda pendente de entrega.
            </p>
          ) : (
            <ul className="divide-y divide-border-soft">
              {p.semHandoff.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <span className="min-w-0 truncate">
                    {s.titulo}
                    <Badge variant="warning" className="ml-2">venda sem cliente</Badge>
                  </span>
                  <Link href="/funil" className="shrink-0 text-dense text-brand hover:underline">
                    entregar
                  </Link>
                </li>
              ))}
              {p.paradas.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <span className="min-w-0 truncate">
                    {o.titulo}
                    <span className="ml-1.5 text-caption text-muted-foreground">
                      parada há {o.dias} dias
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-dense">{formatBRL(o.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
