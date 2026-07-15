/**
 * Backup pré-reorganização Fase 0
 * Exporta toda a DB em JSON antes de ajustes de schema
 * Uso: npx tsx scripts/backup-pre-fase0.ts
 */
import { loadEnv } from "./env";
loadEnv();
import * as fs from "fs";
import * as path from "path";

async function backup() {
  const { prisma } = await import("@/lib/prisma");

  console.log("🔄 Iniciando backup pré-Fase 0...");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.resolve(
    process.cwd(),
    `../backup-pre-fase0-${timestamp}`
  );

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const tables = [
    "User",
    "Client",
    "Contract",
    "Billing",
    "Payment",
    "ExtraRevenue",
    "CollectionHistory",
    "ClientContact",
    "ClientDocument",
    "ClientNote",
    "ClientLoss",
    "Commission",
    "Upsell",
    "Service",
    "ContractService",
    "Income",
    "Expense",
    "Transaction",
    "CashBox",
    "Account",
    "Payroll",
    "CreditCard",
    "CreditCardInvoice",
    "Offer",
    "OfferService",
    "Person",
  ];

  let totalRecords = 0;

  for (const table of tables) {
    try {
      const data = await (prisma as any)[table.charAt(0).toLowerCase() + table.slice(1)].findMany();
      const filePath = path.join(backupDir, `${table}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`  ✓ ${table}: ${data.length} registros`);
      totalRecords += data.length;
    } catch (e) {
      console.warn(`  ⚠ ${table}: erro (possível tabela não mapeada ou vazia)`);
    }
  }

  console.log(
    `\n✅ Backup completo salvo em: ${backupDir}`
  );
  console.log(`   Total de registros: ${totalRecords}`);
  console.log(
    `\n📝 Restaurar (se necessário):`
  );
  console.log(`   (Contate desenvolvedor para instruções de restore)`);

  process.exit(0);
}

backup().catch((e) => {
  console.error("❌ Erro no backup:", e);
  process.exit(1);
});
