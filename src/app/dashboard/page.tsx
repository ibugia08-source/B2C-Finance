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
  };

  const [data, clients, services] = await Promise.all([
    getExecutiveDashboard(filters),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const { kpis, finance, cash, balance, series, breakdowns, health, alerts, actions } = data;

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
          <DashboardFilters clients={clients} services={services} />
        </CardContent>
      </Card>

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

      {/* ===== Caixa & patrimônio ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Caixa & patrimônio
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard href="/caixa" title="Caixa atual" value={formatBRL(cash.caixaDisponivel)}
          intent={cash.caixaDisponivel >= 0 ? "positive" : "negative"}
          hint="contas + reservas" />
        <StatCard href="/caixa" title="Caixa previsto" value={formatBRL(cash.saldoPrevisto)}
          intent={cash.saldoPrevisto >= 0 ? "positive" : "negative"}
          hint="+ a receber − a pagar" />
        <StatCard href="/ativos" title="Ativos" value={formatBRL(balance.ativosTotais)} />
        <StatCard href="/passivos" title="Passivos" value={formatBRL(balance.passivosTotais)}
          intent={balance.passivosTotais > 0 ? "negative" : "default"} />
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
