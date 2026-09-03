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

/**
 * Semeadura de REFERÊNCIA do dicionário de métricas.
 *
 * É create-only e idempotente: nunca apaga nem sobrescreve dado de negócio,
 * só garante que a configuração canônica exista. Por isso roda em qualquer
 * ambiente — inclusive no deploy de produção, onde é obrigatória: sem ela o
 * sistema sobe sem dicionário de métricas e as telas que dependem dele ficam vazias.
 * A guarda de ambiente continua no uso MANUAL, logo abaixo.
 */
export async function semear() {
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

}

async function main() {
  assertDestructiveAllowed({ script: "prisma/seed-metric-registry.ts" });
  await semear();
  const { prisma: db } = await import("@/lib/prisma");
  await db.$disconnect();
}

// Executa só quando chamado direto na linha de comando; importado pelo
// bootstrap, o módulo apenas expõe `semear()`.
if ((process.argv[1] ?? "").endsWith("seed-metric-registry.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
