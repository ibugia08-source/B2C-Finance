import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/metric-card";
import { prisma } from "@/lib/prisma";
import { AppearanceCard } from "./appearance-card";
import { CategoryDialog } from "./category-dialog";
import { CategoriesList, type CategoryRow } from "./categories-list";
import { NicheDialog } from "./niche-dialog";
import { NichesList, type NicheRow } from "./niches-list";
import { requirePagePermission } from "@/lib/auth/viewer";
import { SetupCard } from "./setup-card";
import { DangerCard } from "./danger-card";
import { estadoDoSetup } from "@/lib/services/setup";

export default async function ConfiguracoesPage() {
  const viewer = await requirePagePermission("configuracoes.visualizar");
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

  // Nichos: catálogo da plataforma (24/09/2026). Só o ADMIN altera.
  const [niches, nicheUsage, semNicho] = await Promise.all([
    prisma.niche.findMany({ select: { id: true, name: true } }),
    prisma.client.groupBy({ by: ["nicheId"], where: { nicheId: { not: null } }, _count: { _all: true } }),
    prisma.client.count({ where: { nicheId: null } }),
  ]);
  const nicheUsageMap = new Map(nicheUsage.map((u) => [u.nicheId, u._count._all]));
  const nicheRows: NicheRow[] = niches
    .map((n) => ({ id: n.id, name: n.name, usage: nicheUsageMap.get(n.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const isAdmin = viewer.role === "ADMIN";

  const setup = await estadoDoSetup();
  const despesa = rows.filter((c) => c.kind === "despesa").length;
  const receita = rows.filter((c) => c.kind === "receita").length;
  const mista = rows.filter((c) => c.kind === "mista").length;

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Aparência do sistema, categorias de classificação e nichos de clientes."
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

      <section className="mt-8" aria-labelledby="nichos-titulo">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="nichos-titulo" className="font-display text-lg font-semibold tracking-[-0.01em]">
              Nichos de clientes
            </h2>
            <p className="text-sm text-muted-foreground">
              Categoria da plataforma: cada nicho é cadastrado uma vez
              {isAdmin ? " e você escolhe o nome que vale para todos." : " pelo administrador."}{" "}
              O cadastro do cliente, os filtros e os relatórios usam esta lista.
            </p>
          </div>
          {isAdmin && <NicheDialog />}
        </div>
        <NichesList niches={nicheRows} semNicho={semNicho} isAdmin={isAdmin} />
      </section>

      {/* Zona de risco: limpar o sistema — só o ADMIN vê. */}
      {viewer.role === "ADMIN" && <DangerCard />}
    </div>
  );
}
