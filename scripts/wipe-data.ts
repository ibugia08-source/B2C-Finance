/**
 * LIMPEZA TOTAL DOS DADOS (mantém apenas usuários).
 *
 * 1. Faz backup JSON de TODAS as tabelas em ~/Desktop/B2C-FINANCE/
 *    (fora do repositório) antes de qualquer exclusão.
 * 2. TRUNCATE ... CASCADE em todas as tabelas do schema public,
 *    EXCETO "User" e "_prisma_migrations".
 * 3. Confere: todas zeradas e usuários preservados.
 *
 * Uso: npx tsx scripts/wipe-data.ts --confirmar
 */
import { loadEnv } from "./env";
import { writeFileSync } from "fs";
loadEnv();

const KEEP = new Set(["User", "_prisma_migrations"]);

async function main() {
  if (!process.argv.includes("--confirmar")) {
    console.error("Passe --confirmar para executar a limpeza (irreversível).");
    process.exit(1);
  }
  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");

  await runWithoutScope(async () => {
    const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const toWipe = tables.map((t) => t.tablename).filter((t) => !KEEP.has(t));

    // ===== 1) Backup completo (inclui User, por segurança) =====
    console.log("Gerando backup JSON…");
    const backup: Record<string, unknown> = {};
    for (const t of tables.map((x) => x.tablename)) {
      if (t === "_prisma_migrations") continue;
      const rows: any = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(json_agg(x), '[]'::json) AS data FROM "${t}" x`
      );
      backup[t] = rows[0]?.data ?? [];
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const path = `/Users/macbook/Desktop/B2C-FINANCE/backup-pre-limpeza-${stamp}.json`;
    writeFileSync(path, JSON.stringify(backup, null, 1));
    const totalRows = Object.values(backup).reduce(
      (s: number, v: any) => s + (Array.isArray(v) ? v.length : 0),
      0
    );
    console.log(`Backup salvo: ${path} (${totalRows} registros em ${Object.keys(backup).length} tabelas)`);

    // ===== 2) Limpeza =====
    console.log(`\nLimpando ${toWipe.length} tabelas (mantendo: ${[...KEEP].join(", ")})…`);
    const list = toWipe.map((t) => `"${t}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

    // ===== 3) Verificação =====
    let remaining = 0;
    for (const t of toWipe) {
      const r: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${t}"`);
      if (r[0].c > 0) {
        remaining += r[0].c;
        console.error(`  ✗ ${t} ainda tem ${r[0].c} registros`);
      }
    }
    const users: any = await prisma.$queryRawUnsafe(
      `SELECT email, role FROM "User" ORDER BY email`
    );
    console.log(`\nTabelas de dados zeradas: ${remaining === 0 ? "SIM ✓" : "NÃO — verificar acima"}`);
    console.log(`Usuários preservados (${users.length}):`);
    for (const u of users) console.log(`  · ${u.email} (${u.role})`);
  });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
