import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { GoalDialog } from "./goal-dialog";
import { GoalsGrid, type GoalRow } from "./goals-grid";
import { getViewer } from "@/lib/auth/viewer";

export default async function MetasPage() {
  await getViewer();
  const goals = await prisma.goal.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
  });

  const rows: GoalRow[] = goals.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    priority: g.priority,
    targetAmount: g.targetAmount,
    currentAmount: g.currentAmount,
    deadline: g.deadline ? g.deadline.toISOString() : null,
    notes: g.notes,
  }));

  const totalAlvo = rows.reduce((s, g) => s + g.targetAmount, 0);
  const totalAcumulado = rows.reduce((s, g) => s + g.currentAmount, 0);
  const concluidas = rows.filter(
    (g) => g.targetAmount > 0 && g.currentAmount >= g.targetAmount
  ).length;
  const pctGeral = totalAlvo > 0 ? (totalAcumulado / totalAlvo) * 100 : 0;

  return (
    <div>
      <PageHeader
        title="Metas financeiras"
        description="Acompanhe o progresso dos seus objetivos."
        actions={<GoalDialog />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Metas" value={String(rows.length)} />
        <StatCard title="Acumulado" value={formatBRL(totalAcumulado)} intent="positive" />
        <StatCard title="Alvo total" value={formatBRL(totalAlvo)} />
        <StatCard
          title="Concluídas"
          value={`${concluidas}/${rows.length}`}
          hint={`${pctGeral.toFixed(0)}% do alvo total`}
          intent="positive"
        />
      </div>

      <GoalsGrid goals={rows} />
    </div>
  );
}
