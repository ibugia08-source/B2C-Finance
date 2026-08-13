import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, monthRange } from "@/lib/format";
import { getUpsellKpis } from "@/lib/services/upsell-metrics";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { UpsellDialog } from "./upsell-dialog";
import { UpsellBoard, type BoardUpsell } from "./upsell-board";

type Search = { responsavel?: string };

/**
 * UPSELL — funil Kanban das vendas internas para a base: Oportunidade →
 * Apresentação → Vendido / Recusado. Cards arrastáveis; vender pergunta em
 * qual mês lançar a cobrança nos recebimentos. Oportunidades nascem aqui ou
 * pela ficha do cliente (Gestão do Mês → cliente → Upsell).
 */
export default async function UpsellPage({ searchParams }: { searchParams: Search }) {
  const viewer = await requirePagePermission("upsell.visualizar");
  const gates = {
    criar: can(viewer, "upsell.criar"),
    editar: can(viewer, "upsell.editar"),
    vender: can(viewer, "upsell.marcar_vendido"),
    excluir: can(viewer, "upsell.excluir"),
  };

  const where: any = {};
  if (searchParams.responsavel) where.responsible = searchParams.responsavel;

  const { start, end } = monthRange();

  const [upsellsRaw, clients, services, offers, kpis, respRows] = await Promise.all([
    prisma.upsell.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 300,
      include: {
        client: { select: { name: true } },
        service: { select: { name: true } },
        offer: { select: { name: true } },
        services: { include: { service: { select: { name: true } } } },
      },
    }),
    prisma.client.findMany({
      where: { status: { notIn: ["CHURNED", "INACTIVE"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    prisma.service.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.offer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getUpsellKpis(start, end),
    prisma.upsell.findMany({
      where: { responsible: { not: null } },
      distinct: ["responsible"],
      select: { responsible: true },
      orderBy: { responsible: "asc" },
    }),
  ]);

  // Serializa Decimal/Date para o board (client component).
  const upsells: BoardUpsell[] = upsellsRaw.map((u) => ({
    id: u.id,
    clientId: u.clientId,
    clientName: u.client.name,
    title: u.title,
    value: Number(u.value),
    responsible: u.responsible,
    status: u.status,
    expectedCloseAt: u.expectedCloseAt ? u.expectedCloseAt.toISOString() : null,
    closedAt: u.closedAt ? u.closedAt.toISOString() : null,
    serviceNames: u.services.map((us) => us.service.name),
    targetName: u.offer?.name ?? u.service?.name ?? null,
    notes: u.notes,
    serviceId: u.serviceId,
    offerId: u.offerId,
    services: u.services.map((us) => ({
      serviceId: us.serviceId,
      unitPrice: Number(us.unitPrice),
    })),
  }));

  const responsibles = respRows.map((r) => r.responsible!).filter(Boolean);
  const convPct = Math.round(kpis.conversionRate * 100);

  function filterHref(params: Record<string, string>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...searchParams, ...params })) {
      if (v) sp.set(k, v);
    }
    const qs = sp.toString();
    return qs ? `/upsell?${qs}` : "/upsell";
  }

  return (
    <div>
      <PageHeader
        title="Upsell"
        description="Funil de vendas internas para a base — arraste os cards entre as etapas"
        actions={
          gates.criar ? (
            <UpsellDialog clients={clients} services={services} offers={offers} />
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <StatCard
          title="Em aberto"
          value={String(kpis.openCount)}
          hint={`${formatBRL(kpis.openValue)} em oportunidades`}
        />
        <StatCard
          title="Ganho no mês"
          value={formatBRL(kpis.wonValue)}
          intent="positive"
          hint={`${kpis.wonCount} venda(s)`}
        />
        <StatCard
          title="Conversão (mês)"
          value={`${convPct}%`}
          intent={convPct >= 50 ? "positive" : convPct > 0 ? "warning" : "default"}
          hint="vendidos / decididos"
        />
      </div>

      {/* Filtro por responsável */}
      {responsibles.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 print:hidden">
          <span className="text-xs text-muted-foreground">Responsável:</span>
          <Link href="/upsell">
            <Badge variant={!searchParams.responsavel ? "default" : "outline"}>Todos</Badge>
          </Link>
          {responsibles.map((r) => (
            <Link
              key={r}
              href={filterHref({ responsavel: searchParams.responsavel === r ? "" : r })}
            >
              <Badge variant={searchParams.responsavel === r ? "default" : "outline"}>
                {r}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      <UpsellBoard
        upsells={upsells}
        clients={clients}
        services={services}
        offers={offers}
        canEdit={gates.editar}
        canSell={gates.vender}
        canDelete={gates.excluir}
      />

      {/* Rankings */}
      {(kpis.byResponsible.length > 0 || kpis.byTarget.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
                Por responsável
              </p>
              <ul className="space-y-1.5 text-sm">
                {kpis.byResponsible.map((r) => (
                  <li key={r.label} className="flex justify-between gap-2">
                    <span className="truncate">{r.label}</span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      aberto {formatBRL(r.open)} · ganho{" "}
                      <span className="text-emerald-600 font-medium">{formatBRL(r.won)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
                Por serviço / oferta
              </p>
              <ul className="space-y-1.5 text-sm">
                {kpis.byTarget.map((r) => (
                  <li key={r.label} className="flex justify-between gap-2">
                    <span className="truncate">{r.label}</span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      aberto {formatBRL(r.open)} · ganho{" "}
                      <span className="text-emerald-600 font-medium">{formatBRL(r.won)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
