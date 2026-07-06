import { PageHeader } from "@/components/page-header";
import { CobrancasTabs } from "@/app/cobrancas/module-tabs";
import { SavedViews } from "@/components/saved-views";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange, parseDateBR, parseBRL } from "@/lib/format";
import {
  markOverdueBillings,
  getBillingKpis,
} from "@/lib/services/billing-metrics";
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
import { BillingDialog } from "./billing-dialog";
import { BillingActions } from "./row-actions";
import { BillingFilters } from "./filters";
import {
  BILLING_STATUS_LABEL,
  COLLECTION_STATUS_LABEL,
  billingStatusVariant,
} from "./_meta";
import type { BillingMessageInput } from "@/lib/billing-message";

type Search = {
  status?: string;
  cliente?: string;
  contrato?: string;
  servico?: string;
  responsavel?: string;
  periodo?: string; // dia | semana | mes
  avencer?: string;
  vencDe?: string;
  vencAte?: string;
  valorMin?: string;
};

function periodRange(periodo?: string): { start: Date; end: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (periodo === "dia") {
    const end = new Date(today);
    end.setDate(end.getDate() + 1);
    return { start: today, end };
  }
  if (periodo === "semana") {
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay()); // domingo
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  return monthRange(now);
}

export default async function CobrancasPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireAdmin();

  // Atualização automática de vencidas (barata e idempotente).
  await markOverdueBillings();

  const { start: pStart, end: pEnd } = periodRange(searchParams.periodo);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const where: any = {};
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.cliente) where.clientId = searchParams.cliente;
  if (searchParams.contrato) where.contractId = searchParams.contrato;
  if (searchParams.servico) where.serviceId = searchParams.servico;
  if (searchParams.responsavel) where.collector = searchParams.responsavel;
  if (searchParams.avencer === "1") {
    where.status = { in: ["PENDING", "PARTIAL"] };
    where.dueDate = { gte: today };
  }
  if (searchParams.periodo) {
    where.dueDate = { ...(where.dueDate ?? {}), gte: pStart, lt: pEnd };
  }
  if (searchParams.vencDe || searchParams.vencAte) {
    const range: any = { ...(where.dueDate ?? {}) };
    const de = searchParams.vencDe ? parseDateBR(searchParams.vencDe) : null;
    const ate = searchParams.vencAte ? parseDateBR(searchParams.vencAte) : null;
    if (de) range.gte = de;
    if (ate) {
      ate.setDate(ate.getDate() + 1);
      range.lt = ate;
    }
    where.dueDate = range;
  }
  if (searchParams.valorMin) {
    const min = parseBRL(searchParams.valorMin);
    if (min > 0) where.amount = { gte: min };
  }

  const [billingsRaw, kpis, clients, contractsRaw, services, accounts, collectorRows] =
    await Promise.all([
      prisma.billing.findMany({
        where,
        orderBy: [{ dueDate: "asc" }],
        take: 300,
        include: {
          client: { select: { id: true, name: true, phone: true } },
          contract: { select: { title: true } },
          service: { select: { name: true } },
          _count: { select: { history: true } },
        },
      }),
      getBillingKpis(pStart, pEnd),
      prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.contract.findMany({
        orderBy: { title: "asc" },
        select: { id: true, title: true, clientId: true },
      }),
      prisma.service.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.account.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.billing.findMany({
        where: { collector: { not: null } },
        distinct: ["collector"],
        select: { collector: true },
      }),
    ]);

  const billings = billingsRaw.map((b) => {
    const amount = Number(b.amount);
    const paidTotal = Number(b.paidTotal);
    const daysOverdue =
      b.status === "OVERDUE"
        ? Math.max(1, Math.floor((today.getTime() - b.dueDate.getTime()) / 86_400_000))
        : 0;
    return {
      ...b,
      amount,
      paidTotal,
      openAmount: amount - paidTotal,
      daysOverdue,
    };
  });

  const collectors = collectorRows.map((r) => r.collector!).filter(Boolean).sort();

  const msgInput = (b: (typeof billings)[number]): BillingMessageInput => ({
    clientName: b.client.name,
    openAmount: formatBRL(b.openAmount),
    dueDate: formatDateBR(b.dueDate),
    daysOverdue: b.daysOverdue,
    serviceNames: [b.service?.name ?? b.contract?.title ?? ""].filter(Boolean),
    hasPromise: b.collectionStatus === "PROMISED",
    contactCount: b._count.history,
  });

  return (
    <div>
      <PageHeader
        title="Cobranças"
        description="Contas a receber da agência"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/inadimplencia">Inadimplência</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/pagamentos">Pagamentos</Link>
            </Button>
            <BillingDialog clients={clients} contracts={contractsRaw} services={services} />
          </div>
        }
      />

      <CobrancasTabs active="/cobrancas" />

      <div className="mb-3 print:hidden">
        <SavedViews module="cobrancas" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
        <StatCard title="Total a receber" value={formatBRL(kpis.totalAReceber)} />
        <StatCard title="Recebido no período" value={formatBRL(kpis.recebidoPeriodo)} intent="positive" />
        <StatCard title="Vencido" value={formatBRL(kpis.totalVencido)}
          intent={kpis.totalVencido > 0 ? "negative" : "default"} />
        <StatCard title="A vencer" value={formatBRL(kpis.totalAVencer)} intent="warning" />
        <StatCard title="Parcial" value={formatBRL(kpis.totalParcial)} />
        <StatCard title="Clientes inadimplentes" value={String(kpis.clientesInadimplentes)}
          intent={kpis.clientesInadimplentes > 0 ? "negative" : "positive"} />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <BillingFilters
            clients={clients.map((c) => ({ value: c.id, label: c.name }))}
            contracts={contractsRaw.map((c) => ({ value: c.id, label: c.title }))}
            services={services.map((s) => ({ value: s.id, label: s.name }))}
            collectors={collectors}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente / descrição</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead className="text-right">Em aberto</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cobrança</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billings.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                      Nenhuma cobrança encontrada. Gere cobranças a partir dos
                      acordos (em /acordos) ou crie uma cobrança manual.
                    </TableCell>
                  </TableRow>
                )}
                {billings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="max-w-[240px]">
                      <Link href={`/clientes/${b.client.id}`} className="font-medium hover:underline">
                        {b.client.name}
                      </Link>
                      <p className="text-xs text-muted-foreground truncate">{b.description}</p>
                    </TableCell>
                    <TableCell>
                      {String(b.competenceMonth).padStart(2, "0")}/{b.competenceYear}
                    </TableCell>
                    <TableCell>
                      {formatDateBR(b.dueDate)}
                      {b.daysOverdue > 0 && (
                        <p className="text-xs text-destructive">{b.daysOverdue}d atraso</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatBRL(b.amount)}</TableCell>
                    <TableCell className="text-right text-emerald-600">
                      {b.paidTotal > 0 ? formatBRL(b.paidTotal) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {b.openAmount > 0 ? formatBRL(b.openAmount) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={billingStatusVariant(b.status)}>
                        {BILLING_STATUS_LABEL[b.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {COLLECTION_STATUS_LABEL[b.collectionStatus]}
                      {b.collector && <p>por {b.collector}</p>}
                    </TableCell>
                    <TableCell className="text-right">
                      <BillingActions
                        billing={b}
                        messageInput={msgInput(b)}
                        phone={b.client.phone}
                        accounts={accounts}
                        clients={clients}
                        contracts={contractsRaw}
                        services={services}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCards>
            {billings.length === 0 ? (
              <MobileEmpty>
                Nenhuma cobrança encontrada. Gere cobranças pelos contratos ou crie
                uma manual.
              </MobileEmpty>
            ) : (
              billings.map((b) => (
                <MobileCard key={b.id}>
                  <MobileCardHeader
                    title={b.client.name}
                    aside={
                      <Badge variant={billingStatusVariant(b.status)}>
                        {BILLING_STATUS_LABEL[b.status]}
                      </Badge>
                    }
                  />
                  <p className="text-xs text-muted-foreground -mt-1">{b.description}</p>
                  <div className="space-y-1.5">
                    <Field label="Vencimento">
                      {formatDateBR(b.dueDate)}
                      {b.daysOverdue > 0 ? ` (${b.daysOverdue}d)` : ""}
                    </Field>
                    <Field label="Esperado">{formatBRL(b.amount)}</Field>
                    <Field label="Em aberto">
                      {b.openAmount > 0 ? formatBRL(b.openAmount) : "—"}
                    </Field>
                    <Field label="Cobrança">
                      {COLLECTION_STATUS_LABEL[b.collectionStatus]}
                    </Field>
                  </div>
                  <MobileCardActions>
                    <BillingActions
                      billing={b}
                      messageInput={msgInput(b)}
                      phone={b.client.phone}
                      accounts={accounts}
                      clients={clients}
                      contracts={contractsRaw}
                      services={services}
                    />
                  </MobileCardActions>
                </MobileCard>
              ))
            )}
          </MobileCards>
        </CardContent>
      </Card>
    </div>
  );
}
