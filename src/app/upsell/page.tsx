import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange } from "@/lib/format";
import { getUpsellKpis } from "@/lib/services/upsell-metrics";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { requirePagePermission } from "@/lib/auth/viewer";
import { UpsellDialog } from "./upsell-dialog";
import { UpsellActions } from "./row-actions";
import { UPSELL_STATUSES, UPSELL_STATUS_LABEL, upsellStatusVariant } from "./_meta";

type Search = { status?: string; responsavel?: string };

export default async function UpsellPage({ searchParams }: { searchParams: Search }) {
  await requirePagePermission("upsell.visualizar");

  const where: any = {};
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.responsavel) where.responsible = searchParams.responsavel;

  const { start, end } = monthRange();

  const [upsellsRaw, clients, services, offers, kpis, respRows] = await Promise.all([
    prisma.upsell.findMany({
      where,
      orderBy: [{ status: "asc" }, { expectedCloseAt: "asc" }, { createdAt: "desc" }],
      take: 300,
      include: {
        client: { select: { name: true } },
        service: { select: { name: true } },
        offer: { select: { name: true } },
      },
    }),
    prisma.client.findMany({
      where: { status: { notIn: ["CHURNED", "INACTIVE"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
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

  // Serializa Decimal + achata nomes para componentes client.
  const upsells = upsellsRaw.map((u) => ({
    ...u,
    value: Number(u.value),
    clientName: u.client.name,
    targetName: u.offer?.name ?? u.service?.name ?? null,
    client: undefined,
  }));
  const responsibles = respRows.map((r) => r.responsible!).filter(Boolean);
  const convPct = Math.round(kpis.conversionRate * 100);

  function filterHref(params: Record<string, string>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...searchParams, ...params })) {
      if (v) sp.set(k, v);
    }
    return `/upsell?${sp.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="Upsell"
        description="Oportunidades de venda interna para clientes da base"
        actions={<UpsellDialog clients={clients} services={services} offers={offers} />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
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

      {/* Filtros simples por chips */}
      <div className="flex flex-wrap items-center gap-2 mb-4 print:hidden">
        <Link href="/upsell">
          <Badge variant={!searchParams.status ? "default" : "outline"}>Todas</Badge>
        </Link>
        {UPSELL_STATUSES.map((s) => (
          <Link key={s} href={filterHref({ status: s })}>
            <Badge variant={searchParams.status === s ? "default" : "outline"}>
              {UPSELL_STATUS_LABEL[s]}
            </Badge>
          </Link>
        ))}
        {responsibles.length > 0 && <span className="text-xs text-muted-foreground ml-2">Responsável:</span>}
        {responsibles.map((r) => (
          <Link key={r} href={filterHref({ responsavel: searchParams.responsavel === r ? "" : r })}>
            <Badge variant={searchParams.responsavel === r ? "default" : "outline"}>{r}</Badge>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Serviço / Oferta</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Previsão</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upsells.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      Nenhuma oportunidade registrada. Identifique serviços ou
                      ofertas que podem ser vendidos para a base atual.
                    </TableCell>
                  </TableRow>
                )}
                {upsells.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <Link href={`/clientes/${u.clientId}`} className="hover:underline">
                        {u.clientName}
                      </Link>
                      {u.title && (
                        <p className="text-xs text-muted-foreground max-w-[220px] truncate">
                          {u.title}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{u.targetName ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatBRL(u.value)}
                    </TableCell>
                    <TableCell className="text-sm">{u.responsible ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={upsellStatusVariant(u.status)}>
                        {UPSELL_STATUS_LABEL[u.status as keyof typeof UPSELL_STATUS_LABEL]}
                      </Badge>
                      {u.closedAt && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          fechado {formatDateBR(u.closedAt)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.expectedCloseAt ? formatDateBR(u.expectedCloseAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <UpsellActions
                        upsell={u}
                        clients={clients}
                        services={services}
                        offers={offers}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCards>
            {upsells.length === 0 ? (
              <MobileEmpty>
                Nenhuma oportunidade registrada. Identifique serviços ou ofertas que
                podem ser vendidos para a base atual.
              </MobileEmpty>
            ) : (
              upsells.map((u) => (
                <MobileCard key={u.id}>
                  <MobileCardHeader
                    title={u.clientName}
                    aside={
                      <Badge variant={upsellStatusVariant(u.status)}>
                        {UPSELL_STATUS_LABEL[u.status as keyof typeof UPSELL_STATUS_LABEL]}
                      </Badge>
                    }
                  />
                  <div className="space-y-1.5">
                    <Field label="Serviço/Oferta">{u.targetName ?? u.title ?? "—"}</Field>
                    <Field label="Valor">{formatBRL(u.value)}</Field>
                    <Field label="Responsável">{u.responsible ?? "—"}</Field>
                    <Field label="Previsão">
                      {u.expectedCloseAt ? formatDateBR(u.expectedCloseAt) : "—"}
                    </Field>
                  </div>
                  <MobileCardActions>
                    <UpsellActions
                      upsell={u}
                      clients={clients}
                      services={services}
                      offers={offers}
                    />
                  </MobileCardActions>
                </MobileCard>
              ))
            )}
          </MobileCards>
        </CardContent>
      </Card>

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
