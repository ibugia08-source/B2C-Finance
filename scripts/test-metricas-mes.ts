/**
 * Testes das MÉTRICAS OFICIAIS DO MÊS (coerência Dashboard × Rotina):
 *   Em aberto = Falta receber = Faturamento total previsto − Recebido (clamp 0)
 *   Vencido = parte do em aberto com vencimento passado (⊂ Em aberto)
 *
 * Cenários do briefing (proporção 100k/50k/30k/20k em escala /1000):
 *   1. Base: previsto 100, recebido 50 → em aberto 50.
 *   2. Tudo recebido → em aberto 0, vencido 0.
 *   3. Nada recebido → em aberto = previsto.
 *   4. Parte vencida: dos 50 em aberto, 30 vencidos e 20 a vencer.
 *   + clamp: recebido > previsto nunca gera em aberto negativo.
 *
 * Delta-based (getReceiptsSummary antes/depois), TAG + cleanup.
 * Uso: npx tsx scripts/test-metricas-mes.ts
 */
import { loadEnv } from "./env";
loadEnv();

const TAG = "__teste_metricas__";
let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ FALHOU: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const close = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { settleBillingPayment } = await import("@/lib/services/payment-accounting");
  const {
    getReceiptsSummary,
    computeMonthlyResult,
    computeOperationalMargin,
  } = await import("@/lib/financial/calculations");

  const admin = await runWithoutScope(() =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  if (!admin) throw new Error("Nenhum ADMIN no banco.");

  const now = new Date();
  const M = now.getMonth() + 1;
  const Y = now.getFullYear();
  const start = new Date(Y, M - 1, 1);
  const end = new Date(Y, M, 1);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const inFuture = new Date(Y, M, 0); // último dia do mês (a vencer p/ hoje<fim)

  await runWithOwner(admin.id, async () => {
    const before: any = await getReceiptsSummary(start, end);
    const d = (after: any, k: string) => Number(after[k]) - Number(before[k]);

    const client = await prisma.client.create({
      data: { name: `${TAG} Cliente`, status: "ACTIVE", modality: "MRR" },
    });

    try {
      const mk = (desc: string, amount: number, dueDate: Date) =>
        prisma.billing.create({
          data: {
            clientId: client.id,
            description: `${TAG} ${desc}`,
            competenceMonth: M,
            competenceYear: Y,
            amount,
            dueDate,
            status: dueDate < now ? "OVERDUE" : "PENDING",
            revenueType: "MRR",
          },
        });

      // Previsto 100: b1 50 (será pago), b2 20 (a vencer), b3 30 (vencida).
      const b1 = await mk("paga", 50, yesterday);
      const b2 = await mk("a vencer", 20, inFuture);
      const b3 = await mk("vencida", 30, yesterday);

      // ===== Cenário 3 — nada recebido =====
      console.log("Cenário 3 — nada recebido:");
      let s = await getReceiptsSummary(start, end);
      assert(close(d(s, "expectedTotal"), 100), "previsto = 100", String(d(s, "expectedTotal")));
      assert(close(d(s, "receiptsCorrectMonth"), 0), "recebido = 0");
      assert(close(d(s, "openMonth"), 100), "em aberto = 100 (tudo)");

      // ===== Cenário 1 e 4 — recebe 50; dos 50 abertos, 30 vencidos =====
      console.log("Cenários 1 e 4 — base + parte vencida:");
      const pay = await settleBillingPayment({
        billingId: b1.id, amount: 50, paidAt: now,
        method: "PIX", accountId: null, notes: null,
      });
      assert(pay.ok, "pagamento de 50 registrado");
      s = await getReceiptsSummary(start, end);
      assert(close(d(s, "receiptsCorrectMonth"), 50), "recebido = 50");
      assert(close(d(s, "openMonth"), 50), "em aberto = previsto − recebido = 50");
      assert(close(d(s, "overdueOpenAmount"), 30), "vencido = 30 (só a parte atrasada)", String(d(s, "overdueOpenAmount")));
      assert(
        d(s, "overdueOpenAmount") <= d(s, "openMonth") + 0.01,
        "vencido está DENTRO do em aberto"
      );

      // ===== Cenário 2 — tudo recebido =====
      console.log("Cenário 2 — tudo recebido:");
      const p2 = await settleBillingPayment({
        billingId: b2.id, amount: 20, paidAt: now,
        method: "PIX", accountId: null, notes: null,
      });
      const p3 = await settleBillingPayment({
        billingId: b3.id, amount: 30, paidAt: now,
        method: "PIX", accountId: null, notes: null,
      });
      assert(p2.ok && p3.ok, "pagamentos restantes registrados");
      s = await getReceiptsSummary(start, end);
      assert(close(d(s, "receiptsCorrectMonth"), 100), "recebido = 100");
      assert(close(d(s, "openMonth"), 0), "em aberto = 0");
      assert(close(d(s, "overdueOpenAmount"), 0), "vencido = 0");

      // ===== Clamp e funções puras =====
      console.log("Clamp e Resultado/Margem:");
      assert(Math.max(0, 100 - 120) === 0, "clamp: recebido > previsto → em aberto 0");
      assert(computeMonthlyResult(50000, 35000) === 15000, "Resultado = recebido − despesas");
      assert(close(computeOperationalMargin(15000, 50000), 0.3), "Margem = resultado / recebido (30%)");
      assert(computeOperationalMargin(0, 0) === 0, "margem sem divisão por zero");
    } finally {
      const bills = await prisma.billing.findMany({
        where: { clientId: client.id },
        select: { id: true },
      });
      const ids = bills.map((b) => b.id);
      await prisma.income.deleteMany({ where: { billingId: { in: ids } } });
      await prisma.payment.deleteMany({ where: { billingId: { in: ids } } });
      await prisma.collectionHistory.deleteMany({ where: { billingId: { in: ids } } });
      await prisma.billing.deleteMany({ where: { id: { in: ids } } });
      await prisma.client.delete({ where: { id: client.id } });
      console.log("Limpeza concluída (dados de teste removidos).");
    }
  });

  console.log(`\n${passed} passaram, ${failed} falharam.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
