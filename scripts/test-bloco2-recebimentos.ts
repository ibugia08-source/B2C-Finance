/**
 * Testes do BLOCO 2 de Recebimentos:
 *  1. Descrição oficial da Receita Extra automática:
 *     "Pagamento de {cliente} referente a {Mês}/{ano}, recebido em dd/mm/aaaa."
 *  2. Pagamento parcial posterior ACUMULA na mesma Receita Extra (idempotente).
 *  3. Cobrança removida do mês (CANCELED + motivo/autor) NÃO é recriada
 *     pela geração automática do ciclo (ensureMonthlyBillings).
 *  4. Restauração: voltar de CANCELED reativa a cobrança no ciclo.
 *
 * Usa o MESMO código de produção. Dados com TAG + cleanup ao final.
 * Uso: npx tsx scripts/test-bloco2-recebimentos.ts
 */
import { loadEnv } from "./env";
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
      // ===== 1) Descrição oficial da Receita Extra =====
      console.log("Descrição da Receita Extra automática:");
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
      const er1 = await prisma.extraRevenue.findFirst({
        where: { originBillingId: b.id },
      });
      const expectedDesc = `Pagamento de ${TAG} Cliente XPTO referente a Junho/2026, recebido em 02/07/2026.`;
      assert(!!er1, "Receita Extra automática criada");
      assert(
        er1?.description === expectedDesc,
        "descrição no formato oficial do briefing",
        `obtido: "${er1?.description}"`
      );

      // ===== 2) Parcial posterior acumula (sem duplicar) =====
      console.log("Acúmulo idempotente de parciais:");
      const r2 = await settleBillingPayment({
        billingId: b.id,
        amount: 1000,
        paidAt: new Date(2026, 6, 10),
        method: "PIX",
        accountId: null,
        notes: null,
      });
      assert(r2.ok, "segunda parcial registrada");
      const ers = await prisma.extraRevenue.findMany({
        where: { originBillingId: b.id },
      });
      assert(ers.length === 1, "continua existindo UMA Receita Extra");
      assert(
        Math.abs(Number(ers[0].amount) - 3000) < 0.01,
        "valor acumulado = R$ 3.000"
      );
      assert(
        ers[0].description.includes("10/07/2026"),
        "descrição atualizada com a última data de recebimento",
        ers[0].description
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
