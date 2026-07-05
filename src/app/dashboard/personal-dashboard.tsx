import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { getDashboardSummary } from "@/lib/services/calculations";
import { formatBRL, monthLabel } from "@/lib/format";
import { Card, CardContent } from "@/lib/ui";
import { Badge } from "@/components/ui/badge";
import { DashboardMonthFilter } from "./month-filter";
import { MonthlyBarChart } from "@/components/bar-chart";
import { getMonthlyHistory } from "@/lib/services/history";

/**
 * Visão pessoal (papel USER): finanças do próprio usuário.
 * Admins veem o dashboard executivo da agência (page.tsx).
 */

function pct(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

function endividamentoStatus(taxa: number): {
  label: string;
  intent: "positive" | "warning" | "negative";
} {
  if (taxa <= 0.3) return { label: "Saudável", intent: "positive" };
  if (taxa <= 0.5) return { label: "Atenção", intent: "warning" };
  return { label: "Crítico", intent: "negative" };
}

function parseMonthRef(mes?: string): Date {
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [year, month] = mes.split("-").map(Number);
    return new Date(year, month - 1, 1);
  }
  return new Date();
}

function toMonthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function PersonalDashboard({ mes }: { mes?: string }) {
  const ref = parseMonthRef(mes);
  const [summary, history] = await Promise.all([
    getDashboardSummary(ref),
    getMonthlyHistory(),
  ]);
  const {
    receitas,
    despesas,
    faturas,
    aReceber,
    porPertenceA: { pessoal, empresa, terceiro: terceiros, familiar: familia },
    caixa,
    taxaEndividamento: taxa,
    sobraReal: sobra,
    receitasPrevistas: receitasPrev,
    despesasPrevistas: despesasPrev,
  } = summary;

  const endivStatus = endividamentoStatus(taxa);

  return (
    <div>
      <PageHeader
        title="B2C Finance"
        description={`Sua visão financeira consolidada · ${monthLabel(ref)}`}
        actions={<DashboardMonthFilter current={toMonthValue(ref)} />}
      />

      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        Visão geral
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Receita total do mês" value={formatBRL(receitas)} intent="positive" />
        <StatCard title="Despesas do mês" value={formatBRL(despesas)} intent="negative" />
        <StatCard
          title="Total em faturas"
          value={formatBRL(faturas.openAmount)}
          hint={`Total: ${formatBRL(faturas.total)}`}
        />
        <StatCard title="Total em caixa" value={formatBRL(caixa)} intent="positive" />
        <StatCard
          title="Sobra real do mês"
          value={formatBRL(sobra)}
          intent={sobra >= 0 ? "positive" : "negative"}
          hint="Receitas recebidas − despesas pagas − faturas pagas"
        />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
        Histórico ({history.labels.length} meses)
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
              Receitas por mês
            </p>
            <MonthlyBarChart labels={history.labels} values={history.receitas} tone="income" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
              Despesas por mês
            </p>
            <MonthlyBarChart labels={history.labels} values={history.despesas} tone="expense" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
              Total em caixa por mês
            </p>
            <MonthlyBarChart labels={history.labels} values={history.caixa} tone="cash" />
          </CardContent>
        </Card>
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
        Saúde financeira
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Taxa de endividamento
            </p>
            <p
              className={`text-2xl font-bold mt-1 ${
                endivStatus.intent === "positive"
                  ? "text-emerald-600"
                  : endivStatus.intent === "warning"
                    ? "text-amber-600"
                    : "text-red-600"
              }`}
            >
              {pct(taxa)}
            </p>
            <Badge
              variant={
                endivStatus.intent === "positive"
                  ? "success"
                  : endivStatus.intent === "warning"
                    ? "warning"
                    : "destructive"
              }
              className="mt-2"
            >
              {endivStatus.label}
            </Badge>
            <p className="text-xs text-muted-foreground mt-2">
              Saudável até 30%, crítico acima de 50%
            </p>
          </CardContent>
        </Card>
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
        Previsto
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Previsto a receber"
          value={formatBRL(receitasPrev + aReceber)}
          intent="positive"
        />
        <StatCard
          title="Previsto a pagar"
          value={formatBRL(despesasPrev + faturas.openAmount)}
          intent="negative"
        />
        <StatCard title="Receitas previstas" value={formatBRL(receitasPrev)} />
        <StatCard title="Despesas previstas" value={formatBRL(despesasPrev)} />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
        Por categoria de gasto
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Gastos pessoais" value={formatBRL(pessoal)} />
        <StatCard title="Gastos da empresa" value={formatBRL(empresa)} />
        <StatCard title="Gastos de terceiros" value={formatBRL(terceiros)} />
        <StatCard title="Gastos familiares" value={formatBRL(familia)} />
      </div>
    </div>
  );
}
