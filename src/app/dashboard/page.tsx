import Link from "next/link";
import { SavedViews } from "@/components/saved-views";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { getViewer } from "@/lib/auth/viewer";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import {
  getExecutiveDashboard,
  type DashboardFilters as Filters,
  type DashAlert,
} from "@/lib/services/dashboard-metrics";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartCard,
  GroupedBarChart,
  DivergingBarChart,
  LineChart,
  HBarList,
} from "@/components/charts";
import { DashboardFilters } from "./dashboard-filters";
import { PersonalDashboard } from "./personal-dashboard";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ListTodo,
} from "lucide-react";

type Search = Record<string, string | undefined>;

const HEALTH_STYLE: Record<string, { badge: any; bar: string }> = {
  excelente: { badge: "success", bar: "bg-emerald-500" },
  saudavel: { badge: "success", bar: "bg-emerald-500" },
  estavel: { badge: "secondary", bar: "bg-sky-500" },
  atencao: { badge: "warning", bar: "bg-amber-500" },
  critica: { badge: "destructive", bar: "bg-red-500" },
};

const SEVERITY_DOT: Record<DashAlert["severity"], string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
};

export default async function DashboardPage({ searchParams }: { searchParams?: Search }) {
  const viewer = await getViewer("/dashboard");

  // USER comum: recepção simples (os módulos financeiros são da agência).
  if (viewer.role !== "ADMIN") {
    return <PersonalDashboard />;
  }

  await markOverdueBillings();

  const sp = searchParams ?? {};
  const period = resolvePeriod(sp);
  const filters: Filters = {
    period,
    clientId: sp.cliente || undefined,
    serviceId: sp.servico || undefined,
    billingStatus: sp.status || undefined,
    revenueType: sp.treceita || undefined,
    expenseType: sp.tdespesa || undefined,
    modality: sp.modalidade || undefined,
    salesOwner: sp.responsavel || undefined,
    segment: sp.segmento || undefined,
    clientStatus: sp.statuscliente || undefined,
  };

  const [data, clients, services, ownerRows, segmentRows] = await Promise.all([
    getExecutiveDashboard(filters),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.client.findMany({
      where: { salesOwner: { not: null } },
      distinct: ["salesOwner"],
      select: { salesOwner: true },
      orderBy: { salesOwner: "asc" },
    }),
    prisma.client.findMany({
      where: { segment: { not: null } },
      distinct: ["segment"],
      select: { segment: true },
      orderBy: { segment: "asc" },
    }),
  ]);
  const {
    kpis, finance, cash, series, breakdowns, health, alerts, actions,
    revenue, renewalOutlook, losses, clients: clientsBlock, upsell, expenses,
    receipts,
  } = data;
  const owners = ownerRows.map((r) => r.salesOwner!).filter(Boolean);
  const segments = segmentRows.map((r) => r.segment!).filter(Boolean);

  const hs = HEALTH_STYLE[health.level];
  const inadPct = Math.round(kpis.inadimplenciaTaxa * 100);
  const margemPct = Math.round(finance.margem * 100);
  const folhaPct = Math.round(finance.folhaSobreReceita * 100);

  return (
    <div>
      <PageHeader
        title="Dashboard executivo"
        description={`Saúde financeira da B2C Gestão · ${period.label}`}
      />

      <div className="mb-3 print:hidden">
        <SavedViews module="dashboard" />
      </div>

      <Card className="mb-5">
        <CardContent className="p-4">
          <DashboardFilters
            clients={clients}
            services={services}
            owners={owners}
            segments={segments}
          />
        </CardContent>
      </Card>

      {/* ===== Faturamento do período — regra oficial:
           Faturamento = Recebimentos no mês correto + Receitas Extras ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Faturamento · {period.label}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <Card className="border-primary/25 bg-primary/[0.03]">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Faturamento total do período
            </p>
            <p className="text-3xl font-bold mt-1.5 text-primary">
              {formatBRL(receipts.totalRevenue)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              recebimentos no mês correto + receitas extras
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Recebimentos do período
            </p>
            <p className="text-2xl font-bold mt-1.5">
              {formatBRL(receipts.receiptsCorrectMonth)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              MRR {formatBRL(receipts.mrrReceived)} · TCV {formatBRL(receipts.tcvReceived)}
            </p>
          </CardContent>
        </Card>
        <Link href="/receitas" className="group">
          <Card className="h-full transition-shadow group-hover:shadow-md">
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Receita Extra
              </p>
              <p className="text-2xl font-bold mt-1.5">
                {formatBRL(receipts.extraRevenueTotal)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatBRL(receipts.extraRevenueAutomatic)} recuperação de inadimplência ·{" "}
                {formatBRL(receipts.extraRevenueManual)} avulsas
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard href="/cobrancas" title="MRR recebido"
          value={formatBRL(receipts.mrrReceived)} intent="positive" />
        <StatCard href="/cobrancas" title="TCV recebido"
          value={formatBRL(receipts.tcvReceived)}
          hint="valor cheio no mês da adesão" />
        <StatCard href="/cobrancas?situacao=atrasado" title="Pagos com atraso"
          value={String(receipts.lateSameMonthCount)}
          intent={receipts.lateSameMonthCount > 0 ? "warning" : "default"}
          hint={formatBRL(receipts.lateSameMonthValue)} />
        <StatCard href="/cobrancas?situacao=outro-mes" title="Pagos em outro mês"
          value={String(receipts.paidDifferentMonthCount)}
          intent={receipts.paidDifferentMonthCount > 0 ? "warning" : "default"}
          hint={`${formatBRL(receipts.paidDifferentMonthValue)} → Receita Extra`} />
        <StatCard href="/cobrancas" title="Receita em aberto"
          value={formatBRL(receipts.openAmount)}
          intent={receipts.openAmount > 0 ? "warning" : "positive"}
          hint="competência do período não quitada" />
        <StatCard href="/cobrancas" title="Esperado (competência)"
          value={formatBRL(revenue.total)}
          hint={`MRR ${formatBRL(revenue.mrr)} · TCV ${formatBRL(revenue.tcv)} · ${revenue.mrrClients} cli. MRR`} />
      </div>

      {/* ===== Clientes ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Clientes
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
        <StatCard href="/clientes?status=ACTIVE" title="Ativos"
          value={String(clientsBlock.ativos)} intent="positive" />
        <StatCard href="/clientes?status=PAUSED" title="Pausados"
          value={String(clientsBlock.pausados)}
          intent={clientsBlock.pausados > 0 ? "warning" : "default"} />
        <StatCard href="/clientes?status=CHURNED" title="Perdidos"
          value={String(clientsBlock.perdidos)}
          intent={clientsBlock.perdidos > 0 ? "negative" : "default"} />
        <StatCard href="/clientes?modalidade=MRR&status=ACTIVE" title="MRR ativos"
          value={String(clientsBlock.mrrAtivos)} />
        <StatCard href="/clientes?modalidade=TCV&status=ACTIVE" title="TCV ativos"
          value={String(clientsBlock.tcvAtivos)} />
        <StatCard href="/clientes?inadimplencia=devendo" title="Devendo no mês"
          value={String(clientsBlock.devendoMes)}
          intent={clientsBlock.devendoMes > 0 ? "negative" : "positive"} />
        <StatCard href="/clientes?inadimplencia=pago" title="Pagos no mês"
          value={String(clientsBlock.pagosMes)} intent="positive" />
      </div>

      {/* ===== Renovações (mês atual → 3 meses à frente) ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Renovações
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {renewalOutlook.map((w) => (
          <Link key={w.offset} href={`/clientes?mesRenovacao=${w.month}`} className="group">
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <CardContent className="p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                  {w.offset === 0
                    ? "Renovações deste mês"
                    : w.offset === 1
                      ? "Próximo mês"
                      : `Em ${w.offset} meses`}
                </p>
                <p className="text-[11px] text-muted-foreground">{w.label}</p>
                <div className="flex items-baseline gap-2 mt-1.5">
                  <p className="text-2xl font-bold">{w.count}</p>
                  <p className="text-sm text-muted-foreground">
                    cliente{w.count === 1 ? "" : "s"}
                  </p>
                </div>
                <p className="text-sm font-medium mt-0.5">
                  {formatBRL(w.expectedTotal)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">esperado</span>
                </p>
                {w.clients.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1.5 truncate">
                    {w.clients.slice(0, 3).map((c) => c.name).join(", ")}
                    {w.clients.length > 3 ? ` +${w.clients.length - 3}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* ===== Perdas de clientes e receita ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Perdas de clientes
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          href="/clientes?status=CHURNED"
          title="Perdidos no mês"
          value={String(losses.currentMonth.count)}
          intent={losses.currentMonth.count > 0 ? "negative" : "positive"}
          hint={`${formatBRL(losses.currentMonth.value)} de receita perdida`}
        />
        <StatCard
          href="/clientes?status=CHURNED"
          title="Perdidos · últimos 3 meses"
          value={String(losses.last3Months.count)}
          intent={losses.last3Months.count > 0 ? "warning" : "positive"}
          hint={`${formatBRL(losses.last3Months.value)} de receita perdida`}
        />
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
              Perdas por responsável (3m)
            </p>
            {losses.last3Months.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem perdas no período.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {Object.entries(
                  losses.last3Months.items.reduce<Record<string, { count: number; value: number }>>(
                    (acc, l) => {
                      const key = l.salesOwner ?? "Sem responsável";
                      acc[key] = acc[key] ?? { count: 0, value: 0 };
                      acc[key].count += 1;
                      acc[key].value += l.value;
                      return acc;
                    },
                    {}
                  )
                )
                  .sort((a, b) => b[1].value - a[1].value)
                  .slice(0, 5)
                  .map(([owner, agg]) => (
                    <li key={owner} className="flex justify-between gap-2">
                      <span className="truncate">{owner}</span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        {agg.count} ·{" "}
                        <span className="text-red-600 dark:text-red-400 font-medium">
                          {formatBRL(agg.value)}
                        </span>
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
              Perdas recentes
            </p>
            {losses.last3Months.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma perda registrada nos últimos 3 meses. 🎉
              </p>
            ) : (
              <ul className="space-y-1.5">
                {losses.last3Months.items.slice(0, 4).map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <Link href={`/clientes/${l.clientId}`} className="font-medium hover:underline">
                        {l.clientName}
                      </Link>
                      <span className="block text-xs text-muted-foreground truncate">
                        {[
                          l.modality,
                          l.salesOwner,
                          l.reason,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="text-red-600 dark:text-red-400 font-medium">
                        {formatBRL(l.value)}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(l.lostAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== Upsell ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Upsell
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <StatCard href="/upsell" title="Oportunidades abertas"
          value={String(upsell.openCount)}
          hint={formatBRL(upsell.openValue)} />
        <StatCard href="/upsell" title="Valor em oportunidades"
          value={formatBRL(upsell.openValue)} />
        <StatCard href="/upsell?status=WON" title="Ganho no período"
          value={formatBRL(upsell.wonValue)} intent="positive" />
        <StatCard href="/upsell?status=WON" title="Vendidos"
          value={String(upsell.wonCount)}
          intent={upsell.wonCount > 0 ? "positive" : "default"} />
        <StatCard href="/upsell" title="Conversão"
          value={`${Math.round(upsell.conversionRate * 100)}%`}
          hint="vendidos / decididos no período" />
      </div>

      {/* ===== Despesas ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Despesas
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard href="/despesas" title="Despesas do mês"
          value={formatBRL(expenses.total)} intent="negative" />
        <StatCard href="/despesas?status=pago" title="Pagas"
          value={formatBRL(expenses.paid)} intent="positive" />
        <StatCard href="/despesas?status=pendente" title="Pendentes"
          value={formatBRL(expenses.pending)} intent="warning" />
        <StatCard href="/despesas?status=vencida" title="Vencidas"
          value={formatBRL(expenses.overdue)}
          intent={expenses.overdue > 0 ? "negative" : "default"} />
        <StatCard href="/despesas?recorrente=sim" title="Recorrentes"
          value={formatBRL(expenses.recurring)}
          hint={`${expenses.recurringCount} despesa(s)`} />
        <StatCard href="/despesas?aba=resumo" title="Débitos de cartão"
          value={formatBRL(expenses.invoiceOpenTotal)}
          intent={expenses.invoiceOpenTotal > 0 ? "warning" : "default"} />
        <StatCard href="/despesas?aba=cartoes" title="Limite total"
          value={formatBRL(expenses.creditLimitTotal)} />
        <StatCard href="/despesas?aba=cartoes" title="Limite disponível"
          value={formatBRL(expenses.creditLimitAvailable)}
          intent={
            expenses.creditLimitTotal > 0 &&
            expenses.creditLimitAvailable < expenses.creditLimitTotal * 0.2
              ? "negative"
              : "positive"
          } />
      </div>

      {/* ===== Saúde financeira ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-1">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Saúde financeira
            </p>
            <div className="flex items-center gap-3 mt-2">
              <p className="text-3xl font-bold">{health.score}</p>
              <Badge variant={hs.badge} className="text-sm">{health.label}</Badge>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden mt-3">
              <div className={`h-full rounded-full ${hs.bar}`} style={{ width: `${health.score}%` }} />
            </div>
            <ul className="mt-4 space-y-1.5">
              {health.fatores.map((fator, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  {fator.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                  )}
                  <span className={fator.ok ? "text-muted-foreground" : "text-foreground"}>
                    {fator.text}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Alertas
            </p>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-6 text-center">
                Nenhum alerta. Tudo em dia. 🎉
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {alerts.map((a, i) => (
                  <li key={i}>
                    <Link href={a.href} className="group flex items-start gap-2.5">
                      <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${SEVERITY_DOT[a.severity]}`} />
                      <span className="min-w-0">
                        <span className="text-sm font-medium group-hover:underline flex items-center gap-1">
                          {a.title}
                          <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                        <span className="block text-xs text-muted-foreground">{a.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
              <ListTodo className="h-3.5 w-3.5" /> Próximas ações
            </p>
            {actions.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-6 text-center">
                Nenhuma ação pendente sugerida.
              </p>
            ) : (
              <ol className="mt-3 space-y-2.5 list-none">
                {actions.map((action, i) => (
                  <li key={i}>
                    <Link href={action.href} className="group flex items-start gap-2.5 text-sm">
                      <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="group-hover:underline">{action.text}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== Comercial & faturamento ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Comercial & faturamento · {period.label}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        <StatCard href="/cobrancas" title="Faturamento esperado" value={formatBRL(kpis.faturamentoEsperado)}
          hint="cobranças com vencimento no período" />
        <StatCard href="/pagamentos" title="Faturamento recebido" value={formatBRL(kpis.faturamentoRecebido)}
          intent="positive" hint="pagamentos confirmados" />
        <StatCard href="/cobrancas?avencer=1" title="Receita pendente" value={formatBRL(kpis.receitaPendente)}
          hint="em aberto dentro do prazo" />
        <StatCard href="/inadimplencia" title="Receita vencida" value={formatBRL(kpis.receitaVencida)}
          intent={kpis.receitaVencida > 0 ? "negative" : "default"} />
        <StatCard href="/inadimplencia" title="Inadimplência" value={`${inadPct}%`}
          intent={inadPct > 25 ? "negative" : inadPct > 10 ? "warning" : "positive"}
          hint="vencido / total em aberto" />
        <StatCard href="/acordos" title="MRR ativo" value={formatBRL(kpis.mrrAtivo)} intent="positive"
          hint="recorrência mensal vigente" />
        <StatCard href="/acordos" title="TCV vendido" value={formatBRL(kpis.tcvVendido)}
          hint="contratos iniciados no período" />
        <StatCard href="/clientes" title="Novos clientes" value={String(kpis.novosClientes)} />
        <StatCard href="/clientes" title="Clientes ativos" value={String(kpis.clientesAtivos)} />
        <StatCard href="/inadimplencia" title="Clientes inadimplentes" value={String(kpis.clientesInadimplentes)}
          intent={kpis.clientesInadimplentes > 0 ? "negative" : "positive"} />
        <StatCard href="/acordos" title="Contratos em renovação" value={String(kpis.contratosEmRenovacao)}
          intent={kpis.contratosEmRenovacao > 0 ? "warning" : "default"}
          hint="próximos 30 dias" />
      </div>

      {/* ===== Resultado do período ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Resultado · {period.label}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <StatCard href="/despesas" title="Despesas totais" value={formatBRL(finance.despesas)} intent="negative" />
        <StatCard href="/folha" title="Folha total" value={formatBRL(finance.folhaPeriodo)} />
        <StatCard href="/folha" title="Folha / faturamento" value={`${folhaPct}%`}
          intent={folhaPct > 40 ? "negative" : folhaPct > 25 ? "warning" : "positive"} />
        <StatCard href="/despesas" title="Lucro / prejuízo" value={formatBRL(finance.lucro)}
          intent={finance.lucro >= 0 ? "positive" : "negative"}
          hint="receitas − despesas pagas" />
        <StatCard href="/relatorios/financeiro-mensal" title="Margem operacional" value={`${margemPct}%`}
          intent={margemPct >= 20 ? "positive" : margemPct >= 0 ? "warning" : "negative"} />
      </div>

      {/* ===== Caixa ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Caixa
      </h2>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard href="/caixa" title="Caixa atual" value={formatBRL(cash.caixaDisponivel)}
          intent={cash.caixaDisponivel >= 0 ? "positive" : "negative"}
          hint="contas + reservas" />
        <StatCard href="/caixa" title="Caixa previsto" value={formatBRL(cash.saldoPrevisto)}
          intent={cash.saldoPrevisto >= 0 ? "positive" : "negative"}
          hint="+ a receber − a pagar" />
      </div>

      {/* ===== Gráficos ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Tendências · últimos 12 meses
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartCard title="Receita × despesa por mês">
          <GroupedBarChart
            labels={series.labels}
            series={[
              { name: "Receitas", colorClass: "bg-emerald-500", values: series.receitas },
              { name: "Despesas", colorClass: "bg-rose-500", values: series.despesas },
            ]}
          />
        </ChartCard>
        <ChartCard title="Lucro / prejuízo por mês" hint="receitas − despesas pagas">
          <DivergingBarChart labels={series.labels} values={series.lucro} />
        </ChartCard>
        <ChartCard title="MRR ao longo do tempo" hint="contratos recorrentes vigentes em cada mês">
          <LineChart labels={series.labels} values={series.mrr} />
        </ChartCard>
        <ChartCard title="Inadimplência por mês" hint="valores vencidos em aberto, por mês de vencimento">
          <GroupedBarChart
            labels={series.labels}
            series={[{ name: "Vencido em aberto", colorClass: "bg-red-500", values: series.inadimplencia }]}
          />
        </ChartCard>
        <ChartCard title="Folha sobre faturamento" hint="ideal: até 40%">
          <LineChart
            labels={series.labels}
            values={series.folhaPct}
            stroke="#f59e0b"
            format={(v) => `${Math.round(v)}%`}
          />
        </ChartCard>
        <ChartCard title="Projeção de caixa" hint="caixa + recebíveis − despesas e parcelas no horizonte">
          <DivergingBarChart
            labels={["Hoje", "30 dias", "60 dias", "90 dias"]}
            values={[cash.caixaDisponivel, cash.projecao30, cash.projecao60, cash.projecao90]}
          />
        </ChartCard>
      </div>

      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Rankings · {period.label}
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Despesas por categoria">
          <HBarList items={breakdowns.despesasPorCategoria} colorClass="bg-rose-500" />
        </ChartCard>
        <ChartCard title="Receita por serviço" hint="recebido no período">
          <HBarList items={breakdowns.receitaPorServico} colorClass="bg-emerald-500" />
        </ChartCard>
        <ChartCard title="Receita por cliente" hint="recebido no período">
          <HBarList items={breakdowns.receitaPorCliente} colorClass="bg-[#1E70D3]" />
        </ChartCard>
      </div>
    </div>
  );
}
