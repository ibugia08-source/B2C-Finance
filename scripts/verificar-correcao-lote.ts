/**
 * VERIFICAÇÃO PÓS-CORREÇÃO — SOMENTE LEITURA.
 * Confere os invariantes que a correção poderia ter quebrado.
 *   PROD_URL="postgres://..." npx tsx scripts/verificar-correcao-lote.ts
 */
import { readFileSync, readdirSync } from "fs";
import { PrismaClient } from "@prisma/client";

const CORRELATION_CORRECAO = "522f0796-50ce-429d-9430-fa090e103bee";
const prisma = new PrismaClient(
  process.env.PROD_URL ? { datasources: { db: { url: process.env.PROD_URL } } } : undefined
);

let falhas = 0;
function checar(nome: string, ok: boolean, detalhe = "") {
  console.log(`  ${ok ? "✓" : "✖"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas++;
}

async function main() {
  // As cobranças afetadas vêm do BACKUP, não de uma nova busca: assim a
  // conferência é contra o que existia antes, e não contra o que sobrou.
  const dir = ".backups";
  const arq = readdirSync(dir).filter((f) => f.startsWith("backup-lote-")).sort().pop()!;
  const backup = JSON.parse(readFileSync(`${dir}/${arq}`, "utf8"));
  const billingIds: string[] = backup.pagamentos.map((p: any) => p.billingId);
  const valorEsperado: number = backup.pagamentos.reduce((s: number, p: any) => s + Number(p.amount), 0);
  console.log(`Conferindo contra ${dir}/${arq} — ${billingIds.length} cobranças, R$ ${valorEsperado.toFixed(2)}\n`);

  const q = (sql: string) => prisma.$queryRawUnsafe<any[]>(sql, billingIds);

  console.log("INVARIANTES DAS COBRANÇAS CORRIGIDAS");
  const [pag] = await q(`SELECT count(*)::int AS n, coalesce(sum(amount),0)::float AS total
    FROM "Payment" WHERE "billingId" = ANY($1::text[])`);
  checar("um pagamento por cobrança", pag.n === billingIds.length, `${pag.n} pagamento(s)`);
  checar("valor total preservado", Math.abs(pag.total - valorEsperado) < 0.01, `R$ ${pag.total.toFixed(2)}`);

  const [dataOk] = await q(`SELECT count(*)::int AS n FROM "Payment"
    WHERE "billingId" = ANY($1::text[]) AND "paidAt"::date = DATE '2026-07-10'`);
  checar("todos com paidAt = 10/07/2026", dataOk.n === billingIds.length, `${dataOk.n}/${billingIds.length}`);

  const [inc] = await q(`SELECT count(*)::int AS n, coalesce(sum(amount),0)::float AS total
    FROM "Income" WHERE "billingId" = ANY($1::text[])`);
  checar("um Income por cobrança (nada duplicado)", inc.n === billingIds.length, `${inc.n} income(s)`);
  checar("caixa igual ao pago", Math.abs(inc.total - valorEsperado) < 0.01, `R$ ${inc.total.toFixed(2)}`);

  const [rec] = await q(`SELECT count(*)::int AS n FROM "Income"
    WHERE "billingId" = ANY($1::text[]) AND "revenueType" = 'RECOVERY'`);
  checar("nenhum classificado como RECOVERY", rec.n === 0, `${rec.n}`);

  const [julho] = await q(`SELECT count(*)::int AS n FROM "Income"
    WHERE "billingId" = ANY($1::text[]) AND to_char("receivedAt",'YYYY-MM') = '2026-07'`);
  checar("caixa reconhecido em julho/2026", julho.n === billingIds.length, `${julho.n}/${billingIds.length}`);

  const [flags] = await q(`SELECT count(*)::int AS n FROM "Billing"
    WHERE id = ANY($1::text[]) AND status = 'PAID'
      AND "paidInDifferentMonth" = false AND "paidAt"::date = DATE '2026-07-10'`);
  checar("cobranças PAID, sem marca de mês posterior", flags.n === billingIds.length, `${flags.n}/${billingIds.length}`);

  // paidTotal == Σ aplicações: o invariante central da F1.4.
  const quebrados = await q(`
    SELECT b.id, b."paidTotal"::float AS pt, coalesce(sum(pa.amount),0)::float AS aplicado
    FROM "Billing" b LEFT JOIN "PaymentApplication" pa ON pa."billingId" = b.id
    WHERE b.id = ANY($1::text[])
    GROUP BY b.id, b."paidTotal" HAVING abs(b."paidTotal" - coalesce(sum(pa.amount),0)) > 0.01`);
  checar("paidTotal = Σ aplicações em todas", quebrados.length === 0, `${quebrados.length} divergente(s)`);

  const [orfaos] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT count(*)::int AS n FROM "Income" i
    WHERE i."paymentId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p.id = i."paymentId")`);
  checar("nenhum Income órfão no banco inteiro", orfaos.n === 0, `${orfaos.n}`);

  const [sobrou] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT count(*)::int AS n FROM "Payment" WHERE "paidAt"::date = DATE '2026-09-10'`);
  checar("nenhum pagamento restante em 10/09/2026", sobrou.n === 0, `${sobrou.n}`);

  console.log("\nTRILHA DE AUDITORIA DA CORREÇÃO");
  const trilha = await prisma.$queryRawUnsafe<any[]>(`
    SELECT entity, action, count(*)::int AS n, min(reason) AS motivo
    FROM "AuditLog" WHERE "correlationId" = $1 GROUP BY 1,2 ORDER BY 1,2`,
    CORRELATION_CORRECAO);
  for (const r of trilha) console.log(`  ${String(r.entity).padEnd(9)} ${String(r.action).padEnd(7)} ${r.n}`);
  checar("estornos registrados", trilha.some((r) => r.action === "REVERSE" && r.n === billingIds.length));
  checar("relançamentos registrados", trilha.some((r) => r.entity === "Payment" && r.action === "CREATE" && r.n === billingIds.length));
  console.log(`  motivo: "${String(trilha[0]?.motivo ?? "").slice(0, 110)}…"`);

  console.log(`\n${falhas === 0 ? "✓ TODOS OS INVARIANTES OK" : `✖ ${falhas} verificação(ões) falharam`}`);
  await prisma.$disconnect();
  if (falhas) process.exit(1);
}

main().catch(async (e) => {
  console.error("falhou:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
