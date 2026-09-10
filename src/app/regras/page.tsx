import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/metric-card";
import { prisma } from "@/lib/prisma";
import { RuleDialog } from "./rule-dialog";
import { RulesList } from "./rules-list";
import { requirePagePermission } from "@/lib/auth/viewer";

/**
 * REGRAS DE CATEGORIA.
 *
 * A página tinha duas famílias — categoria ("o que é o gasto") e rateio ("de
 * quem ele é"). O rateio de mídia saiu em 10/09/2026 e levou a segunda: o
 * vínculo com o cliente passou a ser o campo `clientId` da própria despesa,
 * decidido no lançamento em vez de numa tela de distribuição mensal.
 */
export default async function RegrasPage() {
  await requirePagePermission("regras.visualizar");

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
        title="Regras de categoria"
        description="Aplicadas automaticamente em novas transações e importações."
        actions={<RuleDialog categories={categories} cards={cards} />}
      />

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard title="Regras" value={String(rules.length)} />
        <StatCard title="Ativas" value={String(ativas)} intent="positive" />
        <StatCard title="Inativas" value={String(rules.length - ativas)} />
      </div>

      <RulesList rules={rules} categories={categories} cards={cards} />
    </div>
  );
}
