/**
 * SEED DA MATRIZ CANÔNICA (F0.8 — ref. 01 §3.10).
 *
 * Grava as 17 regras de lançamento com versão 1. Idempotente por
 * (workspace, evento, versão). MUDAR uma regra exige criar a versão 2 —
 * o razão já postado guarda a versão que usou e não é reescrito.
 *
 * Uso: APP_ENV=local ALLOW_DESTRUCTIVE=true npx tsx prisma/seed-posting-rules.ts
 */
import { loadEnv } from "../scripts/env";
import { assertDestructiveAllowed } from "../scripts/guard";
import { POSTING_RULES, POSTING_RULES_VERSION } from "../src/lib/accounting/posting-rules";

loadEnv();

/**
 * Semeadura de REFERÊNCIA da matriz de eventos contábeis.
 *
 * É create-only e idempotente: nunca apaga nem sobrescreve dado de negócio,
 * só garante que a configuração canônica exista. Por isso roda em qualquer
 * ambiente — inclusive no deploy de produção, onde é obrigatória: sem ela o
 * sistema sobe sem a matriz e o razão não sabe postar nada.
 * A guarda de ambiente continua no uso MANUAL, logo abaixo.
 */
export async function semear() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");

  await runWithoutScope(async () => {
    const workspace = await prisma.workspace.findFirst({ select: { id: true } });
    if (!workspace) throw new Error("Nenhum Workspace — rode as migrations antes.");

    let criadas = 0, atualizadas = 0;
    for (const r of POSTING_RULES) {
      const dados = {
        name: r.name,
        description: r.description,
        debitAccountCode: r.debitAccountCode,
        creditAccountCode: r.creditAccountCode,
        affectsPnl: r.affectsPnl,
        active: true,
      };
      const existente = await prisma.postingRule.findFirst({
        where: { workspaceId: workspace.id, eventType: r.eventType, version: POSTING_RULES_VERSION },
        select: { id: true },
      });
      if (existente) {
        await prisma.postingRule.update({ where: { id: existente.id }, data: dados });
        atualizadas++;
      } else {
        await prisma.postingRule.create({
          data: { ...dados, workspaceId: workspace.id, eventType: r.eventType, version: POSTING_RULES_VERSION },
        });
        criadas++;
      }
    }
    const implementadas = POSTING_RULES.filter((r) => r.implemented).length;
    const naDre = POSTING_RULES.filter((r) => r.affectsPnl).length;
    console.log(`→ regras v${POSTING_RULES_VERSION}: ${criadas} criada(s), ${atualizadas} atualizada(s)`);
    console.log(`   ${implementadas} implementada(s) no motor · ${naDre} afetam a DRE`);

    const flag = await prisma.featureFlag.findFirst({
      where: { workspaceId: workspace.id, key: "ledger_enabled" },
      select: { enabled: true },
    });
    console.log(`   postagem no razão: ${flag?.enabled ? "LIGADA" : "desligada"} (esperado: desligada nesta fase)`);
  });

}

async function main() {
  assertDestructiveAllowed({ script: "prisma/seed-posting-rules.ts" });
  await semear();
  const { prisma: db } = await import("@/lib/prisma");
  await db.$disconnect();
}

// Executa só quando chamado direto na linha de comando; importado pelo
// bootstrap, o módulo apenas expõe `semear()`.
if ((process.argv[1] ?? "").endsWith("seed-posting-rules.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
