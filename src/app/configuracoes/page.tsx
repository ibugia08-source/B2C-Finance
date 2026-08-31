import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/metric-card";
import { prisma } from "@/lib/prisma";
import { AppearanceCard } from "./appearance-card";
import { CategoryDialog } from "./category-dialog";
import { CategoriesList, type CategoryRow } from "./categories-list";
import { requirePagePermission } from "@/lib/auth/viewer";
import { SetupCard } from "./setup-card";
import { estadoDoSetup } from "@/lib/services/setup";

export default async function ConfiguracoesPage() {
  await requirePagePermission("configuracoes.visualizar");
  const [categories, usageByCat] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { categoryId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const usageMap = new Map<string, number>();
  for (const u of usageByCat) {
    if (u.categoryId) usageMap.set(u.categoryId, u._count._all);
  }

  const rows: CategoryRow[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    color: c.color,
    usage: usageMap.get(c.id) ?? 0,
  }));

  const setup = await estadoDoSetup();
  const despesa = rows.filter((c) => c.kind === "despesa").length;
  const receita = rows.filter((c) => c.kind === "receita").length;
  const mista = rows.filter((c) => c.kind === "mista").length;

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Aparência do sistema e categorias de classificação."
        actions={<CategoryDialog />}
      />

      <SetupCard encerrado={setup.encerrado} feitos={setup.feitos} total={setup.total} />

      <AppearanceCard />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard title="Categorias" value={String(rows.length)} />
        <StatCard title="Despesa" value={String(despesa)} />
        <StatCard title="Receita" value={String(receita)} />
        <StatCard title="Mista" value={String(mista)} />
      </div>

      <CategoriesList categories={rows} />
    </div>
  );
}
