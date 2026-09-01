import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/metric-card";
import { prisma } from "@/lib/prisma";
import { RuleDialog } from "./rule-dialog";
import { RulesList } from "./rules-list";
import { RegrasDeRateio, type RegraDeRateio } from "./allocation-rules";
import { requirePagePermission, can } from "@/lib/auth/viewer";

/**
 * REGRAS DE CATEGORIA E RATEIO (02 §47 nomeia a página com as duas).
 *
 * As duas famílias moram juntas porque respondem à mesma pergunta em
 * momentos diferentes do mesmo lançamento: a de categoria diz O QUE É o
 * gasto; a de rateio diz DE QUEM ELE É. Separá-las em duas páginas faria
 * quem cadastra a campanha nova ter de lembrar de dois lugares.
 */
export default async function RegrasPage() {
  const viewer = await requirePagePermission("regras.visualizar");
  const podeRatear = can(viewer, "rateios.visualizar");

  const [rules, categories, cards, regrasRateio, clientes, agencias, servicos] =
    await Promise.all([
      prisma.categorizationRule.findMany({
        orderBy: { priority: "asc" },
        include: { category: true },
      }),
      prisma.category.findMany({ orderBy: { name: "asc" } }),
      prisma.creditCard.findMany({ orderBy: { name: "asc" } }),
      podeRatear
        ? prisma.allocationRule.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }] })
        : Promise.resolve([]),
      podeRatear
        ? prisma.client.findMany({
            where: { status: { not: "LEAD" } },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      podeRatear
        ? prisma.agency.findMany({
            where: { active: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      podeRatear
        ? prisma.service.findMany({
            where: { active: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

  const ativas = rules.filter((r) => r.active).length;

  return (
    <div>
      <PageHeader
        title="Regras de categoria e rateio"
        description="Aplicadas automaticamente em novas transações e importações."
        actions={<RuleDialog categories={categories} cards={cards} />}
      />

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard title="Regras" value={String(rules.length)} />
        <StatCard title="Ativas" value={String(ativas)} intent="positive" />
        <StatCard title="Inativas" value={String(rules.length - ativas)} />
      </div>

      <RulesList rules={rules} categories={categories} cards={cards} />

      {podeRatear ? (
        <RegrasDeRateio
          regras={regrasRateio as unknown as RegraDeRateio[]}
          categorias={categories.map((c) => ({ id: c.id, name: c.name }))}
          clientes={clientes}
          agencias={agencias}
          servicos={servicos}
          podeEditar={can(viewer, "rateios.editar")}
        />
      ) : null}
    </div>
  );
}
