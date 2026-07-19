import Link from "next/link";
import { SavedViews } from "@/components/saved-views";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
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
  getMonthlyAverageTicket,
  getMonthlyCostPerClient,
  getPayrollPercentageOfRevenue,
  getMonthlyChurn,
  getNewClientsSummary,
} from "@/lib/financial/calculations";
import {
  getDashboardMainMetrics,
  getYearlySeries,
  getResultLaunchedForMonth,
  getOpenByClient,
  getReceivedDetail,
  getExpensesDetail,
  getExpensesByCategory,
} from "@/lib/services/dashboard-main";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartCard,
  GroupedBarChart,
  LineChart,
  HBarList,
} from "@/components/charts";
import { MainChart } from "@/components/dashboard/main-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { LaunchToCash } from "@/components/dashboard/launch-to-cash";
import {
  FaturamentoDetail, DespesasDetail, RecebidoDetail, EmAbertoDetail, ResultadoDetail,
} from "./detail-panels";
import { MonthFilter } from "./month-filter";
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
  // Único filtro do Dashboard: o PERÍODO. Recortes por cliente/serviço/
  // responsável etc. vivem nos módulos e relatórios.
  const filters: Filters = { period };

  // Ano/mês do período (para série anual e "Lançar ao caixa").
  const selectedYear = period.start.getFullYear();
  const isFullMonth =
    period.start.getDate() === 1 &&
    period.end.getDate() === 1 &&
    (period.end.getMonth() + period.end.getFullYear() * 12) -
      (period.start.getMonth() + period.start.getFullYear() * 12) === 1;
  const selectedMonth = period.start.getMonth() + 1; // 1-12
  const selectedMonthIndex = isFullMonth ? period.start.getMonth() : undefined;

  const [
    data, churn, newClients,
    main, yearly, launched,
    openByClient, receivedDetail, expensesDetail, expensesByCategory,
  ] = await Promise.all([
    getExecutiveDashboard(filters),
    getMonthlyChurn(period.start, period.end),
    getNewClientsSummary(period.start, period.end),
    getDashboardMainMetrics(period),
    getYearlySeries(selectedYear),
    isFullMonth ? getResultLaunchedForMonth(selectedYear, selectedMonth) : Promise.resolve(0),
    getOpenByClient(period),
    getReceivedDetail(period),
    getExpensesDetail(period),
    getExpensesByCategory(period),
  ]);
  const {
    kpis, finance, cash, series, health, alerts, actions,
    revenue, renewalOutlook, clients: clientsBlock, upsell, expenses, receipts,
  } = data;

  const hs = HEALTH_STYLE[health.level];
  const renovacoes = renewalOutlook[0];

  // ===== 5 métricas principais (camada central dashboard-main) =====
  // Faturamento total = MRR + TCV + Receita Extra manual (TCV cheio, sem rateio).
  // Recebido = recebimentos da competência + Receita Extra manual recebida.
  // Em aberto = max(0, total − recebido) (= card Em Aberto / Recebimentos).
  // Vencido ⊂ Em aberto. Resultado = Recebido − Despesas. Margem = Resultado/Recebido.
  const M = main.current;
  const previsto = M.faturamentoTotal;
  const recebido = M.recebido;
  const emAberto = M.emAberto;
  const vencido = M.vencido;
  const resultado = M.resultado;
  const margemPct = Math.round(M.margem * 100);
  const disponivelCaixa = Math.max(0, resultado - launched);

  // Comparação textual usa o mês anterior; rótulo do período de comparação.
  const prevMonthLabel = new Date(period.start.getFullYear(), period.start.getMonth() - 1, 1)
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  // Última atualização (horário de Brasília — servidor roda em UTC).
  const lastUpdate = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  }).format(new Date());

  // ===== Indicadores gerenciais do mês (todas as divisões protegidas) =====
  const ticketMedio = getMonthlyAverageTicket(recebido, clientsBlock.pagosMes);
  const custoPorCliente = getMonthlyCostPerClient(finance.despesas, clientsBlock.ativos);
  const folhaPct = Math.round(
    getPayrollPercentageOfRevenue(finance.folhaPeriodo, recebido) * 100
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Visão geral do financeiro da B2C Gestão · ${period.label}`}
      />

      <div className="mb-3 print:hidden flex items-center justify-between gap-3 flex-wrap">
        <SavedViews module="dashboard" />
        <p className="text-[11px] text-muted-foreground">Dados atualizados em {lastUpdate}</p>
      </div>

      {/* Único filtro do Dashboard: mês (lista suspensa) ou intervalo livre */}
      <Card className="mb-5">
        <CardContent className="p-4">
          <MonthFilter />
        </CardContent>
      </Card>

      {/* ===== Cards principais — Faturamento · Despesas · Recebido · Em Aberto · Resultado ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Visão financeira · {period.label}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <MetricCard
          title="Faturamento total"
          value={formatBRL(previsto)}
          help="Soma do faturamento MRR previsto, TCV previsto e receitas extras manuais do mês selecionado."
          delta={main.deltas.faturamentoTotal}
          detailTitle="Faturamento total do mês"
          detail={<FaturamentoDetail mrr={M.mrr} tcv={M.tcv} extra={M.extraManual}
            total={M.faturamentoTotal} mrrClients={M.mrrClients} tcvClients={M.tcvClients} />}
        />
        <MetricCard
          title="Total de despesas"
          value={formatBRL(finance.despesas)}
          help="Soma de todas as despesas registradas no mês, incluindo folha, ferramentas, impostos e custos operacionais."
          delta={main.deltas.despesas}
          goodWhenUp={false}
          valueTone={finance.despesas > 0 ? "neg" : "default"}
          detailTitle="Total de despesas do mês"
          detail={<DespesasDetail categories={expensesByCategory} items={expensesDetail} total={finance.despesas} />}
        />
        <MetricCard
          title="Faturamento recebido"
          value={formatBRL(recebido)}
          help="Total de valores efetivamente registrados como recebidos no mês selecionado."
          delta={main.deltas.recebido}
          valueTone="pos"
          detailTitle="Faturamento recebido do mês"
          detail={<RecebidoDetail items={receivedDetail} mrrReceived={M.mrrRecebido}
            tcvReceived={M.tcvRecebido} total={recebido} />}
        />
        <MetricCard
          title="Em aberto"
          value={formatBRL(emAberto)}
          help="Valor que ainda falta receber no mês. Fórmula: Faturamento total − Faturamento recebido. Vencido é apenas a parte já vencida."
          delta={main.deltas.emAberto}
          goodWhenUp={false}
          detailTitle="Em aberto no mês"
          detail={<EmAbertoDetail clients={openByClient} emAberto={emAberto} vencido={vencido} />}
        />
        <MetricCard
          title="Resultado do mês"
          value={formatBRL(resultado)}
          help="Lucro ou prejuízo operacional do mês. Fórmula: Faturamento recebido − Total de despesas."
          delta={main.deltas.resultado}
          valueTone={resultado > 0 ? "pos" : resultado < 0 ? "neg" : "default"}
          detailTitle="Resultado do mês"
          detail={<ResultadoDetail recebido={recebido} despesas={finance.despesas}
            resultado={resultado} margem={M.margem} disponivel={disponivelCaixa} />}
          footer={
            isFullMonth && resultado > 0 ? (
              <LaunchToCash year={selectedYear} month={selectedMonth}
                resultado={resultado} alreadyLaunched={launched} />
            ) : undefined
          }
        />
      </div>

      {/* ===== Gráficos principais — Faturamento · Despesas · Resultado (ano) ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Evolução em {selectedYear}
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <MainChart title="Faturamento"
          data={yearly.labels.map((l, i) => ({ label: l, value: yearly.faturamento[i] }))}
          color="hsl(var(--primary))" selectedIndex={selectedMonthIndex} />
        <MainChart title="Despesas"
          data={yearly.labels.map((l, i) => ({ label: l, value: yearly.despesas[i] }))}
          color="hsl(var(--warning))" selectedIndex={selectedMonthIndex} />
        <MainChart title="Resultado mensal" variant="bar" diverging
          data={yearly.labels.map((l, i) => ({ label: l, value: yearly.resultado[i] }))}
          selectedIndex={selectedMonthIndex} />
      </div>

      {/* ===== Bloco 2 — Indicadores gerenciais do mês (compactos) ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Indicadores gerenciais do mês
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-6">
        <MiniStat label="Resultado do mês" value={formatBRL(resultado)}
          tone={resultado >= 0 ? "pos" : "neg"} hint="recebido − despesas" />
        <MiniStat label="Faturamento MRR (mês)" value={formatBRL(revenue.mrr)}
          hint={`${revenue.mrrClients} cliente(s) MRR ativo(s)`} />
        <MiniStat label="Faturamento TCV (mês)" value={formatBRL(revenue.tcv)}
          hint="valor cheio dos TCV do mês, sem rateio" />
        <MiniStat label="Ticket médio (mês)"
          value={clientsBlock.pagosMes > 0 ? formatBRL(ticketMedio) : "—"}
          hint={`${clientsBlock.pagosMes} cliente(s) pago(s)`} />
        <MiniStat label="Custo por cliente"
          value={clientsBlock.ativos > 0 ? formatBRL(custoPorCliente) : "—"}
          hint={`${clientsBlock.ativos} ativo(s)`} />
        <MiniStat label="% Folha no faturamento" value={`${folhaPct}%`}
          tone={folhaPct > 40 ? "neg" : folhaPct > 25 ? "warn" : "pos"}
          hint="folha / recebido" />
        <MiniStat label="Churn de clientes (mês)" value={String(churn.count)}
          tone={churn.count > 0 ? "neg" : "pos"} />
        <MiniStat label="Receita perdida (mês)" value={formatBRL(churn.value)}
          tone={churn.value > 0 ? "neg" : "default"} />
        <MiniStat label="Novos clientes (mês)" value={String(newClients.count)}
          tone={newClients.count > 0 ? "pos" : "default"} />
        <MiniStat label="Receita de novos clientes" value={formatBRL(newClients.revenue)}
          tone={newClients.revenue > 0 ? "pos" : "default"} />
        <MiniStat label="Total inadimplência" value={formatBRL(vencido)}
          tone={vencido > 0 ? "neg" : "pos"} hint="vencido e não pago no mês" />
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

      {/* ===== Análises visuais ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Análises visuais · {period.label}
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <ChartCard title="Receita por modalidade" hint="recebido no período">
          <HBarList
            colorClass="bg-primary"
            items={[
              { label: "MRR (recorrente)", value: receipts.mrrReceived },
              { label: "TCV (contrato fechado)", value: receipts.tcvReceived },
            ]}
          />
        </ChartCard>
        <ChartCard title="Evolução financeira mensal" hint="últimos 12 meses">
          <GroupedBarChart
            labels={series.labels}
            series={[
              { name: "Receitas", colorClass: "bg-primary", values: series.receitas },
              { name: "Despesas", colorClass: "bg-rose-400", values: series.despesas },
            ]}
          />
        </ChartCard>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <ChartCard title="Recebimento do mês" hint="recebido · em aberto · vencido">
          <HBarList
            colorClass="bg-primary"
            items={[
              { label: "Recebido", value: recebido },
              { label: "Em aberto (no prazo)", value: Math.max(0, emAberto - vencido) },
              { label: "Vencido", value: vencido },
            ]}
          />
        </ChartCard>
        <ChartCard title="Novos clientes × churn" hint="quantidade no período">
          <HBarList
            colorClass="bg-primary"
            format={(v: number) => String(Math.round(v))}
            items={[
              { label: "Novos clientes", value: newClients.count },
              { label: "Perdidos (churn)", value: churn.count },
            ]}
          />
        </ChartCard>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Receita perdida × novos clientes" hint="valor no período">
          <HBarList
            colorClass="bg-primary"
            items={[
              { label: "Receita de novos clientes", value: newClients.revenue },
              { label: "Receita perdida (churn)", value: churn.value },
            ]}
          />
        </ChartCard>
        <ChartCard title="% Folha no faturamento" hint="ideal: até 40% · últimos 12 meses">
          <LineChart
            labels={series.labels}
            values={series.folhaPct}
            stroke="hsl(var(--primary))"
            format={(v) => `${Math.round(v)}%`}
          />
        </ChartCard>
      </div>
    </div>
  );
}

/** Card compacto dos indicadores gerenciais (menor que o StatCard principal). */
function MiniStat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "pos" | "neg" | "warn";
}) {
  const color =
    tone === "pos"
      ? "text-success"
      : tone === "neg"
        ? "text-destructive"
        : tone === "warn"
          ? "text-warning"
          : "text-foreground";
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium truncate" title={label}>
        {label}
      </p>
      <p className={`text-base font-semibold tabular-nums mt-0.5 ${color}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground truncate" title={hint}>{hint}</p>}
    </div>
  );
}
