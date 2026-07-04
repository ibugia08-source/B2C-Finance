/**
 * DIAGNÓSTICO (somente leitura) dos dados contaminados por importações antigas.
 *
 * Uso:  npm run db:diagnose
 * Requer POSTGRES_PRISMA_URL no ambiente ou em .env na raiz do projeto.
 *
 * Não altera NADA no banco — apenas imprime um relatório.
 */
import { loadEnv } from "./env";
loadEnv();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== B2C Finance — diagnóstico de dados importados ===\n");

  // 1. Parcelas "fantasma": Installments criadas por importação de fatura
  //    (comportamento antigo — valor dividido de novo e projeção de meses futuros).
  const importedInstallments = await prisma.installment.findMany({
    where: { transaction: { importBatchId: { not: null } } },
    select: {
      id: true,
      amount: true,
      total: true,
      dueDate: true,
      transactionId: true,
      transaction: { select: { description: true, amount: true, cardId: true } },
    },
  });
  const affectedTx = new Set(importedInstallments.map((i) => i.transactionId));
  const sumGhost = importedInstallments.reduce((s, i) => s + i.amount, 0);
  console.log(`1) Parcelas fantasma (Installment de transações importadas):`);
  console.log(`   registros: ${importedInstallments.length}`);
  console.log(`   transações afetadas: ${affectedTx.size}`);
  console.log(`   soma projetada (valores incorretos ÷N): R$ ${sumGhost.toFixed(2)}\n`);

  // 2. Fragmentação: lotes de importação cujas transações caíram em MAIS de
  //    uma fatura (efeito do re-bucketing antigo por closingDay).
  const batches = await prisma.importBatch.findMany({
    where: { cardId: { not: null } },
    select: { id: true, fileName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const fragmented: { file: string; invoices: number }[] = [];
  for (const b of batches) {
    const rows = await prisma.transaction.groupBy({
      by: ["invoiceId"],
      where: { importBatchId: b.id },
      _count: { _all: true },
    });
    const invoiceIds = rows.filter((r) => r.invoiceId).map((r) => r.invoiceId);
    if (invoiceIds.length > 1) {
      fragmented.push({
        file: b.fileName ?? b.id,
        invoices: invoiceIds.length,
      });
    }
  }
  console.log(`2) Importações fragmentadas em múltiplas faturas: ${fragmented.length}`);
  for (const f of fragmented) {
    console.log(`   - ${f.file}: espalhada em ${f.invoices} faturas`);
  }
  console.log();

  // 3. Totais de fatura divergentes da soma das transações
  const invoices = await prisma.creditCardInvoice.findMany({
    select: { id: true, referenceMonth: true, referenceYear: true, total: true, cardId: true },
  });
  let mismatches = 0;
  for (const inv of invoices) {
    const byType = await prisma.transaction.groupBy({
      by: ["type"],
      where: { invoiceId: inv.id, status: { not: "cancelado" } },
      _sum: { amount: true },
    });
    let expected = 0;
    for (const t of byType) {
      const sum = t._sum.amount ?? 0;
      expected += t.type === "despesa" ? sum : -sum;
    }
    if (Math.abs(expected - inv.total) > 0.01) {
      mismatches++;
      console.log(
        `   - fatura ${String(inv.referenceMonth).padStart(2, "0")}/${inv.referenceYear} (${inv.id}): total gravado R$ ${inv.total.toFixed(2)} ≠ soma R$ ${expected.toFixed(2)}`
      );
    }
  }
  console.log(`3) Faturas com total divergente: ${mismatches}\n`);

  // 4. Possíveis duplicatas: mesmo cartão + dia + descrição + valor (>1)
  const dupCandidates = await prisma.$queryRaw<
    { cardid: string | null; date: Date; description: string; amount: number; qty: bigint }[]
  >`
    SELECT "cardId" as cardid, date_trunc('day', "date") as date, "description", "amount", count(*) as qty
    FROM "Transaction"
    WHERE "importBatchId" IS NOT NULL
    GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
    ORDER BY qty DESC
    LIMIT 30
  `;
  console.log(`4) Grupos de possíveis duplicatas importadas (top 30):`);
  for (const d of dupCandidates) {
    console.log(
      `   - ${d.qty}× "${d.description}" R$ ${Number(d.amount).toFixed(2)} em ${new Date(d.date).toISOString().slice(0, 10)}`
    );
  }
  if (dupCandidates.length === 0) console.log("   nenhum encontrado");

  console.log(
    "\nPróximo passo sugerido: npm run db:fix-imported  (dry-run)  →  npm run db:fix-imported -- --apply"
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
