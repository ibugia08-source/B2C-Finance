/**
 * SEMENTE LOCAL para validar a exclusão de recebimentos na Gestão do Mês.
 * SÓ roda contra o banco local (recusa qualquer host que não seja 127.0.0.1).
 *
 *   npx tsx scripts/seed-recebimentos-dev.ts
 */
import { loadEnv } from "./env";
loadEnv();

const url = process.env.POSTGRES_PRISMA_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error("✖ Este seed é só para o banco LOCAL. URL atual não é localhost.");
  process.exit(1);
}

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { settleBillingPayment } = await import("@/lib/services/payment-accounting");

  const admin = await runWithoutScope(async () =>
    prisma.user.findFirstOrThrow({ where: { role: "ADMIN" }, select: { id: true } })
  );

  await runWithOwner(admin.id, async () => {
    const mk = async (
      nome: string,
      valor: number,
      mes: number,
      opts: { pagarEm?: Date; vencimento?: Date } = {}
    ) => {
      const c = await prisma.client.create({
        data: {
          name: nome, status: "ACTIVE", modality: "MRR",
          monthlyValue: valor, paymentDay: 5, startedAt: new Date(2026, 0, 5),
        },
      });
      const b = await prisma.billing.create({
        data: {
          clientId: c.id,
          description: `Mensalidade ${String(mes).padStart(2, "0")}/2026`,
          competenceMonth: mes, competenceYear: 2026,
          amount: valor, dueDate: opts.vencimento ?? new Date(2026, mes - 1, 5),
          revenueType: "MRR", status: "PENDING",
        },
      });
      if (opts.pagarEm) {
        const r = await settleBillingPayment({
          billingId: b.id, amount: valor, paidAt: opts.pagarEm,
          method: "PIX", accountId: null, notes: null,
        });
        if (!r.ok) throw new Error(`${nome}: ${(r as any).error}`);
      }
      return { c, b };
    };

    // Setembro/2026 — o mês exibido:
    await mk("Padaria Modelo", 1200, 9, { pagarEm: new Date(2026, 8, 5) });     // paga no mês
    await mk("Ótica Exemplo", 900, 9);                                          // a vencer/vencida
    // Recuperação: cobrança de JULHO paga agora em setembro.
    await mk("Barbearia Clássica", 700, 7, { pagarEm: new Date(2026, 8, 9) });

    // Entrada avulsa e receita extra em setembro.
    await prisma.income.create({
      data: {
        description: "Consultoria avulsa", amount: 350,
        receivedAt: new Date(2026, 8, 8), sourceType: "PIX",
        incomeType: "SERVICE", status: "RECEIVED",
      },
    });
    await prisma.extraRevenue.create({
      data: {
        description: "Bônus de indicação", amount: 250,
        receivedAt: new Date(2026, 8, 7), origin: "MANUAL",
        type: "OTHER", competenceMonth: 9, competenceYear: 2026,
      },
    });
  });

  console.log("✓ semente pronta: 3 cobranças (1 paga, 1 aberta, 1 recuperação de julho), 1 avulsa, 1 extra");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("falhou:", e);
  process.exit(1);
});
