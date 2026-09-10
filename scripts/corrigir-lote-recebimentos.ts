/**
 * CORREÇÃO DA BAIXA EM MASSA COM DATA ERRADA (10/09/2026 → 10/07/2026).
 *
 * O QUE ACONTECEU
 * Em 2026-09-10 15:29:02Z, correlationId f97193d0-244e-4a90-a030-5afaa0662ac8,
 * 21 cobranças da competência 07/2026 receberam baixa em massa com
 * paidAt = 10/09/2026. A data pretendida era 10/07/2026.
 *
 * POR QUE NÃO BASTA UM UPDATE NA DATA
 * paidAt define a COMPETÊNCIA DE CAIXA (01 §5.6). Com 10/09 o motor
 * classificou os 21 Incomes como RECOVERY, marcou paidInDifferentMonth e
 * jogou R$ 21.790,00 no caixa de setembro. Trocar só Billing.paidAt
 * deixaria Payment, PaymentApplication, Income e CollectionHistory
 * contando outra história.
 *
 * COMO CORRIGE
 * Estorna e relança pelo NÚCLEO do produto (services/payment-accounting),
 * o mesmo que a suíte F0.2 cobre — não reimplementa a regra. O relançamento
 * recalcula sozinho revenueType, isLate, paidInDifferentMonth e o Income.
 *
 * SEGURANÇA
 *  · --dry-run (padrão) não escreve nada.
 *  · Backup JSON de tudo que será tocado antes da primeira escrita.
 *  · Pré-checagens abortam ao primeiro sinal fora do esperado.
 *  · Um pagamento por vez; qualquer falha PARA o lote e relata.
 *
 * Uso:
 *   PROD_URL="postgres://..." npx tsx scripts/corrigir-lote-recebimentos.ts
 *   PROD_URL="postgres://..." npx tsx scripts/corrigir-lote-recebimentos.ts --executar
 */
import { writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const CORRELATION_ORIGINAL = "f97193d0-244e-4a90-a030-5afaa0662ac8";
const DATA_ERRADA = "2026-09-10";
const DATA_CERTA = new Date(2026, 6, 10); // 10/07/2026, meia-noite local
const ESPERADO_N = 21;
const ESPERADO_TOTAL = 21790;
const EXECUTAR = process.argv.includes("--executar");

if (process.env.PROD_URL) process.env.POSTGRES_PRISMA_URL = process.env.PROD_URL;
if (process.env.PROD_URL) process.env.POSTGRES_URL_NON_POOLING = process.env.PROD_URL;

const prisma = new PrismaClient(
  process.env.PROD_URL ? { datasources: { db: { url: process.env.PROD_URL } } } : undefined
);

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function abortar(msg: string): never {
  console.error(`\n✖ ABORTADO: ${msg}\n  Nada foi alterado.`);
  process.exit(1);
}

async function main() {
  console.log(EXECUTAR ? "MODO: EXECUÇÃO REAL\n" : "MODO: SIMULAÇÃO (use --executar para valer)\n");

  // ---------- 1. Alvo: os pagamentos do lote ----------
  const alvo = await prisma.$queryRawUnsafe<any[]>(`
    SELECT p.id, p."billingId", p.amount::float AS amount, p.method, p."accountId",
           p.notes, p."paidAt", p."externalSource", p."externalId",
           b."ownerId", b."competenceMonth", b."competenceYear", b."dueDate",
           b.status, b."revenueType", b."paidTotal"::float AS paid_total,
           b.amount::float AS billing_amount, c.name AS cliente
    FROM "Payment" p
    JOIN "Billing" b ON b.id = p."billingId"
    LEFT JOIN "Client" c ON c.id = b."clientId"
    WHERE p."paidAt"::date = DATE '${DATA_ERRADA}'
    ORDER BY c.name
  `);

  const total = alvo.reduce((s, r) => s + r.amount, 0);
  console.log(`Alvo: ${alvo.length} pagamento(s) · ${brl(total)}`);

  // ---------- 2. Pré-checagens ----------
  if (alvo.length !== ESPERADO_N)
    abortar(`esperava ${ESPERADO_N} pagamentos, encontrei ${alvo.length}. O banco mudou desde o diagnóstico.`);
  if (Math.abs(total - ESPERADO_TOTAL) > 0.01)
    abortar(`esperava total de ${brl(ESPERADO_TOTAL)}, encontrei ${brl(total)}.`);
  if (alvo.some((r) => r.competenceMonth !== 7 || r.competenceYear !== 2026))
    abortar("há cobrança fora da competência 07/2026 no alvo.");

  const ids = alvo.map((r) => r.id);
  const q = (sql: string) => prisma.$queryRawUnsafe<any[]>(sql, ids);

  const [outrosPag] = await q(`SELECT count(*)::int AS n FROM "Payment"
     WHERE "billingId" = ANY(SELECT "billingId" FROM "Payment" WHERE id = ANY($1::text[]))
       AND id <> ALL($1::text[])`);
  if (outrosPag.n > 0)
    abortar(`${outrosPag.n} pagamento(s) parcial(is) nas mesmas cobranças — o relançamento cheio quebraria o saldo.`);

  const [cred] = await q(`SELECT count(*)::int AS n FROM "CustomerCreditMovement" WHERE "sourcePaymentId" = ANY($1::text[])`);
  if (cred.n > 0) abortar(`${cred.n} movimento(s) de crédito ligado(s) ao lote.`);

  const [razao] = await q(`SELECT count(*)::int AS n FROM "LedgerTransaction"
     WHERE "sourceType" = 'Payment' AND "sourceId" = ANY($1::text[])`);
  console.log(`  · lançamentos no razão ligados ao lote: ${razao.n} (bandeira do razão está desligada)`);

  const [extra] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT count(*)::int AS n FROM "ExtraRevenue"
    WHERE origin = 'AUTOMATIC' AND "originBillingId" = ANY($1::text[])`,
    alvo.map((r) => r.billingId));
  if (extra.n > 0)
    abortar(`${extra.n} Receita(s) Extra automática(s) ligada(s) a estas cobranças — o estorno as alteraria.`);

  const per = await prisma.$queryRawUnsafe<any[]>(`
    SELECT competence, state FROM "ClosingPeriod" WHERE competence IN ('2026-07','2026-09')`);
  for (const p of per)
    if (p.state === "CLOSED" || p.state === "SOFT_CLOSED")
      abortar(`competência ${p.competence} está ${p.state}. Reabra antes de corrigir.`);
  console.log(`  · competências 07 e 09/2026: abertas (${per.length} linha(s) de fechamento)`);

  const donos = new Set(alvo.map((r) => r.ownerId));
  if (donos.size !== 1) abortar(`o lote tem ${donos.size} donos diferentes; esperava 1.`);
  const ownerId = alvo[0].ownerId as string;
  console.log(`  · dono único: ${ownerId}`);
  console.log("  ✓ todas as pré-checagens passaram");

  // ---------- 3. Backup ----------
  const backup = {
    geradoEm: new Date().toISOString(),
    correlationOriginal: CORRELATION_ORIGINAL,
    dataErrada: DATA_ERRADA,
    dataCerta: DATA_CERTA.toISOString(),
    pagamentos: alvo,
    incomes: await q(`SELECT * FROM "Income" WHERE "paymentId" = ANY($1::text[])`),
    aplicacoes: await q(`SELECT * FROM "PaymentApplication" WHERE "paymentId" = ANY($1::text[])`),
    cobrancas: await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Billing" WHERE id = ANY($1::text[])`, alvo.map((r) => r.billingId)),
  };
  const arquivo = `backup-lote-${Date.now()}.json`;
  writeFileSync(arquivo, JSON.stringify(backup, (_k, v) => (typeof v === "bigint" ? String(v) : v), 2));
  console.log(`\n  ✓ backup em ${arquivo} (${backup.pagamentos.length} pagamentos, ${backup.incomes.length} incomes, ${backup.cobrancas.length} cobranças)`);

  if (!EXECUTAR) {
    console.log("\n--- SIMULAÇÃO: o que seria feito, cobrança a cobrança ---");
    for (const r of alvo)
      console.log(`  ${String(r.cliente).slice(0, 26).padEnd(26)} ${brl(r.amount).padStart(13)}  estorna pay ${r.id} → relança em 10/07/2026 (${r.method})`);
    console.log(`\nNada foi escrito. Rode com --executar para aplicar.`);
    await prisma.$disconnect();
    return;
  }

  // ---------- 4. Correção ----------
  const { runWithOwner } = await import("@/lib/auth/owner-scope");
  const { revertBillingPayment, settleBillingPayment } = await import("@/lib/services/payment-accounting");
  const { newCorrelationId } = await import("@/lib/engines/context");

  const correlation = newCorrelationId();
  const ctx = {
    actorId: null,
    actorEmail: "ibugia08@gmail.com",
    origin: "JOB" as const,
    reason:
      `Correção de data: baixa em massa de 21 recebimentos de 07/2026 foi registrada com ` +
      `paidAt=10/09/2026 (lote ${CORRELATION_ORIGINAL}); a data correta é 10/07/2026. ` +
      `Estorno e relançamento pelo motor, a pedido do dono da conta.`,
    correlationId: correlation,
  };
  console.log(`\ncorrelationId da correção: ${correlation}\n`);

  let ok = 0;
  const falhas: string[] = [];
  for (const r of alvo) {
    const nome = String(r.cliente).slice(0, 26).padEnd(26);
    try {
      await runWithOwner(ownerId, async () => {
        const rev = await revertBillingPayment(r.id, ctx);
        if (!rev.ok) throw new Error(`estorno: ${rev.error}`);
        const set = await settleBillingPayment(
          {
            billingId: r.billingId,
            amount: r.amount,
            paidAt: DATA_CERTA,
            method: r.method,
            accountId: r.accountId,
            notes: r.notes,
          } as any,
          ctx
        );
        if (!set.ok) throw new Error(`relançamento: ${set.error}`);
      });
      ok++;
      console.log(`  ✓ ${nome} ${brl(r.amount).padStart(13)}`);
    } catch (e: any) {
      falhas.push(`${r.cliente} (${r.billingId}): ${e.message}`);
      console.error(`  ✖ ${nome} ${e.message}`);
      console.error(`\nPARANDO no primeiro erro. ${ok} corrigido(s), 1 falhou, ${alvo.length - ok - 1} não tocado(s).`);
      console.error(`Backup íntegro em ${arquivo}.`);
      break;
    }
  }

  console.log(`\n${ok}/${alvo.length} corrigido(s).`);
  if (falhas.length) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("falhou:", e);
  await prisma.$disconnect();
  process.exit(1);
});
