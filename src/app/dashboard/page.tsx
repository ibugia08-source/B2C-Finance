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
import {
  computeMonthlyResult,
  computeOperationalMargin,
} from "@/lib/financial/calculations";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartCard,
  GroupedBarChart,
  DivergingBarChart,
  LineChart,
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

/**
 * DASHBOARD — poucos indicadores, bons indicadores (dicionário oficial em
 * docs/METRICAS_FINANCEIRAS.md). Três linhas: visão financeira do mês,
 * operação e alertas/decisões — cada card clicável abre o módulo filtrado.
 * Os cálculos vivem na camada central (dashboard/revenue-metrics); esta
 * página só apresenta.
 */

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
    kpis, finance, cash, series, health, alerts, actions,
    renewalOutlook, clients: clientsBlock, upsell, expenses, receipts,
  } = data;
  const owners = ownerRows.map((r) => r.salesOwner!).filter(Boolean);
  const segments = segmentRows.map((r) => r.segment!).filter(Boolean);

  const hs = HEALTH_STYLE[health.level];
  const renovacoes = renewalOutlook[0];

  // ===== Fórmulas oficiais da 1ª linha (docs/METRICAS_FINANCEIRAS.md) =====
  // Em aberto = Faturamento total previsto − Recebido (clamp 0, na camada
  // central); Vencido ⊂ Em aberto; Resultado = Recebido − Despesas do mês;
  // Margem Operacional = Resultado / Recebido.
  const previsto = receipts.expectedTotal;
  const recebido = receipts.receiptsCorrectMonth;
  const emAberto = receipts.openMonth;
  const vencido = receipts.overdueOpenAmount;
  const resultado = computeMonthlyResult(recebido, finance.despesas);
  const margemPct = Math.round(computeOperationalMargin(resultado, recebido) * 100);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Visão geral do financeiro da B2C Gestão · ${period.label}`}
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

      {/* ===== Linha 1 — Visão financeira do mês ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Visão financeira · {period.label}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard href="/cobrancas" title="Faturamento total previsto"
          value={formatBRL(previsto)}
          hint="tudo que está previsto entrar no mês" />
        <StatCard href="/cobrancas?st=PAID" title="Recebido"
          value={formatBRL(recebido)} intent="positive"
          hint={`MRR ${formatBRL(receipts.mrrReceived)} · TCV ${formatBRL(receipts.tcvReceived)}`} />
        <StatCard href="/cobrancas" title="Em aberto"
          value={formatBRL(emAberto)} intent={emAberto > 0 ? "warning" : "default"}
          hint="previsto − recebido (falta receber)" />
        <StatCard href="/cobrancas?st=OVERDUE" title="Vencido"
          value={formatBRL(vencido)}
          intent={vencido > 0 ? "negative" : "default"}
          hint="parte do em aberto já vencida" />
        <StatCard href="/relatorios/financeiro-mensal" title="Resultado"
          value={formatBRL(resultado)}
          intent={resultado >= 0 ? "positive" : "negative"}
          hint={`recebido − despesas ${formatBRL(finance.despesas)} · caixa estimado ${formatBRL(cash.saldoPrevisto)}`} />
        <StatCard href="/relatorios/financeiro-mensal" title="Margem Operacional"
          value={`${margemPct}%`}
          intent={margemPct >= 20 ? "positive" : margemPct >= 0 ? "warning" : "negative"}
          hint="resultado / recebido" />
      </div>

      {/* ===== Linha 2 — Operação ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Operação
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard href="/clientes?status=ACTIVE" title="Clientes ativos"
          value={String(clientsBlock.ativos)} />
        <StatCard href="/clientes?inadimplencia=pago" title="Clientes pagos"
          value={String(clientsBlock.pagosMes)} intent="positive"
          hint="pagamento do mês registrado" />
        <StatCard href="/clientes?inadimplencia=devendo" title="Clientes em aberto"
          value={String(clientsBlock.devendoMes)}
          intent={clientsBlock.devendoMes > 0 ? "negative" : "positive"}
          hint="ainda sem pagamento no mês" />
        <StatCard
          href={renovacoes ? `/clientes?mesRenovacao=${renovacoes.month}` : "/clientes"}
          title="Renovações do mês"
          value={String(renovacoes?.count ?? 0)}
          intent={(renovacoes?.count ?? 0) > 0 ? "warning" : "default"}
          hint={renovacoes ? `${formatBRL(renovacoes.expectedTotal)} esperados` : undefined} />
        <StatCard href="/upsell" title="Upsell em aberto"
          value={String(upsell.openCount)}
          hint={`${formatBRL(upsell.openValue)} em oportunidades`} />
        <StatCard href="/despesas?status=vencida" title="Despesas vencidas"
          value={formatBRL(expenses.overdue)}
          intent={expenses.overdue > 0 ? "negative" : "positive"}
          hint={`${expenses.overdueCount} despesa(s)`} />
      </div>

      {/* ===== Linha 3 — Alertas e decisões ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Alertas e decisões
      </h2>
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
              <ListTodo className="h-3.5 w-3.5" /> O que fazer agora
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
            <p className="mt-4 text-xs text-muted-foreground">
              Sugestões detalhadas com IA na{" "}
              <Link href="/rotina" className="underline">Rotina do dia</Link>.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ===== Tendências ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Tendências · últimos 12 meses
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Receita × despesa por mês">
          <GroupedBarChart
            labels={series.labels}
            series={[
              { name: "Receitas", colorClass: "bg-emerald-500", values: series.receitas },
              { name: "Despesas", colorClass: "bg-rose-500", values: series.despesas },
            ]}
          />
        </ChartCard>
        <ChartCard title="Resultado por mês" hint="receitas − despesas pagas">
          <DivergingBarChart labels={series.labels} values={series.lucro} />
        </ChartCard>
        <ChartCard title="MRR ao longo do tempo" hint="recorrência vigente em cada mês">
          <LineChart labels={series.labels} values={series.mrr} />
        </ChartCard>
      </div>
    </div>
  );
}
