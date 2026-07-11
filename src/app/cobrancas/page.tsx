import { PageHeader } from "@/components/page-header";
import { CobrancasTabs } from "@/app/cobrancas/module-tabs";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, parseMonthParam } from "@/lib/format";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import {
  ensureMonthlyBillings,
  cycleStatusOf,
  CYCLE_STATUS_LABEL,
  type CycleStatus,
} from "@/lib/services/receivables-cycle";
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
import { AlertCircle, UserPlus } from "lucide-react";
import { requireAdmin } from "@/lib/auth/viewer";
import { BillingDialog } from "./billing-dialog";
import { BillingActions } from "./row-actions";
import { MonthNav } from "./month-nav";
import type { BillingMessageInput } from "@/lib/billing-message";

/**
 * RECEBIMENTOS — ciclo mensal da carteira (planilha mensal inteligente).
 * Mês selecionado → clientes que devem pagar no mês → status de cada um.
 * Cadastro de cliente é SÓ na Gestão de Carteira; contratos DOCX ficam
 * em /contratos — aqui é apenas cobrança e pagamento do mês.
 */

type Search = {
  mes?: string; // YYYY-MM
  st?: string; // CycleStatus
  responsavel?: string;
  cliente?: string;
  // compat com links antigos (dashboard/rotina)
  situacao?: string; // atrasado | outro-mes
  avencer?: string;
  status?: string; // OVERDUE | PAID (legado)
};

const STATUS_VARIANT: Record<CycleStatus, any> = {
  UPCOMING: "warning",
  PAID: "success",
  PAID_LATE: "success",
  PAID_OTHER_MONTH: "secondary",
  OVERDUE: "destructive",
  PARTIAL: "warning",
  REMOVED: "outline",
};

/** Mapeia parâmetros legados para o filtro do ciclo. */
function legacyStatus(sp: Search): CycleStatus | "" {
  if (sp.st) return sp.st as CycleStatus;
  if (sp.situacao === "atrasado") return "PAID_LATE";
  if (sp.situacao === "outro-mes") return "PAID_OTHER_MONTH";
  if (sp.avencer === "1") return "UPCOMING";
  if (sp.status === "OVERDUE") return "OVERDUE";
  if (sp.status === "PAID") return "PAID";
  return "";
}

export default async function RecebimentosPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireAdmin();

  const now = new Date();
  const mes = parseMonthParam(searchParams.mes) ?? {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };

  // Manutenção do ciclo: marca vencidas + gera as mensalidades MRR que faltam.
  await markOverdueBillings();
  await ensureMonthlyBillings(mes.month, mes.year);

  const [billingsRaw, clients, contractsRaw, services, accounts, respRows] =
    await Promise.all([
      prisma.billing.findMany({
        where: {
          competenceMonth: mes.month,
          competenceYear: mes.year,
          ...(searchParams.cliente ? { clientId: searchParams.cliente } : {}),
        },
        orderBy: [{ dueDate: "asc" }],
        take: 500,
        include: {
          client: {
            select: {
              id: true, name: true, phone: true, modality: true,
              startedAt: true, createdAt: true, paymentDay: true, salesOwner: true,
            },
          },
          contract: { select: { title: true } },
          service: { select: { name: true } },
          _count: { select: { history: true } },
        },
      }),
      prisma.client.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.contract.findMany({
        orderBy: { title: "asc" },
        select: { id: true, title: true, clientId: true },
      }),
      prisma.service.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.account.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.client.findMany({
        where: { salesOwner: { not: null } },
        distinct: ["salesOwner"],
        select: { salesOwner: true },
        orderBy: { salesOwner: "asc" },
      }),
    ]);

  const today = new Date();

  // Linhas do ciclo com status derivado (interface simples).
  const rows = billingsRaw
    .map((b) => {
      const amount = Number(b.amount);
      const paidTotal = Number(b.paidTotal);
      const { status, daysLate } = cycleStatusOf(
        {
          id: b.id, status: b.status, isLate: b.isLate,
          paidInDifferentMonth: b.paidInDifferentMonth,
          dueDate: b.dueDate, paidAt: b.paidAt,
        },
        today
      );
      const responsible = b.collector ?? b.client.salesOwner ?? null;
      return {
        ...b,
        amount,
        paidTotal,
        openAmount: Math.max(0, amount - paidTotal),
        cycleStatus: status,
        daysLate,
        responsible,
        entryDate: b.client.startedAt ?? b.client.createdAt,
      };
    })
    // Removidos do mês ficam ocultos (a geração não os recria), a menos
    // que o filtro peça explicitamente.
    .filter((r) =>
      legacyStatus(searchParams) === "REMOVED"
        ? r.cycleStatus === "REMOVED"
        : r.cycleStatus !== "REMOVED"
    )
    .sort((a, b) => a.client.name.localeCompare(b.client.name, "pt-BR"));

  // ===== KPIs do mês (antes dos filtros de visualização) =====
  const kAReceber = rows.reduce((s, r) => s + r.amount, 0);
  const kRecebido = rows.reduce((s, r) => s + r.paidTotal, 0);
  const kAVencer = rows
    .filter((r) => r.cycleStatus === "UPCOMING" || r.cycleStatus === "PARTIAL")
    .reduce((s, r) => s + r.openAmount, 0);
  const kVencido = rows
    .filter((r) => r.cycleStatus === "OVERDUE")
    .reduce((s, r) => s + r.openAmount, 0);
  const kPagos = rows.filter(
    (r) => r.cycleStatus === "PAID" || r.cycleStatus === "PAID_LATE"
  ).length;
  const kDevendo = rows.filter(
    (r) => r.cycleStatus === "OVERDUE" || r.cycleStatus === "PARTIAL"
  ).length;

  // ===== Filtros de visualização =====
  const stFilter = legacyStatus(searchParams);
  const respFilter = searchParams.responsavel ?? "";
  const visible = rows.filter((r) => {
    if (stFilter && stFilter !== "REMOVED" && r.cycleStatus !== stFilter) return false;
    if (respFilter && r.responsible !== respFilter) return false;
    return true;
  });

  const responsibles = respRows.map((r) => r.salesOwner!).filter(Boolean);

  const chipHref = (params: Record<string, string>) => {
    const spNew = new URLSearchParams();
    if (searchParams.mes) spNew.set("mes", searchParams.mes);
    if (searchParams.responsavel) spNew.set("responsavel", searchParams.responsavel);
    for (const [k, v] of Object.entries(params)) if (v) spNew.set(k, v);
    const qs = spNew.toString();
    return qs ? `/cobrancas?${qs}` : "/cobrancas";
  };

  const CHIPS: { label: string; st: string }[] = [
    { label: "Todos", st: "" },
    { label: "A vencer", st: "UPCOMING" },
    { label: "Pagos", st: "PAID" },
    { label: "Pagos com atraso", st: "PAID_LATE" },
    { label: "Inadimplentes", st: "OVERDUE" },
    { label: "Recebidos em outro mês", st: "PAID_OTHER_MONTH" },
    { label: "Removidos do mês", st: "REMOVED" },
  ];

  const msgInput = (r: (typeof rows)[number]): BillingMessageInput => ({
    clientName: r.client.name,
    openAmount: formatBRL(r.openAmount),
    dueDate: formatDateBR(r.dueDate),
    daysOverdue: r.cycleStatus === "OVERDUE" ? r.daysLate : 0,
    serviceNames: [r.service?.name ?? r.contract?.title ?? ""].filter(Boolean),
    hasPromise: r.collectionStatus === "PROMISED",
    contactCount: r._count.history,
  });

  const monthLabelStr = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(mes.year, mes.month - 1, 1));

  return (
    <div>
      <PageHeader
        title="Recebimentos"
        description={`Ciclo mensal de pagamentos da carteira · ${monthLabelStr}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/clientes" title="O cadastro de clientes é feito na Gestão de Carteira">
                <UserPlus className="h-4 w-4 mr-1" /> Cadastrar cliente na Carteira
              </Link>
            </Button>
            <BillingDialog clients={clients} contracts={contractsRaw} services={services} />
          </div>
        }
      />

      <CobrancasTabs active="/cobrancas" />

      {/* ===== Filtro mensal (modo mês) ===== */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <MonthNav month={mes.month} year={mes.year} />
        {responsibles.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Responsável:</span>
            <Link href={chipHref({ st: stFilter })}>
              <Badge variant={!respFilter ? "default" : "outline"}>Todos</Badge>
            </Link>
            {responsibles.map((r) => (
              <Link key={r} href={chipHref({ st: stFilter, responsavel: respFilter === r ? "" : r })}>
                <Badge variant={respFilter === r ? "default" : "outline"}>{r}</Badge>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ===== KPIs do mês ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
        <StatCard title="A receber no mês" value={formatBRL(kAReceber)} />
        <StatCard title="Recebido" value={formatBRL(kRecebido)} intent="positive" />
        <StatCard title="A vencer" value={formatBRL(kAVencer)} intent="warning" />
        <StatCard title="Vencido" value={formatBRL(kVencido)}
          intent={kVencido > 0 ? "negative" : "default"} />
        <StatCard title="Clientes pagos" value={String(kPagos)} intent="positive" />
        <StatCard title="Clientes devendo" value={String(kDevendo)}
          intent={kDevendo > 0 ? "negative" : "positive"} />
      </div>

      {/* ===== Chips de status ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        {CHIPS.map((c) => (
          <Link key={c.label} href={chipHref({ st: c.st })}>
            <Badge variant={stFilter === c.st ? "default" : "outline"}>{c.label}</Badge>
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
                  <TableHead>Modalidade</TableHead>
                  <TableHead>Entrada</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor do mês</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pago em</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                      Nenhum recebimento neste ciclo. Clientes MRR ativos entram
                      automaticamente; adicione uma cobrança avulsa ao mês ou{" "}
                      <Link href="/clientes" className="underline">
                        cadastre o cliente na Gestão de Carteira
                      </Link>.
                    </TableCell>
                  </TableRow>
                )}
                {visible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[220px]">
                      <span className="flex items-center gap-1.5">
                        <Link
                          href={`/clientes/${r.client.id}`}
                          className="font-medium hover:underline truncate"
                        >
                          {r.client.name}
                        </Link>
                        {(r.cycleStatus === "OVERDUE" || r.cycleStatus === "PAID_LATE") && (
                          <span
                            title="Pagamento em atraso em relação à data de vencimento."
                            className="cursor-help"
                          >
                            <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          </span>
                        )}
                      </span>
                      <p className="text-xs text-muted-foreground truncate">{r.description}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.revenueType === "MRR" ? "default" : "secondary"}>
                        {r.revenueType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.entryDate ? formatDateBR(r.entryDate) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateBR(r.dueDate)}
                      {r.client.paymentDay && (
                        <p className="text-[11px] text-muted-foreground">
                          todo dia {r.client.paymentDay}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatBRL(r.amount)}
                      {r.cycleStatus === "PARTIAL" && (
                        <p className="text-[11px] text-muted-foreground">
                          {formatBRL(r.openAmount)} em aberto
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.cycleStatus]}>
                        {CYCLE_STATUS_LABEL[r.cycleStatus]}
                      </Badge>
                      <p className="text-[11px] mt-0.5 text-muted-foreground">
                        {r.cycleStatus === "OVERDUE" ? (
                          <span className="text-destructive font-medium">
                            ! {r.daysLate} dia{r.daysLate === 1 ? "" : "s"} em atraso
                          </span>
                        ) : r.cycleStatus === "PAID_LATE" ? (
                          `pago com ${r.daysLate} dia${r.daysLate === 1 ? "" : "s"} de atraso`
                        ) : r.cycleStatus === "PAID_OTHER_MONTH" ? (
                          "→ Receita Extra no mês do pagamento"
                        ) : (
                          "Em dia"
                        )}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.paidAt ? formatDateBR(r.paidAt) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{r.responsible ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <BillingActions
                        billing={r}
                        messageInput={msgInput(r)}
                        phone={r.client.phone}
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

          {/* Mobile */}
          <MobileCards>
            {visible.length === 0 ? (
              <MobileEmpty>
                Nenhum recebimento neste ciclo. Clientes MRR ativos entram
                automaticamente no mês.
              </MobileEmpty>
            ) : (
              visible.map((r) => (
                <MobileCard key={r.id}>
                  <MobileCardHeader
                    title={
                      <Link href={`/clientes/${r.client.id}`} className="hover:underline">
                        {r.client.name}
                      </Link>
                    }
                    aside={
                      <Badge variant={STATUS_VARIANT[r.cycleStatus]}>
                        {CYCLE_STATUS_LABEL[r.cycleStatus]}
                      </Badge>
                    }
                  />
                  <div className="space-y-1.5">
                    <Field label="Modalidade">{r.revenueType}</Field>
                    <Field label="Vencimento">{formatDateBR(r.dueDate)}</Field>
                    <Field label="Valor do mês">{formatBRL(r.amount)}</Field>
                    <Field label="Situação">
                      {r.cycleStatus === "OVERDUE"
                        ? `! ${r.daysLate}d em atraso`
                        : r.cycleStatus === "PAID_LATE"
                          ? `pago com ${r.daysLate}d de atraso`
                          : "Em dia"}
                    </Field>
                    <Field label="Pago em">{r.paidAt ? formatDateBR(r.paidAt) : "—"}</Field>
                    <Field label="Responsável">{r.responsible ?? "—"}</Field>
                  </div>
                  <MobileCardActions>
                    <BillingActions
                      billing={r}
                      messageInput={msgInput(r)}
                      phone={r.client.phone}
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

      <p className="mt-3 text-xs text-muted-foreground print:hidden">
        Clientes MRR ativos entram automaticamente no ciclo do mês. Perdidos e
        pausados não entram; TCV entra apenas no mês de adesão/renovação.
        Removidos do mês não são recriados. O cadastro de clientes é feito na{" "}
        <Link href="/clientes" className="underline">Gestão de Carteira</Link>.
      </p>
    </div>
  );
}
