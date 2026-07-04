/**
 * MIGRAÇÃO DE DADOS para o modo multiusuário (isolamento por dono).
 *
 * O que faz (na ordem):
 *  1. BACKUP completo (JSON) de tudo em ./backups/.
 *  2. WIPE dos LANÇAMENTOS de teste: transações, parcelas, faturas, receitas,
 *     a receber, pagamentos, movimentos de caixa, importações — e logs de IA
 *     e WhatsApp. (Preserva usuários, contas, cartões, pessoas, metas, regras
 *     e categorias.)
 *  3. BACKFILL: atribui ownerId = admin primário a TODAS as entidades privadas
 *     preservadas (contas, cartões, cartões da conta, caixas, pessoas, metas,
 *     regras), para que parem de aparecer para outros usuários.
 *  4. Zera o saldo dos caixas (os movimentos foram apagados).
 *
 * Segurança:
 *  - DRY-RUN por padrão (só relatório).
 *  - Com --apply: grava backup antes e executa.
 *
 * Uso:
 *   npm run db:multiuser              (dry-run)
 *   npm run db:multiuser -- --apply   (executa, com backup)
 */
import { loadEnv } from "./env";
loadEnv();

import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

// Client CRU (sem a extensão de escopo) → acesso total, como manutenção.
const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `=== B2C Finance — migração multiusuário (${APPLY ? "APLICANDO" : "DRY-RUN"}) ===\n`
  );

  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!admin) {
    console.error("Nenhum admin ativo encontrado — abortando.");
    process.exit(1);
  }
  console.log(`Admin dono dos dados preservados: ${admin.email} (${admin.id})\n`);

  const counts = {
    transactions: await prisma.transaction.count(),
    installments: await prisma.installment.count(),
    invoices: await prisma.creditCardInvoice.count(),
    incomes: await prisma.income.count(),
    receivables: await prisma.receivable.count(),
    personPayments: await prisma.personPayment.count(),
    cashMovements: await prisma.cashBoxMovement.count(),
    importBatches: await prisma.importBatch.count(),
    accounts: await prisma.account.count(),
    cards: await prisma.creditCard.count(),
    accountCards: await prisma.accountCard.count(),
    cashBoxes: await prisma.cashBox.count(),
    people: await prisma.person.count(),
    goals: await prisma.goal.count(),
    rules: await prisma.categorizationRule.count(),
  };

  console.log("A APAGAR (lançamentos de teste):");
  console.log(
    `  transações ${counts.transactions} · parcelas ${counts.installments} · faturas ${counts.invoices}`
  );
  console.log(
    `  receitas ${counts.incomes} · a receber ${counts.receivables} · pagamentos ${counts.personPayments}`
  );
  console.log(
    `  mov. de caixa ${counts.cashMovements} · importações ${counts.importBatches}\n`
  );
  console.log("A PRESERVAR e atribuir ao admin:");
  console.log(
    `  contas ${counts.accounts} · cartões ${counts.cards} · cartões da conta ${counts.accountCards}`
  );
  console.log(
    `  caixas ${counts.cashBoxes} (saldo zerado) · pessoas ${counts.people} · metas ${counts.goals} · regras ${counts.rules}\n`
  );

  if (!APPLY) {
    console.log("DRY-RUN: nada foi alterado. Rode com `-- --apply` para executar.");
    return;
  }

  // ---------- Backup ----------
  const backupDir = resolve(process.cwd(), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = resolve(backupDir, `multiuser-${stamp}.json`);
  const dump = {
    createdAt: new Date().toISOString(),
    users: await prisma.user.findMany(),
    people: await prisma.person.findMany(),
    accounts: await prisma.account.findMany(),
    cards: await prisma.creditCard.findMany(),
    accountCards: await prisma.accountCard.findMany(),
    cashBoxes: await prisma.cashBox.findMany(),
    goals: await prisma.goal.findMany(),
    rules: await prisma.categorizationRule.findMany(),
    transactions: await prisma.transaction.findMany(),
    installments: await prisma.installment.findMany(),
    invoices: await prisma.creditCardInvoice.findMany(),
    incomes: await prisma.income.findMany(),
    receivables: await prisma.receivable.findMany(),
    personPayments: await prisma.personPayment.findMany(),
    cashMovements: await prisma.cashBoxMovement.findMany(),
    importBatches: await prisma.importBatch.findMany(),
  };
  writeFileSync(file, JSON.stringify(dump, null, 2), "utf8");
  console.log(`Backup completo gravado em: ${file}\n`);

  // ---------- Wipe (ordem respeita FKs) ----------
  await prisma.$transaction([
    prisma.receivable.deleteMany({}),
    prisma.installment.deleteMany({}),
    prisma.personPayment.deleteMany({}),
    prisma.cashBoxMovement.deleteMany({}),
    prisma.transaction.deleteMany({}),
    prisma.creditCardInvoice.deleteMany({}),
    prisma.income.deleteMany({}),
    prisma.importBatch.deleteMany({}),
  ]);
  console.log("✓ Lançamentos de teste apagados");

  // logs de IA/WhatsApp (globais, mas são teste)
  await prisma.$transaction([
    prisma.aIMessage.deleteMany({}),
    prisma.aIConversation.deleteMany({}),
    prisma.whatsAppMessage.deleteMany({}),
  ]);
  console.log("✓ Logs de IA/WhatsApp apagados");

  // ---------- Backfill ownerId = admin ----------
  const owner = { ownerId: admin.id };
  await prisma.$transaction([
    prisma.account.updateMany({ data: owner }),
    prisma.creditCard.updateMany({ data: owner }),
    prisma.accountCard.updateMany({ data: owner }),
    prisma.cashBox.updateMany({ data: { ...owner, currentAmount: 0 } }),
    prisma.person.updateMany({ data: owner }),
    prisma.goal.updateMany({ data: owner }),
    prisma.categorizationRule.updateMany({ data: owner }),
  ]);
  console.log("✓ Contas/cartões/pessoas/metas/regras atribuídos ao admin; caixas zerados");

  console.log(
    "\nConcluído. A partir de agora, cada usuário só vê o que ele mesmo cadastrar.\n" +
      "Os dados preservados pertencem ao admin; os demais usuários começam vazios."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
