/**
 * Detalhe do LOTE identificado — SOMENTE LEITURA.
 *   PROD_URL="postgres://..." npx tsx scripts/diagnostico-lote.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient(
  process.env.PROD_URL ? { datasources: { db: { url: process.env.PROD_URL } } } : undefined
);

async function main() {
  console.log("===== CORRELAÇÕES DO DIA 10/09/2026 (Payment CREATE) =====");
  const corr = await prisma.$queryRawUnsafe<any[]>(`
    SELECT "correlationId", min("createdAt") AS quando, count(*)::int AS pagamentos,
           string_agg(DISTINCT "actorEmail", ',') AS ator
    FROM "AuditLog"
    WHERE entity = 'Payment' AND action = 'CREATE'
      AND "createdAt"::date = DATE '2026-09-10'
    GROUP BY 1 ORDER BY 2
  `);
  for (const r of corr)
    console.log(`  ${new Date(r.quando).toISOString().slice(11, 19)}Z  corr=${r.correlationId}  pagamentos=${r.pagamentos}  ${r.ator}`);

  console.log("\n===== OS 4 PAGAMENTOS AVULSOS DO MESMO DIA (fora do lote) =====");
  const avulsos = await prisma.$queryRawUnsafe<any[]>(`
    SELECT p.id, p."paidAt"::date AS pago_em, p."createdAt", p.amount,
           b."competenceMonth", b."competenceYear", c.name AS cliente
    FROM "Payment" p
    JOIN "Billing" b ON b.id = p."billingId"
    LEFT JOIN "Client" c ON c.id = b."clientId"
    WHERE p."createdAt"::date = DATE '2026-09-10'
      AND p."paidAt"::date <> DATE '2026-09-10'
    ORDER BY p."createdAt"
  `);
  for (const r of avulsos)
    console.log(`  ${String(r.cliente ?? "—").slice(0, 26).padEnd(26)} comp ${String(r.competenceMonth).padStart(2, "0")}/${r.competenceYear} · pago em ${new Date(r.pago_em).toISOString().slice(0, 10)} · R$ ${Number(r.amount).toFixed(2)}`);

  console.log("\n===== FOTOGRAFIAS DE 2026-07 e 2026-08 =====");
  const snaps = await prisma.$queryRawUnsafe<any[]>(`
    SELECT competence, version, kind, name, "closedAt", "closedBy", "schemaVersion"
    FROM "Snapshot" WHERE competence IN ('2026-07','2026-08') ORDER BY competence, version
  `);
  for (const r of snaps)
    console.log(`  ${r.competence} v${r.version} kind=${r.kind} nome="${r.name}" congelada em ${new Date(r.closedAt).toISOString().slice(0, 19)}Z por ${r.closedBy ?? "—"}`);

  console.log("\n===== O QUE JULHO MOSTRA HOJE (cobranças da competência 07/2026) =====");
  const jul = await prisma.$queryRawUnsafe<any[]>(`
    SELECT status, count(*)::int AS n, sum(amount)::float AS total,
           sum("paidTotal")::float AS pago
    FROM "Billing" WHERE "competenceYear" = 2026 AND "competenceMonth" = 7
    GROUP BY 1 ORDER BY 3 DESC
  `);
  for (const r of jul)
    console.log(`  ${String(r.status).padEnd(9)} ${String(r.n).padStart(3)} cobrança(s) · faturado R$ ${Number(r.total).toFixed(2)} · recebido R$ ${Number(r.pago).toFixed(2)}`);

  console.log("\n===== CAIXA: onde os R$ 21.790 estão hoje =====");
  const cx = await prisma.$queryRawUnsafe<any[]>(`
    SELECT to_char("receivedAt", 'YYYY-MM') AS mes, "revenueType",
           count(*)::int AS n, sum(amount)::float AS total
    FROM "Income"
    WHERE "receivedAt" >= DATE '2026-07-01' AND "receivedAt" < DATE '2026-10-01'
    GROUP BY 1,2 ORDER BY 1,4 DESC
  `);
  for (const r of cx)
    console.log(`  ${r.mes} ${String(r.revenueType ?? "—").padEnd(12)} ${String(r.n).padStart(3)} · R$ ${Number(r.total).toFixed(2)}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("falhou:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
