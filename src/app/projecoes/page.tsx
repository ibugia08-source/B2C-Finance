import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, monthRange, monthLabel } from "@/lib/format";
import { requirePagePermission } from "@/lib/auth/viewer";
import { getPeriodRevenue } from "@/lib/services/revenue-metrics";
import { getExpenseSummary } from "@/lib/services/expense-metrics";
import { getUpsellKpis } from "@/lib/services/upsell-metrics";
import { getCashSummary, getFinanceSummary } from "@/lib/services/finance-metrics";
import { resolvePeriod } from "@/lib/period";
import type { Baseline } from "@/lib/financial/projections";
import { ProjectionSimulator } from "./simulator";

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Projeções — cenários financeiros REAIS calculados sobre o baseline do mês
 * (camada central de cálculos). O simulador roda ao vivo no cliente com
 * funções puras de lib/financial/projections.
 */
export default async function ProjecoesPage() {
  await requirePagePermission("projecoes.visualizar");

  const { start, end } = monthRange();
  const period = resolvePeriod({ periodo: "mes" });

  const [revenue, expenses, upsell, cash, finance, overdueAgg, tcvClients, payrollAgg] =
    await Promise.all([
      getPeriodRevenue(start, end, {}),
      getExpenseSummary(start),
      getUpsellKpis(start, end),
      getCashSummary(period),
      getFinanceSummary(period),
      prisma.billing.aggregate({
        where: { status: "OVERDUE" },
        _sum: { amount: true, paidTotal: true },
      }),
      prisma.contract.aggregate({
        where: { type: "TCV", status: { not: "CANCELED" } },
        _avg: { totalValue: true },
      }),
      prisma.payrollItem.aggregate({
        where: {
          payroll: {
            month: start.getMonth() + 1,
            year: start.getFullYear(),
            status: { in: ["DRAFT", "APPROVED", "PAID"] },
          },
        },
        _sum: { amount: true },
      }),
    ]);

  const inadimplenciaAberta = Math.max(
    0,
    n(overdueAgg._sum.amount) - n(overdueAgg._sum.paidTotal)
  );
  const folha = n(payrollAgg._sum.amount) || finance.folhaPeriodo;

  const baseline: Baseline = {
    receita: revenue.total,
    mrr: revenue.mrr,
    tcv: revenue.tcv,
    mrrClients: revenue.mrrClients,
    avgTicketMrr: revenue.mrrClients > 0 ? revenue.mrr / revenue.mrrClients : 0,
    avgTicketTcv: n(tcvClients._avg.totalValue),
    despesas: expenses.total,
    despesasRecorrentes: expenses.recurring,
    folha,
    inadimplenciaAberta,
    upsellPipeline: upsell.openValue,
    caixa: cash.caixaDisponivel,
    projecao30: cash.projecao30,
  };

  return (
    <div>
      <PageHeader
        title="Projeções"
        description={`Cenários e metas financeiras · base: ${monthLabel()}`}
      />

      {/* Baseline do mês (números reais que alimentam a simulação) */}
      <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-4 mb-5">
        <StatCard title="Faturamento do mês" value={formatBRL(baseline.receita)}
          hint={`MRR ${formatBRL(baseline.mrr)} + TCV ${formatBRL(baseline.tcv)}`} />
        <StatCard title="Despesas + folha" value={formatBRL(baseline.despesas + baseline.folha)}
          intent="negative" hint={`folha ${formatBRL(baseline.folha)}`} />
        <StatCard title="Inadimplência aberta" value={formatBRL(baseline.inadimplenciaAberta)}
          intent={baseline.inadimplenciaAberta > 0 ? "warning" : "positive"}
          hint="recuperável" />
        <StatCard title="Pipeline de upsell" value={formatBRL(baseline.upsellPipeline)} />
        <StatCard title="Caixa atual" value={formatBRL(baseline.caixa)}
          intent={baseline.caixa >= 0 ? "positive" : "negative"} />
        <StatCard title="Projeção de caixa 30d" value={formatBRL(baseline.projecao30)}
          intent={baseline.projecao30 >= 0 ? "positive" : "negative"} />
      </div>

      <ProjectionSimulator baseline={baseline} />
    </div>
  );
}
