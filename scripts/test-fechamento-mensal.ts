/**
 * Testes dos cenários OBRIGATÓRIOS do fechamento mensal (briefing §3):
 *  1. Venc. 15/06, pago 15/06  → Junho recebe; sem atraso; sem Receita Extra.
 *  2. Venc. 15/06, pago 25/06  → Junho recebe; "pago com atraso"; sem R.E.
 *  3. Venc. 15/06, pago 02/07  → Junho NÃO recebe (fica inadimplente no
 *     fechamento); Julho ganha a RECUPERAÇÃO via pagamentos — SEM criar
 *     Receita Extra (Receita Extra é apenas manual); cobrança de Julho
 *     não é afetada.
 *  4. TCV 6.000 pago em Junho  → Junho recebe 6.000; Julho zerado (sem rateio).
 *  + Reversão: excluir o pagamento zera a recuperação e as flags.
 *
 * Usa o MESMO código de produção (settleBillingPayment / getReceiptsSummary).
 * Dados de teste marcados com TAG e removidos ao final (asserts por DELTA
 * para não depender do banco estar vazio).
 *
 * Uso: npx tsx scripts/test-fechamento-mensal.ts
 */
import { loadEnv } from "./env";
loadEnv();

const TAG = "__teste_fechamento__";
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
  const { settleBillingPayment, revertBillingPayment } = await import(
    "@/lib/services/payment-accounting"
  );
  const { getReceiptsSummary } = await import("@/lib/services/revenue-metrics");

  const admin = await runWithoutScope(() =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  if (!admin) throw new Error("Nenhum ADMIN no banco.");

  const JUN = { start: new Date(2026, 5, 1), end: new Date(2026, 6, 1) };
  const JUL = { start: new Date(2026, 6, 1), end: new Date(2026, 7, 1) };

  await runWithOwner(admin.id, async () => {
    // ===== Baseline (deltas) =====
    const junBefore = await getReceiptsSummary(JUN.start, JUN.end);
    const julBefore = await getReceiptsSummary(JUL.start, JUL.end);

    const client = await prisma.client.create({
      data: { name: `${TAG} Cliente`, status: "ACTIVE", modality: "MRR" },
    });

    const mkBilling = (desc: string, amount: number, revenueType: "MRR" | "TCV") =>
      prisma.billing.create({
        data: {
          clientId: client.id,
          description: `${TAG} ${desc}`,
          competenceMonth: 6,
          competenceYear: 2026,
          amount,
          dueDate: new Date(2026, 5, 15), // 15/06/2026
          revenueType,
          status: "PENDING",
        },
      });

    try {
      // ===== Cenário 1: pago no dia do vencimento =====
      console.log("Cenário 1 — venc. 15/06, pago 15/06:");
      const b1 = await mkBilling("C1 no prazo", 1000, "MRR");
      const r1 = await settleBillingPayment({
        billingId: b1.id, amount: 1000, paidAt: new Date(2026, 5, 15),
        method: "PIX", accountId: null, notes: null,
      });
      assert(r1.ok === true, "pagamento aceito");
      if (r1.ok) {
        assert(r1.fullyPaid && !r1.isLate, "sem atraso");
        assert(!r1.paidInDifferentMonth && r1.extraRevenueId == null, "sem Receita Extra");
      }

      // ===== Cenário 2: pago com atraso DENTRO do mês =====
      console.log("Cenário 2 — venc. 15/06, pago 25/06:");
      const b2 = await mkBilling("C2 atraso no mês", 1000, "MRR");
      const r2 = await settleBillingPayment({
        billingId: b2.id, amount: 1000, paidAt: new Date(2026, 5, 25),
        method: "PIX", accountId: null, notes: null,
      });
      assert(r2.ok === true, "pagamento aceito");
      if (r2.ok) {
        assert(r2.isLate === true, "marcado como pago com atraso (isLate)");
        assert(!r2.paidInDifferentMonth && r2.extraRevenueId == null, "sem Receita Extra");
      }

      // ===== Cenário 4: TCV pago cheio em Junho =====
      console.log("Cenário 4 — TCV R$ 6.000 pago em Junho:");
      const b4 = await mkBilling("C4 TCV", 6000, "TCV");
      const r4 = await settleBillingPayment({
        billingId: b4.id, amount: 6000, paidAt: new Date(2026, 5, 15),
        method: "PIX", accountId: null, notes: null,
      });
      assert(r4.ok === true && !("error" in r4), "pagamento aceito");

      // ===== Cenário 3: pago em MÊS POSTERIOR =====
      console.log("Cenário 3 — venc. 15/06, pago 02/07:");
      const b3 = await mkBilling("C3 outro mês", 1000, "MRR");
      const r3 = await settleBillingPayment({
        billingId: b3.id, amount: 1000, paidAt: new Date(2026, 6, 2),
        method: "PIX", accountId: null, notes: null,
      });
      assert(r3.ok === true, "pagamento aceito");
      if (r3.ok) {
        assert(r3.paidInDifferentMonth === true, "flag pago em outro mês");
      }
      // Regra atual: Receita Extra é APENAS manual — o pagamento em mês
      // posterior fica como inadimplência regularizada, sem registro de ER.
      const er3Count = await prisma.extraRevenue.count({
        where: { originBillingId: b3.id },
      });
      assert(er3Count === 0, "NÃO cria Receita Extra automática (regra: só manual)");

      // ===== Fechamento: deltas de Junho e Julho =====
      console.log("Fechamento mensal (deltas nos resumos):");
      const junAfter = await getReceiptsSummary(JUN.start, JUN.end);
      const julAfter = await getReceiptsSummary(JUL.start, JUL.end);

      const dJun = (k: keyof typeof junAfter) =>
        Number(junAfter[k]) - Number(junBefore[k]);
      const dJul = (k: keyof typeof julAfter) =>
        Number(julAfter[k]) - Number(julBefore[k]);

      assert(
        close(dJun("receiptsCorrectMonth"), 8000),
        "Junho recebeu R$ 8.000 (C1 1000 + C2 1000 + C4 6000) — C3 NÃO conta",
        `delta=${dJun("receiptsCorrectMonth")}`
      );
      assert(close(dJun("mrrReceived"), 2000), "MRR recebido de Junho = 2.000");
      assert(close(dJun("tcvReceived"), 6000), "TCV recebido de Junho = 6.000 (cheio)");
      assert(
        dJun("lateSameMonthCount") === 1 && close(dJun("lateSameMonthValue"), 1000),
        "Junho: 1 pago com atraso (R$ 1.000)"
      );
      assert(
        close(dJul("receiptsCorrectMonth"), 0),
        "Julho: recebimentos normais zerados (sem rateio de TCV, sem C3)",
        `delta=${dJul("receiptsCorrectMonth")}`
      );
      assert(close(dJul("tcvReceived"), 0), "Julho: TCV = 0 até nova renovação");
      assert(
        dJul("paidDifferentMonthCount") === 1 &&
          close(dJul("paidDifferentMonthValue"), 1000),
        "Julho: 1 pagamento de mês anterior (R$ 1.000)"
      );
      assert(
        close(dJul("extraRevenueAutomatic"), 1000),
        "Julho: recuperação de inadimplência = R$ 1.000 (via pagamentos, sem ER)"
      );
      assert(
        close(dJul("totalRevenue"), 1000),
        "Julho: faturamento total ganhou só a recuperação (sem duplicidade)"
      );

      // ===== Reversão: excluir o pagamento de C3 =====
      console.log("Reversão — excluir pagamento pago em outro mês:");
      if (r3.ok) {
        const rev = await revertBillingPayment(r3.paymentId);
        assert(rev.ok === true, "pagamento revertido");
        const julReverted = await getReceiptsSummary(JUL.start, JUL.end);
        assert(
          close(Number(julReverted.paidDifferentMonthValue) - Number(julBefore.paidDifferentMonthValue), 0),
          "recuperação de Julho zerada após reversão"
        );
        const b3After = await prisma.billing.findUnique({ where: { id: b3.id } });
        assert(
          b3After?.paidInDifferentMonth === false && b3After?.isLate === false,
          "flags do fechamento zeradas"
        );
      }
    } finally {
      // ===== Limpeza (sempre) =====
      await prisma.extraRevenue.deleteMany({ where: { clientId: client.id } });
      await prisma.income.deleteMany({ where: { clientId: client.id } });
      await prisma.billing.deleteMany({ where: { clientId: client.id } });
      await prisma.client.deleteMany({ where: { id: client.id } });
      console.log("Limpeza concluída (dados de teste removidos).");
    }
  });

  console.log(`\n${passed} passaram, ${failed} falharam.`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });
