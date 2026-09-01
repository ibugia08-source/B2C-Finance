import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/lib/auth/viewer";
import { formatBRL } from "@/lib/format";
import { rotinaSemanal, type SituacaoDoBloco } from "@/lib/services/weekly-routine";
import { TarefasDaSemana } from "./tarefas";

/**
 * ROTINA SEMANAL (F3.10 · ref. 02 §4.6).
 *
 * A rotina diária é sobre HOJE. Esta é sobre o que está andando na direção
 * errada e ainda dá tempo de corrigir: o cliente que virou crítico, a
 * renovação daqui a 25 dias que ninguém conversou, a promessa que vence
 * quinta. Nada disso é urgente hoje — e é por isso que some da rotina diária
 * todo dia, até virar problema.
 */
export const dynamic = "force-dynamic";

const VISUAL: Record<SituacaoDoBloco, { rotulo: string; variante: "success" | "warning" | "outline" }> = {
  OK: { rotulo: "em dia", variante: "success" },
  ATENCAO: { rotulo: "olhar", variante: "warning" },
  NAO_MEDIDO: { rotulo: "ainda não medido", variante: "outline" },
};

function delta(atual: number, anterior: number): string {
  if (anterior === 0) return atual === 0 ? "igual à semana passada" : "sem base na semana passada";
  const pct = Math.round(((atual - anterior) / Math.abs(anterior)) * 100);
  if (pct === 0) return "igual à semana passada";
  return `${pct > 0 ? "+" : ""}${pct}% ante a semana passada`;
}

export default async function RotinaSemanalPage() {
  await requirePagePermission("rotina.visualizar");
  const r = await rotinaSemanal();

  const paraOlhar = r.blocos.filter((b) => b.situacao === "ATENCAO").length;
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

  return (
    <div>
      <PageHeader
        title="Rotina da semana"
        description={`Semana de ${fmt.format(r.inicio)} a ${fmt.format(new Date(r.fim.getTime() - 86_400_000))} — o que ainda dá tempo de corrigir`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/rotina">Rotina de hoje</Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          title="Blocos para olhar"
          value={String(paraOlhar)}
          tone={paraOlhar > 0 ? "warning" : "positive"}
          hint={`de ${r.blocos.length} blocos da semana`}
        />
        <MetricCard
          title="Recebido na semana"
          value={formatBRL(r.comparativo.recebidoSemana)}
          basis="caixa"
          hint={delta(r.comparativo.recebidoSemana, r.comparativo.recebidoSemanaAnterior)}
        />
        <MetricCard
          title="Pago na semana"
          value={formatBRL(r.comparativo.despesasSemana)}
          basis="caixa"
          goodWhenUp={false}
          hint={delta(r.comparativo.despesasSemana, r.comparativo.despesasSemanaAnterior)}
        />
        <MetricCard
          title="Cobranças criadas"
          value={String(r.comparativo.novasCobrancas)}
          hint={delta(r.comparativo.novasCobrancas, r.comparativo.novasCobrancasAnterior)}
        />
      </div>

      <div className="space-y-3">
        {r.blocos.map((b) => (
          <Card key={b.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-body font-medium">
                    <span className="text-muted-foreground">{b.numero}. </span>
                    {b.titulo}
                  </p>
                  <p className="mt-0.5 text-dense text-muted-foreground">{b.resumo}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={VISUAL[b.situacao].variante}>{VISUAL[b.situacao].rotulo}</Badge>
                  <span className="text-caption text-muted-foreground">{b.dono}</span>
                  {b.href ? (
                    <Link href={b.href} className="text-dense text-brand hover:underline">
                      Abrir
                    </Link>
                  ) : null}
                </div>
              </div>

              {b.itens.length > 0 ? (
                <TarefasDaSemana blocoId={b.id} itens={b.itens} />
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mt-3 text-caption text-muted-foreground">
        Marcar um item guarda a conclusão da semana. O que não dá para medir
        aparece dito, nunca verde.
      </p>
    </div>
  );
}
