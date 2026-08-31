/**
 * SEED DO REGISTRY DE MÉTRICAS (F0.7 — ref. 01 §7).
 *
 * Grava no banco o contrato de cada métrica declarado em
 * src/lib/metrics/registry.ts. Idempotente por (workspace, chave, versão):
 * rodar de novo atualiza a versão 1; MUDAR uma fórmula exige criar a versão 2
 * no arquivo, nunca reescrever a 1 (é isso que preserva o passado).
 *
 * Uso: APP_ENV=local ALLOW_DESTRUCTIVE=true npx tsx prisma/seed-metric-registry.ts
 */
import { loadEnv } from "../scripts/env";
import { assertDestructiveAllowed } from "../scripts/guard";
import { METRIC_REGISTRY, METRIC_REGISTRY_VERSION } from "../src/lib/metrics/registry";

loadEnv();

async function main() {
  assertDestructiveAllowed({ script: "prisma/seed-metric-registry.ts" });

  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");

  await runWithoutScope(async () => {
    const workspace = await prisma.workspace.findFirst({ select: { id: true, name: true } });
    if (!workspace) throw new Error("Nenhum Workspace — rode as migrations antes.");

    let criadas = 0;
    let atualizadas = 0;
    for (const m of METRIC_REGISTRY) {
      const dados = {
        name: m.name,
        description: m.description,
        formulaDescription: m.formulaDescription,
        grain: m.grain as any,
        dateBasis: m.dateBasis as any,
        sourceEntities: m.sourceEntities,
        filters: m.filters ?? null,
        rounding: m.rounding ?? "half-up 2 casas",
        nullPolicy: m.nullPolicy ?? "denominador zero → null (exibe —)",
      };
      const existente = await prisma.metricDefinition.findFirst({
        where: { workspaceId: workspace.id, key: m.key, version: METRIC_REGISTRY_VERSION },
        select: { id: true },
      });
      if (existente) {
        await prisma.metricDefinition.update({ where: { id: existente.id }, data: dados });
        atualizadas++;
      } else {
        await prisma.metricDefinition.create({
          data: {
            ...dados,
            workspaceId: workspace.id,
            key: m.key,
            version: METRIC_REGISTRY_VERSION,
          },
        });
        criadas++;
      }
    }

    const total = await prisma.metricDefinition.count({ where: { workspaceId: workspace.id } });
    console.log(
      `→ métricas v${METRIC_REGISTRY_VERSION}: ${criadas} criada(s), ${atualizadas} atualizada(s) · ${total} no registry`
    );

    const porBase = await prisma.metricDefinition.groupBy({
      by: ["dateBasis"],
      where: { workspaceId: workspace.id },
      _count: { _all: true },
    });
    for (const b of porBase) console.log(`   ${b.dateBasis}: ${b._count._all}`);
  });

  const { prisma: db } = await import("@/lib/prisma");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
