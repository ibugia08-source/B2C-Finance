/**
 * INÍCIO LIMPO — o sistema nasce vazio, mas não nasce quebrado (F1.21).
 *
 * DECISÃO 19.32 (31/08): não há migração do v1. Os dados que existem hoje são
 * fictícios e a versão nova começa do zero. Este script é o que executa isso.
 *
 * A DIFERENÇA para o `wipe-data.ts` que já existia, e ela é o ponto inteiro:
 * aquele apaga TUDO menos usuários — inclusive o workspace, as agências, o
 * plano de contas, as regras de lançamento e o dicionário de métricas. Um
 * sistema assim não está zerado, está QUEBRADO: o primeiro pagamento falha
 * porque a regra não acha a conta contábil, e a Dashboard estoura porque não
 * há workspace.
 *
 * Aqui a separação é explícita: ESTRUTURA fica, MOVIMENTO vai.
 *
 * Uso (03 §4.6 — ambiente explícito + ALLOW_DESTRUCTIVE):
 *   APP_ENV=local ALLOW_DESTRUCTIVE=true npx tsx scripts/inicio-limpo.ts
 *   ... e só apaga de verdade com --confirmar.
 */
import { loadEnv } from "./env";
import { assertDestructiveAllowed } from "./guard";
import { writeFileSync } from "fs";
loadEnv();

/**
 * ESTRUTURA — o que faz o sistema funcionar, e não é dado de operação.
 * Apagar qualquer uma destas produz um sistema que parece vazio e está
 * quebrado.
 */
const ESTRUTURA = new Set([
  "_prisma_migrations",
  // Quem entra e o que cada um pode
  "User",
  "UserPermission",
  // Organização
  "Workspace",
  "LegalEntity",
  "Agency",
  "EconomicGroup",
  // Motor contábil e de métricas
  "AccountingAccount",
  "PostingRule",
  "MetricDefinition",
  "FeatureFlag",
  // Configuração que o dono montou e não quer remontar
  "Category",
  "CategorizationRule",
  "ContractTemplate",
]);

async function main() {
  assertDestructiveAllowed({
    script: "scripts/inicio-limpo.ts",
    allowEnvs: ["local", "staging"],
  });
  const confirmar = process.argv.includes("--confirmar");

  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");

  await runWithoutScope(async () => {
    const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const nomes = tables.map((t) => t.tablename);
    const apagar = nomes.filter((t) => !ESTRUTURA.has(t));
    const manter = nomes.filter((t) => ESTRUTURA.has(t));

    // Contagem ANTES, para o relatório dizer o que sumiu.
    const contar = async (t: string) => {
      const r: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      return Number(r[0]?.n ?? 0);
    };
    const antes: Record<string, number> = {};
    for (const t of nomes) antes[t] = await contar(t);

    const totalApagar = apagar.reduce((s, t) => s + antes[t], 0);
    const totalManter = manter.reduce((s, t) => s + antes[t], 0);

    console.log(`\nESTRUTURA que FICA — ${manter.length} tabelas, ${totalManter} registros:`);
    for (const t of manter.filter((t) => antes[t] > 0)) {
      console.log(`   ${t.padEnd(24)} ${antes[t]}`);
    }
    console.log(`\nMOVIMENTO que SAI — ${apagar.length} tabelas, ${totalApagar} registros:`);
    for (const t of apagar.filter((t) => antes[t] > 0)) {
      console.log(`   ${t.padEnd(24)} ${antes[t]}`);
    }

    if (!confirmar) {
      console.log(
        `\nEnsaio. Nada foi apagado.\nPara valer: acrescente --confirmar (irreversível; o backup é gerado antes).`
      );
      return;
    }

    // Backup ANTES de tocar em qualquer coisa. Fora do repositório.
    console.log("\nGerando backup…");
    const backup: Record<string, unknown> = {};
    for (const t of nomes) {
      if (t === "_prisma_migrations") continue;
      const rows: any = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(json_agg(x), '[]'::json) AS data FROM "${t}" x`
      );
      backup[t] = rows[0]?.data ?? [];
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const path = `/Users/macbook/Desktop/B2C-FINANCE/backup-inicio-limpo-${stamp}.json`;
    writeFileSync(path, JSON.stringify(backup, null, 1));
    console.log(`Backup salvo: ${path}`);

    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${apagar.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
    );

    // CONFERÊNCIA NOS DOIS SENTIDOS. Só verificar que o movimento sumiu deixa
    // passar o caso ruim: o CASCADE levar junto uma tabela de estrutura.
    let sobrou = 0;
    for (const t of apagar) sobrou += await contar(t);

    const perdidas: string[] = [];
    for (const t of manter) {
      const agora = await contar(t);
      if (agora !== antes[t]) perdidas.push(`${t}: ${antes[t]} → ${agora}`);
    }

    console.log(`\nMovimento restante: ${sobrou} (esperado 0)`);
    if (perdidas.length) {
      console.error(`\nESTRUTURA PERDIDA NO CASCADE — restaure o backup:`);
      for (const p of perdidas) console.error(`   ${p}`);
      process.exitCode = 1;
      return;
    }
    console.log("Estrutura intacta.");

    // O que o dono vê ao abrir: o checklist de primeiros passos.
    const { estadoDoSetup } = await import("@/lib/services/setup");
    const e = await estadoDoSetup();
    console.log(`\nPrimeiros passos: ${e.feitos}/${e.total} · faltam ${e.minutosRestantes} min`);
    for (const p of e.passos) {
      console.log(`   ${p.numero}. ${p.titulo.padEnd(24)} ${p.feito ? "pronto" : "pendente"}`);
    }
  });

  await (await import("@/lib/prisma")).prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
