import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { formatBRL, monthRange, monthLabel } from "@/lib/format";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { getPeriodRevenue } from "@/lib/services/revenue-metrics";
import { getExpenseSummary } from "@/lib/services/expense-metrics";
import { getUpsellKpis } from "@/lib/services/upsell-metrics";
import { getCashSummary, getFinanceSummary } from "@/lib/services/finance-metrics";
import { getAnnualPanel } from "@/lib/services/annual-panel";
import { resolvePeriod } from "@/lib/period";
import type { Baseline } from "@/lib/financial/projections";
import { ProjectionSimulator } from "./simulator";
import { AnnualTable } from "./annual-table";
import { MetaAnual } from "./meta-anual";

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * PAINEL ANUAL — a planilha 2 do dono no sistema: indicadores × JAN..DEZ +
 * acumulado + meta anual. O simulador de cenários (antiga página Projeções)
 * vira a seção final. Fontes: getAnnualPanel (que consome getYearlySeries,
 * a mesma série do Dashboard) — nenhuma definição nova de faturamento.
 */
export default async function PainelAnualPage({
  searchParams,
}: {
  searchParams: { ano?: string };
}) {
  const viewer = await requirePagePermission("projecoes.visualizar");
  const canEditMeta = can(viewer, "configuracoes.editar");

  const now = new Date();
  const anoParam = parseInt(searchParams.ano ?? "", 10);
  const year =
    Number.isInteger(anoParam) && anoParam >= 2000 && anoParam <= 2100
      ? anoParam
      : now.getFullYear();

  // ===== FASE 1 — painel anual (cacheado) + meta do ano =====
  const panel = await getAnnualPanel(year);
  const targetRow = await prisma.annualTarget.findFirst({ where: { year } });

  const upto = panel.lastMonthWithData;
  const achieved =
    upto < 0 ? 0 : panel.recebido.slice(0, upto + 1).reduce((s, v) => s + v, 0);
  const monthsLeft =
    year > now.getFullYear() ? 12 : year < now.getFullYear() ? 0 : 12 - (now.getMonth() + 1);

  // ===== FASE 2 — baseline do simulador (mesma lógica da antiga Projeções) =====
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
        title="Painel Anual"
        description={`B2C Gestão ${year} — indicadores mês a mês, acumulado e meta anual`}
        actions={
          <div className="inline-flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-9 w-9" asChild>
              <Link href={`/projecoes?ano=${year - 1}`} aria-label="Ano anterior">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span className="flex h-9 items-center rounded-md border bg-background px-3 text-sm font-semibold tabular-nums">
              {year}
            </span>
            <Button variant="outline" size="icon" className="h-9 w-9" asChild>
              <Link href={`/projecoes?ano=${year + 1}`} aria-label="Próximo ano">
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
            {year !== now.getFullYear() && (
              <Button variant="ghost" size="sm" className="h-9" asChild>
                <Link href="/projecoes">Ano atual</Link>
              </Button>
            )}
          </div>
        }
      />

      {/* 🎯 META ANUAL */}
      <MetaAnual
        year={year}
        target={targetRow ? Number(targetRow.revenueTarget) : null}
        achieved={achieved}
        monthsLeft={monthsLeft}
        canEdit={canEditMeta}
      />

      {/* Painel indicador × meses */}
      <AnnualTable panel={panel} />
      <p className="mt-2 mb-8 text-xs text-muted-foreground">
        Mesmos números do Dashboard (fonte única de cálculo). Recebido conta a
        competência do mês; pagamentos de meses anteriores entram como
        recuperação em Outras Entradas no mês em que caíram.
      </p>

      {/* ===== Simulador de cenários (a antiga página Projeções) ===== */}
      <section id="simulador" className="scroll-mt-20">
        <div className="mb-2">
          <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">
            Simulador de Cenários
          </h2>
          <p className="text-xs text-muted-foreground">
            Base real: {monthLabel()} — simule clientes, ticket, despesas e
            recuperação
          </p>
        </div>

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
      </section>
    </div>
  );
}
