import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { RuleDialog } from "./rule-dialog";
import { RulesList } from "./rules-list";
import { getViewer } from "@/lib/auth/viewer";

export default async function RegrasPage() {
  await getViewer();
  const [rules, categories, cards] = await Promise.all([
    prisma.categorizationRule.findMany({
      orderBy: { priority: "asc" },
      include: { category: true },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.creditCard.findMany({ orderBy: { name: "asc" } }),
  ]);

  const ativas = rules.filter((r) => r.active).length;

  return (
    <div>
      <PageHeader
        title="Regras de categorização"
        description="Aplicadas automaticamente em novas transações e importações."
        actions={<RuleDialog categories={categories} cards={cards} />}
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard title="Regras" value={String(rules.length)} />
        <StatCard title="Ativas" value={String(ativas)} intent="positive" />
        <StatCard title="Inativas" value={String(rules.length - ativas)} />
      </div>

      <RulesList rules={rules} categories={categories} cards={cards} />
    </div>
  );
}
