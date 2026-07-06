import { PageHeader } from "@/components/page-header";
import { SavedViews } from "@/components/saved-views";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange, parseDateBR } from "@/lib/format";
import { getClientSummaries, type ClientSituation } from "@/lib/services/client-metrics";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import { ClientDialog } from "./client-dialog";
import { ContractUploadDialog } from "./contract-upload-dialog";
import { RenewClientDialog } from "./renew-dialog";
import { ClientActions } from "./row-actions";
import { ClientFilters } from "./filters";
import { CLIENT_STATUS_LABEL, clientStatusVariant } from "./_meta";

const PAGE_SIZE = 50;

type Search = {
  q?: string;
  status?: string;
  servico?: string;
  segmento?: string;
  situacao?: string; // inadimplente
  renovacao?: string; // dias
  entradaDe?: string;
  entradaAte?: string;
  ordem?: string; // az | za
  pagina?: string;
};

const SITUATION_META: Record<ClientSituation, { label: string; variant: any }> = {
  EM_DIA: { label: "Em dia", variant: "success" },
  INADIMPLENTE: { label: "Inadimplente", variant: "destructive" },
  SEM_COBRANCA: { label: "Sem cobrança", variant: "secondary" },
};

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireAdmin();

  // ---------- where a partir dos filtros ----------
  const where: any = {};
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.segmento) where.segment = searchParams.segmento;
  if (searchParams.q) {
    const q = searchParams.q.trim();
    const like = { contains: q, mode: "insensitive" as const };
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { name: like },
          { legalName: like },
          { document: like },
          { email: like },
          { segment: like },
          { city: like },
          { salesOwner: like },
          { opsOwner: like },
          { tags: { has: q.toLowerCase() } },
        ],
      },
    ];
  }
  if (searchParams.servico) {
    where.contracts = {
      some: {
        status: "ACTIVE",
        services: { some: { serviceId: searchParams.servico } },
      },
    };
  }
  if (searchParams.situacao === "inadimplente") {
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { status: "DELINQUENT" },
          { billings: { some: { status: "OVERDUE" } } },
        ],
      },
    ];
  }
  if (searchParams.renovacao) {
    const dias = parseInt(searchParams.renovacao, 10) || 30;
    const limite = new Date();
    limite.setDate(limite.getDate() + dias);
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { status: "RENEWAL" },
          {
            contracts: {
              some: { status: "ACTIVE", renewalDate: { lte: limite } },
            },
          },
        ],
      },
    ];
  }
  if (searchParams.entradaDe || searchParams.entradaAte) {
    const range: any = {};
    const de = searchParams.entradaDe ? parseDateBR(searchParams.entradaDe) : null;
    const ate = searchParams.entradaAte ? parseDateBR(searchParams.entradaAte) : null;
    if (de) range.gte = de;
    if (ate) {
      ate.setDate(ate.getDate() + 1); // inclusivo
      range.lt = ate;
    }
    if (Object.keys(range).length) where.startedAt = range;
  }

  const page = Math.max(1, parseInt(searchParams.pagina ?? "1", 10) || 1);
  const { start, end } = monthRange();

  // ---------- dados em paralelo ----------
  const [
    clientsRaw,
    total,
    services,
    segmentRows,
    ativos,
    inadimplentesStatus,
    novosMes,
    mrrAgg,
    renewDue,
  ] = await Promise.all([
    prisma.client.findMany({
      where,
      // Ordem alfabética (A-Z padrão; ?ordem=za inverte)
      orderBy: { name: searchParams.ordem === "za" ? "desc" : "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.client.count({ where }),
    prisma.service.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.client.findMany({
      where: { segment: { not: null } },
      distinct: ["segment"],
      select: { segment: true },
      orderBy: { segment: "asc" },
    }),
    prisma.client.count({ where: { status: "ACTIVE" } }),
    prisma.client.count({ where: { status: "DELINQUENT" } }),
    prisma.client.count({ where: { startedAt: { gte: start, lt: end } } }),
    prisma.client.aggregate({
      where: { status: "ACTIVE" },
      _sum: { monthlyValue: true },
    }),
    prisma.contract.findMany({
      where: {
        status: { in: ["ACTIVE", "RENEWAL", "OVERDUE"] },
        renewalDate: {
          not: null,
          lte: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59),
        },
      },
      orderBy: { renewalDate: "asc" },
      select: { id: true, clientId: true, type: true, totalValue: true, monthlyValue: true },
    }),
  ]);

  // contrato a renovar por cliente (chegou no mês de renovação)
  const renewByClient = new Map<string, { id: string; type: string; totalValue: number; monthlyValue: number }>();
  for (const r of renewDue) {
    if (!renewByClient.has(r.clientId)) {
      renewByClient.set(r.clientId, {
        id: r.id, type: r.type, totalValue: Number(r.totalValue), monthlyValue: Number(r.monthlyValue),
      });
    }
  }

  // Resumo financeiro por cliente da página (lote único).
  const summaries = await getClientSummaries(clientsRaw.map((c) => c.id));

  // Serializa Decimal → number para os componentes client.
  const clients = clientsRaw.map((c) => ({
    ...c,
    monthlyValue: c.monthlyValue != null ? Number(c.monthlyValue) : null,
  }));

  const segments = segmentRows.map((r) => r.segment!).filter(Boolean);

  const mrrBase = mrrAgg._sum.monthlyValue != null ? Number(mrrAgg._sum.monthlyValue) : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(p: number) {
    const params = new URLSearchParams(searchParams as Record<string, string>);
    params.set("pagina", String(p));
    return `/clientes?${params.toString()}`;
  }

  // Valor mensal exibido: contrato ativo > cadastro do cliente.
  function monthlyOf(c: (typeof clients)[number]) {
    const s = summaries.get(c.id);
    if (s && s.activeContracts > 0) return s.monthlyValue;
    return c.monthlyValue ?? 0;
  }

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Carteira de clientes da B2C Gestão"
        actions={
          <div className="flex flex-wrap gap-2">
            <ContractUploadDialog />
            <ClientDialog />
          </div>
        }
      />

      <div className="mb-3 print:hidden">
        <SavedViews module="clientes" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard title="Clientes ativos" value={String(ativos)} intent="positive" />
        <StatCard title="Novos no mês" value={String(novosMes)} />
        <StatCard
          title="Inadimplentes"
          value={String(inadimplentesStatus)}
          intent={inadimplentesStatus > 0 ? "negative" : "default"}
        />
        <StatCard
          title="MRR base (ativos)"
          value={formatBRL(mrrBase)}
          hint="Valor mensal dos clientes ativos"
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <ClientFilters
            services={services.map((s) => ({ value: s.id, label: s.name }))}
            segments={segments}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Serviços ativos</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Receita total</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Próx. venc.</TableHead>
                  <TableHead>Renovação</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="text-center text-muted-foreground py-12"
                    >
                      Nenhum cliente encontrado com esses filtros.
                      <br />
                      Ajuste a busca ou cadastre um novo cliente.
                    </TableCell>
                  </TableRow>
                )}
                {clients.map((c) => {
                  const s = summaries.get(c.id)!;
                  const sit = SITUATION_META[s.situation];
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        <Link href={`/clientes/${c.id}`} className="hover:underline">
                          {c.name}
                        </Link>
                        {c.segment && (
                          <p className="text-xs text-muted-foreground">{c.segment}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={clientStatusVariant(c.status)}>
                          {CLIENT_STATUS_LABEL[c.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[180px]">
                        {s.activeServices.length ? (
                          <span className="text-sm">{s.activeServices.join(", ")}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {monthlyOf(c) > 0 ? formatBRL(monthlyOf(c)) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.totalRevenue > 0 ? formatBRL(s.totalRevenue) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={sit.variant}>{sit.label}</Badge>
                        {s.openAmount > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatBRL(s.openAmount)} em aberto
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.nextDueDate ? formatDateBR(s.nextDueDate) : "—"}
                      </TableCell>
                      <TableCell>
                        {renewByClient.has(c.id) ? (
                          <RenewClientDialog contract={renewByClient.get(c.id)!} clientName={c.name} />
                        ) : s.nextRenewal ? (
                          formatDateBR(s.nextRenewal)
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.salesOwner ?? c.opsOwner ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <ClientActions client={c} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <MobileCards>
            {clients.length === 0 ? (
              <MobileEmpty>
                Nenhum cliente encontrado com esses filtros. Ajuste a busca ou
                cadastre um novo cliente.
              </MobileEmpty>
            ) : (
              clients.map((c) => {
                const s = summaries.get(c.id)!;
                const sit = SITUATION_META[s.situation];
                return (
                  <MobileCard key={c.id}>
                    <MobileCardHeader
                      title={
                        <Link href={`/clientes/${c.id}`} className="hover:underline">
                          {c.name}
                        </Link>
                      }
                      aside={
                        <Badge variant={clientStatusVariant(c.status)}>
                          {CLIENT_STATUS_LABEL[c.status]}
                        </Badge>
                      }
                    />
                    <div className="space-y-1.5">
                      <Field label="Serviços">
                        {s.activeServices.length ? s.activeServices.join(", ") : "—"}
                      </Field>
                      <Field label="Mensal">
                        {monthlyOf(c) > 0 ? formatBRL(monthlyOf(c)) : "—"}
                      </Field>
                      <Field label="Receita total">
                        {s.totalRevenue > 0 ? formatBRL(s.totalRevenue) : "—"}
                      </Field>
                      <Field label="Situação">
                        <Badge variant={sit.variant}>{sit.label}</Badge>
                      </Field>
                      <Field label="Próx. venc.">
                        {s.nextDueDate ? formatDateBR(s.nextDueDate) : "—"}
                      </Field>
                      <Field label="Renovação">
                        {s.nextRenewal ? formatDateBR(s.nextRenewal) : "—"}
                      </Field>
                      <Field label="Responsável">
                        {c.salesOwner ?? c.opsOwner ?? "—"}
                      </Field>
                    </div>
                    <MobileCardActions>
                      <ClientActions client={c} />
                    </MobileCardActions>
                  </MobileCard>
                );
              })
            )}
          </MobileCards>
        </CardContent>
      </Card>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            {total} cliente{total === 1 ? "" : "s"} · página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild disabled={page <= 1}>
              <Link href={pageHref(page - 1)}>Anterior</Link>
            </Button>
            <Button variant="outline" size="sm" asChild disabled={page >= totalPages}>
              <Link href={pageHref(page + 1)}>Próxima</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
