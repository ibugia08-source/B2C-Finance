import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { PeriodFilter } from "@/components/period-filter";
import { resolvePeriod } from "@/lib/period";
import {
  getFinanceSummary,
  getCashSummary,
  getBalanceSummary,
} from "@/lib/services/finance-metrics";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import { formatBRL } from "@/lib/format";

type Search = { periodo?: string; de?: string; ate?: string };

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireAdmin();
  await markOverdueBillings();

  const period = resolvePeriod(searchParams);
  const [fin, cash, balance] = await Promise.all([
    getFinanceSummary(period),
    getCashSummary(period),
    getBalanceSummary(),
  ]);

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div>
      <PageHeader
        title="Financeiro"
        description={`Visão operacional consolidada — ${period.label.toLowerCase()}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild><Link href="/receitas">Receitas</Link></Button>
            <Button variant="outline" asChild><Link href="/despesas">Despesas</Link></Button>
            <Button variant="outline" asChild><Link href="/folha">Folha</Link></Button>
            <Button variant="outline" asChild><Link href="/ativos">Patrimônio</Link></Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <PeriodFilter />
        </CardContent>
      </Card>

      {/* Resultado do período */}
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Resultado — {period.label.toLowerCase()}
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Receitas" value={formatBRL(fin.receitas)} intent="positive" />
        <StatCard title="Despesas" value={formatBRL(fin.despesas)} intent="negative"
          hint={`pagas: ${formatBRL(fin.despesasPagas)}`} />
        <StatCard
          title="Lucro / prejuízo"
          value={formatBRL(fin.lucro)}
          intent={fin.lucro >= 0 ? "positive" : "negative"}
          hint="receitas − despesas pagas"
        />
        <StatCard
          title="Margem operacional"
          value={pct(fin.margem)}
          intent={fin.margem >= 0.2 ? "positive" : fin.margem >= 0 ? "warning" : "negative"}
        />
        <StatCard title="Despesas fixas" value={formatBRL(fin.despesasFixas)} />
        <StatCard title="Despesas variáveis" value={formatBRL(fin.despesasVariaveis)} />
        <StatCard title="Folha (competência)" value={formatBRL(fin.folhaPeriodo)} />
        <StatCard
          title="Folha / receita"
          value={pct(fin.folhaSobreReceita)}
          intent={fin.folhaSobreReceita > 0.4 ? "negative" : "default"}
        />
      </div>

      {/* Caixa */}
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Caixa
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Caixa disponível" value={formatBRL(cash.caixaDisponivel)}
          hint={`contas ${formatBRL(cash.contasBancarias)} · reservas ${formatBRL(cash.reservas)}`} />
        <StatCard title="Entradas no período" value={formatBRL(cash.entradasPeriodo)} intent="positive" />
        <StatCard title="Saídas no período" value={formatBRL(cash.saidasPeriodo)} intent="negative" />
        <StatCard
          title="Saldo realizado"
          value={formatBRL(cash.saldoRealizado)}
          intent={cash.saldoRealizado >= 0 ? "positive" : "negative"}
        />
        <StatCard title="Saldo previsto" value={formatBRL(cash.saldoPrevisto)}
          hint="caixa + a receber − a pagar" />
        <StatCard title="Projeção 30 dias" value={formatBRL(cash.projecao30)}
          intent={cash.projecao30 >= 0 ? "default" : "negative"} />
        <StatCard title="Projeção 60 dias" value={formatBRL(cash.projecao60)}
          intent={cash.projecao60 >= 0 ? "default" : "negative"} />
        <StatCard title="Projeção 90 dias" value={formatBRL(cash.projecao90)}
          intent={cash.projecao90 >= 0 ? "default" : "negative"} />
      </div>

      {/* Patrimônio */}
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Patrimônio
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <StatCard title="Ativos totais" value={formatBRL(balance.ativosTotais)} intent="positive"
          hint={`a receber ${formatBRL(balance.aReceber)}`} />
        <StatCard title="Passivos totais" value={formatBRL(balance.passivosTotais)} intent="negative"
          hint={`a pagar ${formatBRL(balance.contasAPagar)}`} />
        <StatCard
          title="Saldo patrimonial"
          value={formatBRL(balance.saldoPatrimonial)}
          intent={balance.saldoPatrimonial >= 0 ? "positive" : "negative"}
          hint="ativos − passivos"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Projeções consideram: caixa disponível + cobranças abertas a vencer no
        horizonte − despesas pendentes − parcelas mensais de passivos. A folha
        entra nas despesas quando marcada como paga (em /folha).
      </p>
    </div>
  );
}
