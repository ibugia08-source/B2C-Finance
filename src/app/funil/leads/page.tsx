import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Button } from "@/components/ui/button";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { prisma } from "@/lib/prisma";
import { ListaDeLeads } from "./lista";

/**
 * LEADS E INDICAÇÕES (F4.2 · ref. 01 §4.6).
 *
 * A tela existe separada do quadro porque as perguntas são diferentes: o
 * quadro é "onde está cada venda?"; aqui é "quem chegou e de onde?".
 *
 * INDICAÇÕES ganham destaque próprio (indicado_por / solicitado_por) porque
 * numa agência elas são o canal mais barato e o menos medido — quando o dado
 * mora só na cabeça de quem atendeu, a agência nunca sabe quem são os
 * clientes que trazem clientes.
 */
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const viewer = await requirePagePermission("comercial.visualizar");

  const [leads, agencias, indicacoes] = await Promise.all([
    prisma.lead.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true, name: true, company: true, phone: true, document: true,
        niche: true, channel: true, campaign: true, sdr: true, status: true,
        indicadoPor: true, solicitadoPor: true, createdAt: true,
        convertedClientId: true,
        agency: { select: { name: true } },
      },
    }),
    prisma.agency.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lead.groupBy({
      by: ["indicadoPor"],
      where: { indicadoPor: { not: null } },
      _count: true,
    }),
  ]);

  const abertos = leads.filter((l) => l.status !== "CONVERTED" && l.status !== "LOST").length;
  const convertidos = leads.filter((l) => l.status === "CONVERTED").length;
  const porIndicacao = indicacoes.reduce((s, i) => s + i._count, 0);

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Quem chegou, de onde veio e o que virou"
        actions={
          <Button variant="outline" asChild>
            <Link href="/funil">Ver o funil</Link>
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard title="Em aberto" value={String(abertos)} hint="ainda não convertidos nem perdidos" />
        <MetricCard title="Convertidos" value={String(convertidos)} tone="positive" />
        <MetricCard
          title="Por indicação"
          value={String(porIndicacao)}
          hint={`${indicacoes.length} ${indicacoes.length === 1 ? "pessoa indicou" : "pessoas indicaram"}`}
          help="Indicação costuma ser o canal mais barato e o menos medido: quando o dado fica só na cabeça de quem atendeu, a agência nunca sabe quem traz clientes."
        />
        <MetricCard title="Total no período" value={String(leads.length)} />
      </div>

      <ListaDeLeads
        leads={leads.map((l) => ({
          ...l,
          agencia: l.agency?.name ?? null,
          createdAt: l.createdAt.toISOString(),
        }))}
        agencias={agencias}
        podeOperar={can(viewer, "comercial.operar")}
        podeConverter={can(viewer, "comercial.registrar_venda")}
        indicadores={indicacoes
          .map((i) => ({ nome: i.indicadoPor!, quantidade: i._count }))
          .sort((a, b) => b.quantidade - a.quantidade)
          .slice(0, 10)}
      />
    </div>
  );
}
