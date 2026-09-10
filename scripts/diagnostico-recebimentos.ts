/**
 * DIAGNÓSTICO DA BAIXA EM MASSA COM DATA ERRADA — SOMENTE LEITURA.
 *
 * Não escreve nada: nenhum create, update ou delete. Serve para enxergar,
 * antes de corrigir, exatamente o que a operação gravou e o que a correção
 * teria de desfazer.
 *
 * Uso (a URL do banco vem por variável de ambiente, nunca do código):
 *   PROD_URL="postgres://..." npx tsx scripts/diagnostico-recebimentos.ts
 *
 * Sem PROD_URL ele usa o banco do .env (o local).
 */
import { PrismaClient } from "@prisma/client";

const DIA_ERRADO = "2026-09-10";
const DIA_CERTO = "2026-07-10";

const prisma = new PrismaClient(
  process.env.PROD_URL
    ? { datasources: { db: { url: process.env.PROD_URL } } }
    : undefined
);

function brl(v: unknown) {
  return Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function main() {
  const alvo = await prisma.$queryRawUnsafe<any[]>(`
    SELECT p.id, p."paidAt", p."createdAt", p.amount, p.method, p."accountId",
           p."externalSource", p.notes,
           b.id AS billing_id, b.description, b."competenceYear", b."competenceMonth",
           b."dueDate", b.status, b.amount AS billing_amount, b."paidTotal",
           b."isLate", b."paidInDifferentMonth",
           c.name AS cliente
    FROM "Payment" p
    JOIN "Billing" b ON b.id = p."billingId"
    LEFT JOIN "Client" c ON c.id = b."clientId"
    WHERE p."paidAt"::date = DATE '${DIA_ERRADO}'
    ORDER BY p."createdAt", c.name
  `);

  console.log(`\n===== PAGAMENTOS COM paidAt EM ${DIA_ERRADO} =====`);
  console.log(`${alvo.length} pagamento(s) · total ${brl(alvo.reduce((s, r) => s + Number(r.amount), 0))}`);

  const porCompetencia = new Map<string, { n: number; total: number }>();
  for (const r of alvo) {
    const k = `${String(r.competenceMonth).padStart(2, "0")}/${r.competenceYear}`;
    const cur = porCompetencia.get(k) ?? { n: 0, total: 0 };
    porCompetencia.set(k, { n: cur.n + 1, total: cur.total + Number(r.amount) });
  }
  console.log("\n-- por competência da cobrança --");
  for (const [k, v] of [...porCompetencia].sort())
    console.log(`  ${k}: ${v.n} cobrança(s) · ${brl(v.total)}`);

  console.log("\n-- lote(s) de gravação (createdAt agrupado por minuto) --");
  const lotes = new Map<string, number>();
  for (const r of alvo) {
    const k = new Date(r.createdAt).toISOString().slice(0, 16);
    lotes.set(k, (lotes.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...lotes].sort()) console.log(`  ${k}Z → ${n} pagamento(s)`);

  console.log("\n-- detalhe --");
  for (const r of alvo)
    console.log(
      `  ${String(r.cliente ?? "—").slice(0, 26).padEnd(26)} comp ${String(r.competenceMonth).padStart(2, "0")}/${r.competenceYear}` +
        ` · ${brl(r.amount).padStart(14)} · status ${String(r.status).padEnd(8)}` +
        ` · pagoEmOutroMes=${r.paidInDifferentMonth} · atraso=${r.isLate} · pay ${r.id}`
    );

  // Incomes gerados por esses pagamentos: é onde o RECOVERY foi parar.
  const ids = alvo.map((r) => r.id);
  if (ids.length) {
    const inc = await prisma.$queryRawUnsafe<any[]>(`
      SELECT "revenueType", count(*)::int AS n, sum(amount)::float AS total
      FROM "Income" WHERE "paymentId" = ANY($1::text[]) GROUP BY 1 ORDER BY 2 DESC
    `, ids);
    console.log("\n-- Incomes gerados (classificação da receita) --");
    for (const r of inc) console.log(`  ${String(r.revenueType).padEnd(12)} ${r.n} · ${brl(r.total)}`);

    const outros = await prisma.$queryRawUnsafe<any[]>(`
      SELECT count(*)::int AS n FROM "Payment" p
      WHERE p."billingId" IN (SELECT "billingId" FROM "Payment" WHERE id = ANY($1::text[]))
        AND p.id <> ALL($1::text[])
    `, ids);
    console.log(`\n-- outros pagamentos nas MESMAS cobranças (parciais anteriores): ${outros[0]?.n ?? 0}`);

    const cred = await prisma.$queryRawUnsafe<any[]>(`
      SELECT count(*)::int AS n, sum(amount)::float AS total
      FROM "CustomerCreditMovement" WHERE "sourcePaymentId" = ANY($1::text[])
    `, ids);
    console.log(`-- crédito de cliente gerado por excedente: ${cred[0]?.n ?? 0} movimento(s) · ${brl(cred[0]?.total)}`);
  }

  console.log("\n===== TRILHA DE AUDITORIA (setembro/2026) =====");
  const trilha = await prisma.$queryRawUnsafe<any[]>(`
    SELECT date_trunc('minute', "createdAt") AS quando, entity, action,
           "actorEmail", origin, "correlationId", count(*)::int AS n
    FROM "AuditLog"
    WHERE "createdAt" >= DATE '2026-09-01' AND "createdAt" < DATE '2026-10-01'
    GROUP BY 1,2,3,4,5,6 ORDER BY 1 DESC LIMIT 40
  `);
  for (const r of trilha)
    console.log(
      `  ${new Date(r.quando).toISOString().slice(0, 16)}Z ${String(r.entity).padEnd(12)} ${String(r.action).padEnd(7)}` +
        ` ${String(r.actorEmail ?? "—").padEnd(28)} ${String(r.origin).padEnd(7)} corr=${String(r.correlationId ?? "—").slice(0, 12)} n=${r.n}`
    );

  console.log("\n===== ESTADO DAS COMPETÊNCIAS =====");
  const per = await prisma.$queryRawUnsafe<any[]>(`
    SELECT competence, state, "closedAt", "closedBy", "reopenedAt"
    FROM "ClosingPeriod"
    WHERE competence IN ('2026-07','2026-08','2026-09') ORDER BY competence
  `);
  if (!per.length) console.log("  nenhuma linha — todas as competências estão ABERTAS por ausência");
  for (const r of per)
    console.log(`  ${r.competence}: ${r.state}${r.closedAt ? ` (fechada em ${new Date(r.closedAt).toISOString().slice(0, 10)} por ${r.closedBy ?? "—"})` : ""}`);

  console.log("\n===== FOTOGRAFIAS (fechamento já congelado?) =====");
  const snaps = await prisma.$queryRawUnsafe<any[]>(`
    SELECT competence, version, "closedAt" FROM "Snapshot"
    WHERE competence IN ('2026-07','2026-08','2026-09') ORDER BY competence, version
  `).catch(() => []);
  if (!snaps.length) console.log("  nenhuma fotografia nessas competências");
  for (const r of snaps) console.log(`  ${r.competence} v${r.version}`);

  console.log(`\n(referência: a data pretendida era ${DIA_CERTO})`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("falhou:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
