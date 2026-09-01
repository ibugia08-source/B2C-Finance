import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Target } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { carregarFunil, tempoPorEtapa } from "@/lib/services/pipeline";
import { DIAS_PARA_PARADA } from "@/lib/commercial/funil";
import { QuadroDoFunil } from "./quadro";

/**
 * FUNIL COMERCIAL (F4.2 · ref. 01 §4.6; 02 §4).
 *
 * Gabarito 3 de 02 §7.5 não se aplica aqui: quadro é quadro. Mas a regra de
 * acessibilidade de §7.9 vale — "kanban tem select": arrastar é atalho, não
 * caminho único, e todo card muda de etapa por um seletor operável no
 * teclado.
 *
 * O tempo por etapa fica ao lado do quadro de propósito: é o número que
 * explica POR QUE o funil está do jeito que está. Quadro cheio na proposta
 * com média de 18 dias é uma informação; quadro cheio com média de 2 dias é
 * outra completamente diferente.
 */
export const dynamic = "force-dynamic";

export default async function FunilPage() {
  const viewer = await requirePagePermission("comercial.visualizar");

  const [funil, tempos, agencias, ofertas, leads] = await Promise.all([
    carregarFunil(),
    tempoPorEtapa(),
    prisma.agency.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.offer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lead.findMany({
      where: { status: { notIn: ["CONVERTED", "LOST"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, company: true },
    }),
  ]);

  const vazio = funil.colunas.every((c) => c.cards.length === 0);

  return (
    <div>
      <PageHeader
        title="Funil comercial"
        description="As vendas em andamento, por etapa — e quanto tempo cada etapa está levando"
        actions={
          <Button variant="outline" asChild>
            <Link href="/funil/leads">Leads</Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          title="Em negociação"
          value={formatBRL(funil.totalEmAberto)}
          hint={`${funil.colunas.reduce((s, c) => s + c.cards.length, 0)} oportunidades`}
          help="Soma do valor negociado das oportunidades que ainda não foram ganhas nem perdidas. Não é receita: é o que está em jogo."
        />
        <MetricCard
          title={`Paradas há ${DIAS_PARA_PARADA} dias ou mais`}
          value={String(funil.paradas)}
          tone={funil.paradas > 0 ? "warning" : "positive"}
          hint="Sem mudança de etapa"
        />
        <MetricCard
          title="Ganhas no mês"
          value={String(funil.ganhasNoMes)}
          tone="positive"
        />
        <MetricCard
          title="Valor ganho no mês"
          value={formatBRL(funil.valorGanhoNoMes)}
          basis="competencia"
          tone="positive"
        />
      </div>

      {vazio ? (
        <EmptyState
          icon={Target}
          title="Nenhuma venda em andamento"
          description="Cadastre um lead e abra a primeira oportunidade — o quadro mostra em que etapa cada venda está e há quanto tempo."
          action={
            <Button asChild>
              <Link href="/funil/leads">Cadastrar lead</Link>
            </Button>
          }
        />
      ) : null}

      <QuadroDoFunil
        colunas={funil.colunas}
        agencias={agencias}
        ofertas={ofertas}
        leads={leads}
        podeOperar={can(viewer, "comercial.operar")}
        podeGanhar={can(viewer, "comercial.registrar_venda")}
      />

      <h2 className="mb-2 mt-6 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Tempo médio por etapa
      </h2>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border-soft">
            {tempos.map((t) => (
              <li key={t.etapa} className="flex items-center justify-between px-3.5 py-2.5">
                <span>{t.titulo}</span>
                <span className="text-dense tabular-nums text-muted-foreground">
                  {t.mediaDeDias === null
                    ? "sem passagem concluída ainda"
                    : `${t.mediaDeDias} ${t.mediaDeDias === 1 ? "dia" : "dias"} · ${t.amostras} ${t.amostras === 1 ? "passagem" : "passagens"}`}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <p className="mt-2 text-caption text-muted-foreground">
        A média conta só as passagens CONCLUÍDAS. Incluir a etapa em que a
        venda ainda está faria a média cair todo dia — e a métrica diria que o
        funil melhora justamente quando ele trava.
      </p>
    </div>
  );
}
