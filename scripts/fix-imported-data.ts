/**
 * CORREÇÃO dos dados contaminados por importações antigas.
 *
 * O que faz (nesta ordem):
 *  1. BACKFILL: transações importadas que têm Installments antigas ganham
 *     installmentTotal + installmentGroupKey (metadados novos). O número da
 *     parcela não é recuperável (foi descartado na importação antiga) e fica
 *     nulo — será preenchido naturalmente nas próximas importações.
 *  2. LIMPEZA: apaga as Installments "fantasma" (criadas por importação, com
 *     valores divididos incorretamente e projeções de meses futuros).
 *     Installments de despesas MANUAIS são preservadas.
 *  3. RECÁLCULO: refaz o total de todas as faturas (compras − estornos).
 *
 * Segurança:
 *  - DRY-RUN por padrão: mostra o que faria, sem alterar nada.
 *  - Com --apply: grava um BACKUP JSON em ./backups/ antes de alterar.
 *
 * Uso:
 *   npm run db:fix-imported              (dry-run, só relatório)
 *   npm run db:fix-imported -- --apply   (executa com backup)
 */
import { loadEnv } from "./env";
loadEnv();

import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { installmentGroupKeyFor } from "../src/lib/services/hash";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `=== B2C Finance — correção de dados importados (${APPLY ? "APLICANDO" : "DRY-RUN"}) ===\n`
  );

  // ---------- 1. Backfill de metadados ----------
  const txWithGhosts = await prisma.transaction.findMany({
    where: {
      importBatchId: { not: null },
      installments: { some: {} },
    },
    select: {
      id: true,
      description: true,
      amount: true,
      cardId: true,
      installmentTotal: true,
      installments: { select: { id: true, total: true, amount: true, dueDate: true } },
    },
  });

  const backfills = txWithGhosts
    .filter((t) => t.installmentTotal == null)
    .map((t) => {
      const total = t.installments[0]?.total ?? null;
      return {
        id: t.id,
        installmentTotal: total,
        installmentGroupKey:
          total && total > 1
            ? installmentGroupKeyFor({
                cardId: t.cardId,
                description: t.description,
                amount: t.amount,
                installmentTotal: total,
              })
            : null,
      };
    })
    .filter((b) => b.installmentTotal && b.installmentTotal > 1);

  console.log(`1) Backfill de metadados de parcela: ${backfills.length} transações`);

  // ---------- 2. Parcelas fantasma a remover ----------
  const ghosts = await prisma.installment.findMany({
    where: { transaction: { importBatchId: { not: null } } },
  });
  console.log(`2) Installments fantasma a remover: ${ghosts.length}`);

  // ---------- 3. Faturas a recalcular ----------
  const invoices = await prisma.creditCardInvoice.findMany({
    select: { id: true, referenceMonth: true, referenceYear: true, total: true },
  });
  console.log(`3) Faturas a recalcular: ${invoices.length}\n`);

  if (!APPLY) {
    console.log("DRY-RUN: nada foi alterado. Rode com `-- --apply` para executar.");
    return;
  }

  // ---------- Backup ----------
  const backupDir = resolve(process.cwd(), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = resolve(backupDir, `fix-imported-${stamp}.json`);
  writeFileSync(
    backupFile,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        deletedInstallments: ghosts,
        backfilledTransactions: backfills,
        invoiceTotalsBefore: invoices,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`Backup gravado em: ${backupFile}\n`);

  // ---------- Aplicação ----------
  let done = 0;
  for (const b of backfills) {
    await prisma.transaction.update({
      where: { id: b.id },
      data: {
        installmentTotal: b.installmentTotal,
        installmentGroupKey: b.installmentGroupKey,
      },
    });
    done++;
  }
  console.log(`✓ Backfill aplicado em ${done} transações`);

  const del = await prisma.installment.deleteMany({
    where: { transaction: { importBatchId: { not: null } } },
  });
  console.log(`✓ ${del.count} installments fantasma removidas`);

  let recalced = 0;
  for (const inv of invoices) {
    const byType = await prisma.transaction.groupBy({
      by: ["type"],
      where: { invoiceId: inv.id, status: { not: "cancelado" } },
      _sum: { amount: true },
    });
    let total = 0;
    for (const t of byType) {
      const sum = t._sum.amount ?? 0;
      total += t.type === "despesa" ? sum : -sum;
    }
    if (Math.abs(total - inv.total) > 0.005) {
      await prisma.creditCardInvoice.update({
        where: { id: inv.id },
        data: { total },
      });
      recalced++;
    }
  }
  console.log(`✓ ${recalced} faturas com total corrigido`);

  console.log(
    "\nConcluído. Faturas antigas fragmentadas não são movidas automaticamente:\n" +
      "se quiser consolidá-las, apague as transações do lote antigo na tela de\n" +
      "movimentações e reimporte o PDF da fatura (a importação agora é ancorada\n" +
      "no mês correto e idempotente)."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
