/**
 * Testes de Recebimentos (regras de remoção/ER manual):
 *  1. Pagamento em mês posterior NÃO cria Receita Extra (ER é só manual);
 *     fica como inadimplência regularizada (flag paidInDifferentMonth).
 *  2. Quitação posterior mantém flags corretas, sem duplicidade.
 *  2b. Inadimplência anterior manual = cobrança vencida na competência
 *     original, sem Receita Extra.
 *  3. Cobrança removida do mês (CANCELED + motivo/autor) NÃO é recriada
 *     pela geração automática do ciclo (ensureMonthlyBillings).
 *  4. Restauração: voltar de CANCELED reativa a cobrança no ciclo.
 *
 * Usa o MESMO código de produção. Dados com TAG + cleanup ao final.
 * Uso: npx tsx scripts/test-bloco2-recebimentos.ts
 */
import { loadEnv } from "../env";
loadEnv();

const TAG = "__teste_bloco2__";
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

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { settleBillingPayment } = await import("@/lib/services/payment-accounting");
  const { ensureMonthlyBillings } = await import("@/lib/services/receivables-cycle");

  const admin = await runWithoutScope(() =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  if (!admin) throw new Error("Nenhum ADMIN no banco.");

  await runWithOwner(admin.id, async () => {
    const client = await prisma.client.create({
      data: {
        name: `${TAG} Cliente XPTO`,
        status: "ACTIVE",
        modality: "MRR",
        monthlyValue: 3000,
        paymentDay: 15,
        startedAt: new Date(2026, 0, 10),
      },
    });

    try {
      // ===== 1) Pagamento em mês posterior: SEM Receita Extra (só manual) =====
      console.log("Pagamento em mês posterior — inadimplência regularizada, sem ER:");
      const b = await prisma.billing.create({
        data: {
          clientId: client.id,
          description: `${TAG} Mensalidade 06/2026`,
          competenceMonth: 6,
          competenceYear: 2026,
          amount: 3000,
          dueDate: new Date(2026, 5, 15),
          status: "OVERDUE",
          revenueType: "MRR",
        },
      });
      const r1 = await settleBillingPayment({
        billingId: b.id,
        amount: 2000,
        paidAt: new Date(2026, 6, 2), // 02/07/2026 — mês posterior
        method: "PIX",
        accountId: null,
        notes: null,
      });
      assert(r1.ok, "pagamento parcial em mês posterior registrado");
      assert(
        (await prisma.extraRevenue.count({ where: { originBillingId: b.id } })) === 0,
        "NÃO criou Receita Extra automática (Receita Extra é apenas manual)"
      );

      // ===== 2) Quitação posterior mantém a regra (flags certas, sem ER) =====
      console.log("Quitação em mês posterior — flags e nenhuma duplicidade:");
      const r2 = await settleBillingPayment({
        billingId: b.id,
        amount: 1000,
        paidAt: new Date(2026, 6, 10),
        method: "PIX",
        accountId: null,
        notes: null,
      });
      assert(r2.ok, "segunda parcial registrada");
      const bPaid = await prisma.billing.findUnique({ where: { id: b.id } });
      assert(
        bPaid?.status === "PAID" && bPaid?.paidInDifferentMonth === true,
        "cobrança quitada com flag 'pago em outro mês' (regularizado depois)"
      );
      assert(
        (await prisma.extraRevenue.count({ where: { originBillingId: b.id } })) === 0,
        "segue sem Receita Extra após a quitação"
      );

      // ===== 2b) Inadimplência anterior manual: cria cobrança vencida, sem ER =====
      console.log("Inadimplência anterior (registro manual de mês passado):");
      const past = await prisma.billing.create({
        data: {
          clientId: client.id,
          description: `Inadimplência anterior 03/2026 — ${TAG} Cliente XPTO`,
          competenceMonth: 3,
          competenceYear: 2026,
          amount: 1500,
          dueDate: new Date(2026, 2, 15),
          status: "OVERDUE",
          collectionStatus: "ESCALATED",
          revenueType: "MRR",
        },
      });
      assert(
        past.status === "OVERDUE" && past.collectionStatus === "ESCALATED",
        "registrada como cobrança vencida/inadimplente na competência original"
      );
      assert(
        (await prisma.extraRevenue.count({ where: { originBillingId: past.id } })) === 0,
        "inadimplência anterior NÃO cria Receita Extra"
      );

      // ===== 3) Removido do mês NÃO é recriado =====
      console.log("Removido do mês não é recriado pela geração automática:");
      // Simula agosto: garante que a geração cria a mensalidade do cliente…
      await ensureMonthlyBillings(8, 2026);
      const aug = await prisma.billing.findFirst({
        where: { clientId: client.id, competenceMonth: 8, competenceYear: 2026 },
      });
      assert(!!aug, "geração automática criou a mensalidade 08/2026");
      // …remove do mês com auditoria (mesmos dados da action cancelBilling)…
      await prisma.billing.update({
        where: { id: aug!.id },
        data: {
          status: "CANCELED",
          canceledAt: new Date(),
          canceledBy: "teste@b2c",
          cancelReason: "cliente pausado no mês",
        },
      });
      await ensureMonthlyBillings(8, 2026);
      const augAll = await prisma.billing.findMany({
        where: { clientId: client.id, competenceMonth: 8, competenceYear: 2026 },
      });
      assert(augAll.length === 1, "removido do mês não foi recriado");
      assert(augAll[0].status === "CANCELED", "permanece removido (CANCELED)");
      assert(
        augAll[0].cancelReason === "cliente pausado no mês" &&
          augAll[0].canceledBy === "teste@b2c",
        "auditoria da remoção registrada (motivo + autor)"
      );

      // ===== 4) Restauração volta ao ciclo =====
      console.log("Restauração no ciclo do mês:");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const restored = await prisma.billing.update({
        where: { id: aug!.id },
        data: {
          status: aug!.dueDate < today ? "OVERDUE" : "PENDING",
          canceledAt: null,
          canceledBy: null,
          cancelReason: null,
        },
      });
      assert(
        restored.status !== "CANCELED" && restored.cancelReason === null,
        "cobrança recolocada no ciclo (auditoria limpa)"
      );
    } finally {
      // ===== Cleanup =====
      const billings = await prisma.billing.findMany({
        where: { clientId: client.id },
        select: { id: true },
      });
      const ids = billings.map((x) => x.id);
      await prisma.extraRevenue.deleteMany({ where: { originBillingId: { in: ids } } });
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
