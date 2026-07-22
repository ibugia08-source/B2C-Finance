import Link from "next/link";
import { SavedViews } from "@/components/saved-views";
import { PageHeader } from "@/components/page-header";
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
  getMonthlyCostPerClient,
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
  getMrrClientsDetail,
  getTcvClientsDetail,
  getNewClientsDetail,
  getRenewalClientsDetail,
  getPreviousMonthComparison,
  buildDashboardSummary,
} from "@/lib/services/dashboard-main";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartCard, HBarList } from "@/components/charts";
import { MainChart, CompositionDonut } from "@/components/dashboard/charts-lazy";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SecondaryStat } from "@/components/dashboard/secondary-stat";
import { LaunchToCash } from "@/components/dashboard/launch-to-cash";
import {
  FaturamentoDetail, DespesasDetail, RecebidoDetail, EmAbertoDetail, ResultadoDetail,
  NamedValueList,
} from "./detail-panels";
import { MonthFilter } from "./month-filter";
import { PersonalDashboard } from "./personal-dashboard";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sparkles,
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

  // IMPORTANTE (produção): o Prisma na Vercel tem pool pequeno (connection
  // limit ~5). Cada agregador abre VÁRIAS queries em paralelo internamente;
  // rodar TODOS num único Promise.all satura o pool e estoura o pool_timeout
  // (erro "Timed out fetching a new connection"). Por isso buscamos em FASES
  // sequenciais — nunca dois agregadores pesados ao mesmo tempo.
  const data = await getExecutiveDashboard(filters);
  const main = await getDashboardMainMetrics(period);
  const [yearly, churn, newClients, launched] = await Promise.all([
    getYearlySeries(selectedYear),
    getMonthlyChurn(period.start, period.end),
    getNewClientsSummary(period.start, period.end),
    isFullMonth ? getResultLaunchedForMonth(selectedYear, selectedMonth) : Promise.resolve(0),
  ]);
  // Detalhes dos cards (queries leves) — um lote só, depois dos pesados.
  const [
    openByClient, receivedDetail, expensesDetail, expensesByCategory,
    mrrClientsDetail, tcvClientsDetail, newClientsDetail, renewalClientsDetail,
  ] = await Promise.all([
    getOpenByClient(period),
    getReceivedDetail(period),
    getExpensesDetail(period),
    getExpensesByCategory(period),
    getMrrClientsDetail(),
    getTcvClientsDetail(period),
    getNewClientsDetail(period),
    getRenewalClientsDetail(selectedMonth),
  ]);
  const {
    finance, health, alerts,
    clients: clientsBlock, upsell,
  } = data;

  const hs = HEALTH_STYLE[health.level];

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
  // Ticket médio geral = Faturamento total / clientes ativos (§2). Custo por
  // cliente = Despesas / ativos. % Folha = Folha / Faturamento total. % Recorrência
  // = MRR / Faturamento total. Todas com guarda de divisão por zero.
  const ticketMedioGeral = clientsBlock.ativos > 0 ? previsto / clientsBlock.ativos : 0;
  const custoPorCliente = getMonthlyCostPerClient(finance.despesas, clientsBlock.ativos);
  const folhaPct = previsto > 0 ? Math.round((finance.folhaPeriodo / previsto) * 100) : 0;
  const recorrenciaPct = previsto > 0 ? Math.round((M.mrr / previsto) * 100) : 0;

  // Comparativos secundários (vs mês anterior) para o grupo Receita.
  const prevHas = main.previousHasData;
  const mrrDelta = getPreviousMonthComparison(M.mrr, main.previous.mrr, prevHas);
  const tcvDelta = getPreviousMonthComparison(M.tcv, main.previous.tcv, prevHas);

  // Resumo inteligente determinístico (sem IA) do mês filtrado.
  const summary = buildDashboardSummary({
    previsto, recebido, emAberto, vencido,
    despesas: finance.despesas, resultado, margem: M.margem,
    folhaPct, recorrenciaPct,
  });

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

      {/* ===== Alertas discretos ===== */}
      {alerts.length > 0 && (
        <div className="mb-6">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5 mb-2">
              <AlertTriangle className="h-3.5 w-3.5" /> Atenção
            </p>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {alerts.map((a, i) => (
                <li key={`alert-${i}`}>
                  <Link href={a.href} className="group flex items-start gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${SEVERITY_DOT[a.severity]}`} />
                    <span className="min-w-0 text-sm">
                      <span className="font-medium group-hover:underline">{a.title}</span>
                      <span className="text-muted-foreground"> — {a.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ===== Resumo inteligente do mês + Saúde financeira ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-primary font-medium flex items-center gap-1.5 mb-3">
              <Sparkles className="h-3.5 w-3.5" /> Resumo inteligente do mês
            </p>
            <div className="space-y-1.5 text-sm leading-relaxed">
              {summary.map((s, i) => (
                <p key={`summary-${i}`} className={i === 0 ? "text-foreground" : "text-muted-foreground"}>{s}</p>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
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
              {health.fatores.slice(0, 4).map((fator, i) => (
                <li key={`health-${i}`} className="flex items-start gap-2 text-xs">
                  {fator.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                  )}
                  <span className={fator.ok ? "text-muted-foreground" : "text-foreground"}>
                    {fator.text}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ===== Indicadores gerenciais agrupados ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Indicadores gerenciais
      </h2>

      {/* Grupo: Receita */}
      <p className="text-xs font-medium text-foreground mb-2">Receita</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <SecondaryStat label="Faturamento MRR" value={formatBRL(M.mrr)}
          help="Soma dos valores mensais dos clientes MRR ativos no mês."
          delta={mrrDelta}
          detailTitle="Clientes MRR do mês"
          detail={<NamedValueList items={mrrClientsDetail} total={M.mrr} totalLabel="Total MRR" valueSuffix="/mês" emptyText="Nenhum cliente MRR ativo." />} />
        <SecondaryStat label="Faturamento TCV" value={formatBRL(M.tcv)}
          help="Soma dos contratos TCV com fechamento, entrada ou renovação no mês. Não é rateado."
          delta={tcvDelta}
          detailTitle="Clientes TCV do mês"
          detail={<NamedValueList items={tcvClientsDetail} total={M.tcv} totalLabel="Total TCV" emptyText="Nenhum TCV no mês." />} />
        <SecondaryStat label="Receita de novos clientes" value={formatBRL(newClients.revenue)}
          help="Receita dos clientes que entraram no mês (MRR = valor mensal; TCV = valor total do contrato)."
          tone={newClients.revenue > 0 ? "pos" : "default"}
          detailTitle="Novos clientes do mês"
          detail={<NamedValueList items={newClientsDetail} total={newClients.revenue} totalLabel="Receita nova" emptyText="Nenhum novo cliente no mês." />} />
        <SecondaryStat label="Ticket médio geral"
          value={clientsBlock.ativos > 0 ? formatBRL(ticketMedioGeral) : "—"}
          help="Faturamento total dividido pela quantidade de clientes ativos no mês."
          hint={`${clientsBlock.ativos} ativo(s)`} />
        <SecondaryStat label="% Recorrência" value={`${recorrenciaPct}%`}
          help="Percentual do faturamento que vem de MRR (MRR / Faturamento total). Mede a previsibilidade da receita."
          tone={recorrenciaPct >= 60 ? "pos" : recorrenciaPct >= 40 ? "warn" : "neg"} />
      </div>

      {/* Grupo: Clientes */}
      <p className="text-xs font-medium text-foreground mb-2">Clientes</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <SecondaryStat label="Clientes ativos" value={String(clientsBlock.ativos)}
          help="Quantidade total de clientes ativos no mês selecionado." />
        <SecondaryStat label="Novos clientes" value={String(newClients.count)}
          help="Clientes que entraram no mês (por data de entrada; fallback: data de cadastro)."
          tone={newClients.count > 0 ? "pos" : "default"}
          detailTitle="Novos clientes do mês"
          detail={<NamedValueList items={newClientsDetail} total={newClients.revenue} totalLabel="Receita nova" emptyText="Nenhum novo cliente no mês." />} />
        <SecondaryStat label="Renovações do mês" value={String(renewalClientsDetail.length)}
          help="Clientes cujo mês de renovação é o mês selecionado."
          tone={renewalClientsDetail.length > 0 ? "warn" : "default"}
          detailTitle="Renovações do mês"
          detail={<NamedValueList items={renewalClientsDetail} emptyText="Nenhuma renovação neste mês." />} />
        <SecondaryStat label="Churn (mês)" value={String(churn.count)}
          help="Clientes perdidos no mês."
          tone={churn.count > 0 ? "neg" : "pos"}
          hint={churn.value > 0 ? `${formatBRL(churn.value)} de receita perdida` : undefined} />
        <SecondaryStat label="Clientes em aberto" value={String(clientsBlock.devendoMes)}
          help="Clientes ativos ainda sem pagamento registrado no mês."
          tone={clientsBlock.devendoMes > 0 ? "neg" : "pos"} />
      </div>

      {/* Grupo: Eficiência */}
      <p className="text-xs font-medium text-foreground mb-2">Eficiência</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <SecondaryStat label="Custo por cliente"
          value={clientsBlock.ativos > 0 ? formatBRL(custoPorCliente) : "—"}
          help="Total de despesas dividido pela quantidade de clientes ativos no mês."
          hint={`${clientsBlock.ativos} ativo(s)`} />
        <SecondaryStat label="% Folha no faturamento" value={`${folhaPct}%`}
          help="Quanto a folha representa sobre o faturamento total do mês."
          tone={folhaPct > 40 ? "neg" : folhaPct > 25 ? "warn" : "pos"} />
        <SecondaryStat label="Margem operacional" value={`${margemPct}%`}
          help="Resultado do mês dividido pelo faturamento recebido."
          tone={margemPct >= 20 ? "pos" : margemPct >= 0 ? "warn" : "neg"} />
        <SecondaryStat label="Inadimplência (vencido)" value={formatBRL(vencido)}
          help="Parte do em aberto do mês que já passou da data de vencimento."
          tone={vencido > 0 ? "neg" : "pos"} />
        <SecondaryStat label="Upsell em aberto" value={formatBRL(upsell.openValue)}
          help="Valor das oportunidades de upsell em aberto."
          hint={`${upsell.openCount} oportunidade(s)`} />
      </div>

      {/* ===== Análises complementares ===== */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Análises complementares · {period.label}
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Composição do faturamento" hint="MRR · TCV · Receita Extra">
          <CompositionDonut
            data={[
              { label: "MRR", value: M.mrr, color: "hsl(var(--primary))" },
              { label: "TCV", value: M.tcv, color: "hsl(262 60% 58%)" },
              { label: "Receita Extra", value: M.extraManual, color: "hsl(var(--muted-foreground))" },
            ]}
          />
        </ChartCard>
        <ChartCard title="Despesas por categoria" hint="no período">
          <HBarList colorClass="bg-primary" items={expensesByCategory.slice(0, 6)} />
        </ChartCard>
        <ChartCard title="Novos clientes × renovações" hint="quantidade no mês">
          <HBarList
            colorClass="bg-primary"
            format={(v: number) => String(Math.round(v))}
            emptyText="Sem movimento de clientes no mês."
            items={[
              { label: "Novos clientes", value: newClients.count },
              { label: "Renovações", value: renewalClientsDetail.length },
            ]}
          />
        </ChartCard>
      </div>
    </div>
  );
}
