import Link from "next/link";
import { SavedViews } from "@/components/saved-views";
import { PageHeader } from "@/components/page-header";
import { SetupChecklist } from "@/components/setup-checklist";
import { mostrarSetup } from "@/lib/services/setup";
import { formatBRL } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import {
  getExecutiveDashboard,
  type DashboardFilters as Filters,
  type DashAlert,
} from "@/lib/services/dashboard-metrics";
import {
  getMonthlyChurn,
  getNewClientsSummary,
} from "@/lib/financial/calculations";
import { computePeriodMetrics } from "@/lib/metrics/engine";
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
import { MainChart, CompositionDonut, CombinedChart } from "@/components/dashboard/charts-lazy";
import { MetricCard, SecondaryStat } from "@/components/metric-card";
import { getLiquidez } from "@/lib/services/liquidity";
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
  ChevronDown,
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

/** Razão 0-1 do motor → inteiro em % para a interface; null continua null. */
const pct = (v: number | null) => (v == null ? null : Math.round(v * 100));

// Cor por token semântico (F1.13): "info" é o azul-ciano reservado a
// estado neutro-informativo, distinto do acento da marca.
const HEALTH_STYLE: Record<string, { badge: any; bar: string }> = {
  excelente: { badge: "success", bar: "bg-success" },
  saudavel: { badge: "success", bar: "bg-success" },
  estavel: { badge: "secondary", bar: "bg-info" },
  atencao: { badge: "warning", bar: "bg-warning" },
  critica: { badge: "destructive", bar: "bg-danger" },
};

const SEVERITY_DOT: Record<DashAlert["severity"], string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-info",
};

async function DashboardPageInner({ searchParams }: { searchParams?: Search }) {
  const viewer = await requirePagePermission("dashboard.visualizar", "/dashboard");

  // Sem permissão de ver os números financeiros (resultado, margem, caixa):
  // recepção simples com atalho para o Assistente. Papéis GESTOR/FINANCEIRO
  // têm dashboard.ver_financeiro por padrão e veem o dashboard completo.
  if (!can(viewer, "dashboard.ver_financeiro")) {
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
  // Sexto card do painel executivo (02 §5.1). A regra de reservas
  // restritas é da DECISÃO 19.34 / F3.11 — aqui a conta é aberta.
  const liquidez = await getLiquidez(new Date().toISOString());
  const {
    finance, health, alerts,
    clients: clientsBlock, upsell,
  } = data;

  const hs = HEALTH_STYLE[health.level];

  // ===== 5 métricas principais (camada central dashboard-main) =====
  // Faturamento total = MRR + TCV + Receita Extra manual (TCV cheio, sem rateio).
  // Recebido = totalRevenue (mesma conta do "Recebido no mês" da Gestão do
  // Mês): competência + recuperações recebidas no mês + extras/avulsas.
  // Em aberto = max(0, total − (recebido − recuperado)) — base de competência.
  // Vencido ⊂ Em aberto. Resultado = Recebido − Despesas. Margem = Resultado/Recebido.
  const M = main.current;
  const previsto = M.faturamentoTotal;
  const recebido = M.recebido;
  const emAberto = M.emAberto;
  const vencido = M.vencido;
  const resultado = M.resultado;
  const disponivelCaixa = Math.max(0, resultado - launched);

  // Comparação textual usa o mês anterior; rótulo do período de comparação.
  // Sparkline de 12 meses em cada card (02 §5.1: "cada um com sparkline 12m").
  // "Em aberto" não tem série própria: é esperado − recebido DA COMPETÊNCIA,
  // mês a mês (recuperação entra no recebido mas não abate o aberto do mês).
  const sparkEmAberto = yearly.faturamento.map((v, i) =>
    Math.max(0, v - (yearly.recebido[i] - yearly.recuperado[i]))
  );

  // Última atualização (horário de Brasília — servidor roda em UTC).
  const lastUpdate = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  }).format(new Date());

  // ===== Indicadores gerenciais do mês =====
  // Vêm do MOTOR DE MÉTRICAS por chave (01 §7; 03 §4.1): a tela não recalcula
  // fórmula nem trata divisão por zero na mão — a política de nulo é do
  // contrato da métrica, e null vira "—" na interface.
  const metrics = await computePeriodMetrics(period);
  const pctRealizacao = metrics.percentual_realizacao.value;
  const ticketMedioGeral = metrics.ticket_medio.value;
  const custoPorCliente = metrics.custo_por_cliente.value;
  const folhaPct = pct(metrics.percentual_folha.value);
  const recorrenciaPct = pct(metrics.percentual_recorrencia.value);

  // Comparativos secundários (vs mês anterior) para o grupo Receita.
  const prevHas = main.previousHasData;
  const mrrDelta = getPreviousMonthComparison(M.mrr, main.previous.mrr, prevHas);
  const tcvDelta = getPreviousMonthComparison(M.tcv, main.previous.tcv, prevHas);

  // Resumo inteligente determinístico (sem IA) do mês filtrado.
  const summary = buildDashboardSummary({
    previsto, recebido, emAberto, vencido,
    despesas: finance.despesas, resultado, margem: M.margem,
    folhaPct: folhaPct ?? 0, recorrenciaPct: recorrenciaPct ?? 0,
  });

  // Saudação pessoal (horário de Brasília — o servidor roda em UTC).
  const hourSP = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo",
    }).format(new Date())
  );
  // Segunda-feira no fuso de Brasília — o servidor roda em UTC.
  const ehSegunda =
    new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Sao_Paulo" })
      .format(new Date()) === "Mon";
  const setup = await mostrarSetup();
  const saudacao = hourSP < 12 ? "Bom dia" : hourSP < 18 ? "Boa tarde" : "Boa noite";
  const firstName = (viewer.name ?? "").trim().split(/\s+/)[0] ?? "";

  return (
    <div>
      <PageHeader
        title={firstName ? `${saudacao}, ${firstName}` : saudacao}
        description={`O essencial do mês — números oficiais, alertas e tendência · ${period.label}`}
      />

      {/* Primeiro uso (02 §3): a lista fica na home ATÉ o sistema estar
          configurado, e some sozinha quando os cinco passos estiverem
          feitos — sem exigir mais um clique de quem acabou de fazer cinco.
          Virou caminho crítico com a decisão 19.32: o sistema entra em
          produção vazio, e esta é a porta de entrada dos dados. */}
      {setup ? <SetupChecklist estado={setup} /> : null}

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

      {/* ===== PAINEL EXECUTIVO — DECIDIR (02 §5.1) =====
          Seis cards, cada um com sparkline de 12 meses e clique abrindo o
          detalhe no contexto. Em fileiras de TRÊS: o §7.2 proíbe fileiras
          de 4 ou 5, e antes daqui eram cinco cards em cinco colunas. */}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Decidir · {period.label}
        </h2>
        {/* 02 §5.1: "Cabeçalho explicita o modo temporal". O painel mistura
            as duas bases de propósito, então cada card declara a sua. */}
        <p className="text-caption text-muted-foreground">
          Base temporal indicada em cada card — <strong className="font-medium text-foreground">Competência</strong> é o
          que foi reconhecido no mês; <strong className="font-medium text-foreground">Caixa</strong> é o que entrou ou saiu.
        </p>
      </div>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Faturamento total"
          value={formatBRL(previsto)}
          basis="competencia"
          sparkline={yearly.faturamento}
          help="Soma do faturamento MRR previsto, TCV previsto e receitas extras manuais do mês selecionado."
          delta={main.deltas.faturamentoTotal}
          detailTitle="Faturamento total do mês"
          detail={<FaturamentoDetail mrr={M.mrr} tcv={M.tcv} extra={M.extraManual}
            total={M.faturamentoTotal} mrrClients={M.mrrClients} tcvClients={M.tcvClients} />}
        />
        <MetricCard
          title="Total de despesas"
          value={formatBRL(finance.despesas)}
          basis="competencia"
          sparkline={yearly.despesas}
          help="Soma de todas as despesas registradas no mês, incluindo folha, ferramentas, impostos e custos operacionais."
          delta={main.deltas.despesas}
          goodWhenUp={false}
          tone={finance.despesas > 0 ? "neg" : "default"}
          detailTitle="Total de despesas do mês"
          detail={<DespesasDetail categories={expensesByCategory} items={expensesDetail} total={finance.despesas} />}
        />
        <MetricCard
          title="Recebido em caixa"
          value={formatBRL(recebido)}
          basis="caixa"
          sparkline={yearly.recebido}
          help="Dinheiro efetivamente recebido no mês selecionado: cobranças da competência, recuperações de meses anteriores recebidas agora e receitas extras/avulsas. É a mesma conta do Recebido no mês da Gestão do Mês."
          delta={main.deltas.recebido}
          tone="pos"
          detailTitle="Recebido em caixa no mês"
          detail={<RecebidoDetail items={receivedDetail} mrrReceived={M.mrrRecebido}
            tcvReceived={M.tcvRecebido} recuperado={M.recuperado}
            extras={M.extraManual} total={recebido} />}
        />
        <MetricCard
          title="Em aberto"
          value={formatBRL(emAberto)}
          basis="competencia"
          sparkline={sparkEmAberto}
          hint={vencido > 0 ? `${formatBRL(vencido)} já vencido` : "Nada vencido"}
          help="Valor que ainda falta receber no mês. Fórmula: Faturamento total − Recebido em caixa. Vencido é apenas a parte já vencida — está embutido aqui, não é outro número."
          delta={main.deltas.emAberto}
          goodWhenUp={false}
          tone={vencido > 0 ? "warn" : "default"}
          detailTitle="Em aberto no mês"
          detail={<EmAbertoDetail clients={openByClient} emAberto={emAberto} vencido={vencido} />}
        />
        <MetricCard
          title="Resultado do mês"
          value={formatBRL(resultado)}
          basis="caixa"
          sparkline={yearly.resultado}
          help="Lucro ou prejuízo operacional do mês. Fórmula: Recebido em caixa − Total de despesas."
          delta={main.deltas.resultado}
          tone={resultado > 0 ? "pos" : resultado < 0 ? "neg" : "default"}
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
        <MetricCard
          title="Liquidez disponível"
          value={formatBRL(liquidez.disponivel)}
          basis="caixa"
          hint={
            liquidez.reservado > 0
              ? `${formatBRL(liquidez.reservado)} reservados · projeção 30d: ${formatBRL(liquidez.projecao30d)}`
              : `Projeção 30 dias: ${formatBRL(liquidez.projecao30d)}`
          }
          help="Contas e reservas de hoje, MENOS as reservas restritas (impostos e 13º por padrão) — aquele dinheiro tem dono e data, e mostrá-lo como disponível é o que faz alguém aprovar uma despesa contra o imposto do mês seguinte. A projeção de 30 dias acrescenta as cobranças que vencem no período e subtrai as contas a pagar do mesmo prazo."
          tone={liquidez.projecao30d < 0 ? "neg" : liquidez.disponivel > 0 ? "pos" : "default"}
          detailTitle="Liquidez disponível e projeção de 30 dias"
          detail={
            <div className="space-y-3">
              <NamedValueList
                items={liquidez.itens.map((i) => ({
                  name: i.label,
                  value: i.value,
                  sub: i.restrita
                    ? "reserva restrita — fora do disponível"
                    : i.tipo === "conta"
                      ? "conta"
                      : "reserva",
                }))}
                total={liquidez.disponivel}
                totalLabel="Disponível hoje"
                emptyText="Nenhuma conta ou reserva cadastrada — o saldo precisa vir do extrato."
              />
              <div className="space-y-1 border-t pt-3 text-body">
                <p className="flex justify-between">
                  <span className="text-muted-foreground">A receber em 30 dias</span>
                  <span className="stat-number text-success">+ {formatBRL(liquidez.entradas30d)}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-muted-foreground">A pagar em 30 dias</span>
                  <span className="stat-number text-destructive">− {formatBRL(liquidez.saidas30d)}</span>
                </p>
                <p className="flex justify-between border-t pt-1 font-medium">
                  <span>Projeção em 30 dias</span>
                  <span className="stat-number">{formatBRL(liquidez.projecao30d)}</span>
                </p>
              </div>
            </div>
          }
        />
      </div>

      {/* ===== PAINEL EXECUTIVO — AGIR (02 §5.1): "Atenção hoje" ===== */}
      {alerts.length > 0 && (
        <div className="mb-3">
          <div className="rounded-card border border-warning/30 bg-warning-soft/50 p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5 mb-2">
              <AlertTriangle className="h-3.5 w-3.5" /> Atenção hoje
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

      {/* ===== Resumo determinístico + Saúde financeira =====
          02 §5.1: "Resumo determinístico colapsável (aberto por padrão só
          segunda-feira)" — na segunda a semana começa e vale ler; nos
          outros dias ele fica recolhido para não empurrar os números. */}
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <details open={ehSegunda} className="group">
            <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-primary">
                <Sparkles className="h-3.5 w-3.5" /> Resumo do mês
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-base group-open:rotate-180" />
            </summary>
            <div className="space-y-1.5 px-5 pb-5 text-body leading-relaxed">
              {summary.map((s, i) => (
                <p key={`summary-${i}`} className={i === 0 ? "text-foreground" : "text-muted-foreground"}>{s}</p>
              ))}
            </div>
          </details>
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

      {/* ===== PAINEL EXECUTIVO — ENTENDER (02 §5.1) =====
          Exatamente TRÊS gráficos, os três que a spec nomeia. O teto de
          §5.5 é 3 por home; antes desta tarefa a página tinha seis, e os
          outros três desceram para "Análises complementares". */}
      <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Entender · {selectedYear}
      </h2>
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <CombinedChart
          title="Esperado × Recebido × Despesas"
          question="O que foi previsto entrou em caixa — e as saídas acompanharam?"
          labels={yearly.labels}
          selectedIndex={selectedMonthIndex}
          series={[
            { label: "Esperado", values: yearly.faturamento, color: "hsl(var(--chart-1))" },
            { label: "Recebido em caixa", values: yearly.recebido, color: "hsl(var(--chart-3))", dash: "6 3" },
            { label: "Despesas", values: yearly.despesas, color: "hsl(var(--chart-2))", dash: "2 3" },
          ]}
        />
        <MainChart title="Resultado mensal" variant="bar" diverging
          data={yearly.labels.map((l, i) => ({ label: l, value: yearly.resultado[i] }))}
          selectedIndex={selectedMonthIndex} />
        <ChartCard title="De onde vem o faturamento?" hint={`MRR · TCV · Receita extra — ${period.label}`}>
          <CompositionDonut
            data={[
              { label: "MRR", value: M.mrr, color: "hsl(var(--chart-1))" },
              { label: "TCV", value: M.tcv, color: "hsl(var(--chart-6))" },
              { label: "Receita Extra", value: M.extraManual, color: "hsl(var(--chart-4))" },
            ]}
          />
        </ChartCard>
      </div>

      {/* ===== PAINEL EXECUTIVO — SECUNDÁRIOS VISÍVEIS (02 §5.1) =====
          Exatamente os OITO que a spec nomeia, nesta ordem. Inadimplência
          e Margem NÃO entram: "nunca repetir (já estão nos cards)" — o
          vencido está embutido no card Em aberto e a margem, no detalhe do
          Resultado. Antes desta tarefa os dois apareciam de novo aqui, o
          que é exatamente o "mesmo número com dois rótulos" que §5.5
          proíbe. */}
      <h2 className="mb-3 text-caption font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Indicadores do mês
      </h2>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SecondaryStat label="MRR" value={formatBRL(M.mrr)}
          help="Soma dos valores mensais dos clientes MRR ativos no mês."
          delta={mrrDelta}
          detailTitle="Clientes MRR do mês"
          detail={<NamedValueList items={mrrClientsDetail} total={M.mrr} totalLabel="Total MRR" valueSuffix="/mês" emptyText="Nenhum cliente MRR ativo." />} />
        <SecondaryStat label="TCV faturado" value={formatBRL(M.tcv)}
          help="Soma dos contratos TCV com fechamento, entrada ou renovação no mês. É o TCV FATURADO — não o vendido, e não é rateado."
          delta={tcvDelta}
          detailTitle="Clientes TCV do mês"
          detail={<NamedValueList items={tcvClientsDetail} total={M.tcv} totalLabel="Total TCV" emptyText="Nenhum TCV no mês." />} />
        <SecondaryStat label="% Recorrência" value={recorrenciaPct == null ? "—" : `${recorrenciaPct}%`}
          help={metrics.percentual_recorrencia.spec.formulaDescription}
          tone={recorrenciaPct == null ? "default" : recorrenciaPct >= 60 ? "pos" : recorrenciaPct >= 40 ? "warn" : "neg"} />
        <SecondaryStat label="Clientes ativos" value={String(clientsBlock.ativos)}
          help="Quantidade total de clientes ativos no mês selecionado." />
        <SecondaryStat label="Novos clientes" value={String(newClients.count)}
          help="Clientes que entraram no mês (por data de entrada; fallback: data de cadastro)."
          tone={newClients.count > 0 ? "pos" : "default"}
          hint={newClients.revenue > 0 ? `${formatBRL(newClients.revenue)} de receita nova` : undefined}
          detailTitle="Novos clientes do mês"
          detail={<NamedValueList items={newClientsDetail} total={newClients.revenue} totalLabel="Receita nova" emptyText="Nenhum novo cliente no mês." />} />
        <SecondaryStat label="Churn (mês)" value={String(churn.count)}
          help="Clientes perdidos no mês."
          tone={churn.count > 0 ? "neg" : "pos"}
          hint={churn.value > 0 ? `${formatBRL(churn.value)} de receita perdida` : undefined} />
        <SecondaryStat label="Ticket médio"
          value={ticketMedioGeral == null ? "—" : formatBRL(ticketMedioGeral)}
          help={metrics.ticket_medio.spec.formulaDescription}
          hint={`${clientsBlock.ativos} ativo(s)`} />
        <SecondaryStat label="% Folha no faturamento" value={folhaPct == null ? "—" : `${folhaPct}%`}
          help={metrics.percentual_folha.spec.formulaDescription}
          tone={folhaPct == null ? "default" : folhaPct > 40 ? "neg" : folhaPct > 25 ? "warn" : "pos"} />
      </div>

      {/* ===== Todos os indicadores (recolhido por padrão) =====
          Reconstrução 29/08: a página aberta mostra só o essencial — os 5
          números oficiais, alertas, saúde e evolução. Os 16 indicadores
          gerenciais + composições moram aqui, a um clique, sem gritar. */}
      <details className="group rounded-xl border bg-card">
        <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-medium">
            Todos os indicadores do mês
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              receita · clientes · eficiência · composição
            </span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div className="border-t px-5 pt-5 pb-5">
          {/* Complementares: o que não cabe nos 8 visíveis do §5.1. */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SecondaryStat label="% Realização"
              value={pctRealizacao == null ? "—" : `${Math.round(pctRealizacao * 100)}%`}
              help={metrics.percentual_realizacao.spec.formulaDescription}
              tone={pctRealizacao == null ? "default" : pctRealizacao >= 0.9 ? "pos" : pctRealizacao >= 0.6 ? "default" : "neg"} />
            <SecondaryStat label="Receita de novos clientes" value={formatBRL(newClients.revenue)}
              help="Receita dos clientes que entraram no mês (MRR = valor mensal; TCV = valor total do contrato)."
              tone={newClients.revenue > 0 ? "pos" : "default"}
              detailTitle="Novos clientes do mês"
              detail={<NamedValueList items={newClientsDetail} total={newClients.revenue} totalLabel="Receita nova" emptyText="Nenhum novo cliente no mês." />} />
            <SecondaryStat label="Renovações do mês" value={String(renewalClientsDetail.length)}
              help="Clientes cujo mês de renovação é o mês selecionado."
              tone={renewalClientsDetail.length > 0 ? "warn" : "default"}
              detailTitle="Renovações do mês"
              detail={<NamedValueList items={renewalClientsDetail} emptyText="Nenhuma renovação neste mês." />} />
            <SecondaryStat label="Clientes em aberto" value={String(clientsBlock.devendoMes)}
              help="Clientes ativos ainda sem pagamento registrado no mês."
              tone={clientsBlock.devendoMes > 0 ? "neg" : "pos"} />
            <SecondaryStat label="Custo por cliente"
              value={custoPorCliente == null ? "—" : formatBRL(custoPorCliente)}
              help={metrics.custo_por_cliente.spec.formulaDescription}
              hint={`${clientsBlock.ativos} ativo(s)`} />
            <SecondaryStat label="Upsell em aberto" value={formatBRL(upsell.openValue)}
              help="Valor das oportunidades de upsell em aberto."
              hint={`${upsell.openCount} oportunidade(s)`} />
          </div>

          {/* ===== Análises complementares ===== */}
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
            Análises complementares · {period.label}
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
      </details>
    </div>
  );
}

// T7 — o p95 desta tela é medido contra o orçamento de 03 §4.7.
export default async function DashboardPage(
  ...args: Parameters<typeof DashboardPageInner>
) {
  const { medir } = await import("@/lib/observability");
  return medir("page:dashboard", () => DashboardPageInner(...args));
}
