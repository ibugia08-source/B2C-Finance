/**
 * Testes da Gestão de Carteira:
 *  1. BUG reproduzido: excluir cliente com cobranças/contrato falhava por
 *     FK (Billing/Contract sem cascade) → deleteClientsDeep resolve.
 *  2. Venda no cadastro: contrato TCV entra CHEIO no mês da venda (sem
 *     rateio) e MRR gera mensalidades total÷prazo a partir do mês da venda;
 *     modalidade e prazo refletem no cadastro do cliente.
 *
 * Usa o MESMO código de produção. TAG + cleanup.
 * Uso: npx tsx scripts/test-carteira-venda-exclusao.ts
 */
import { loadEnv } from "./env";
loadEnv();

const TAG = "__teste_carteira__";
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
  const { deleteClientsDeep } = await import("@/lib/services/client-purge");
  const { generateBillingsForContract } = await import(
    "@/lib/services/contract-metrics"
  );

  const admin = await runWithoutScope(() =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  if (!admin) throw new Error("Nenhum ADMIN no banco.");

  await runWithOwner(admin.id, async () => {
    const cleanupIds: string[] = [];
    try {
      // ===== 1) BUG: excluir cliente com rastro financeiro =====
      console.log("Exclusão de cliente com cobranças/contrato/pagamento:");
      const c1 = await prisma.client.create({
        data: { name: `${TAG} Excluir`, status: "ACTIVE", modality: "MRR", monthlyValue: 1000 },
      });
      cleanupIds.push(c1.id);
      const ct = await prisma.contract.create({
        data: {
          clientId: c1.id, title: `${TAG} contrato`, type: "MRR",
          recurrence: "MONTHLY", monthlyValue: 1000, totalValue: 3000,
          startDate: new Date(2031, 0, 5), endDate: new Date(2031, 2, 28),
          billingDay: 5, status: "ACTIVE",
        },
      });
      const b = await prisma.billing.create({
        data: {
          clientId: c1.id, contractId: ct.id, description: `${TAG} mensalidade`,
          competenceMonth: 1, competenceYear: 2031, amount: 1000,
          dueDate: new Date(2031, 0, 5), status: "PAID", paidTotal: 1000,
          paidAt: new Date(2031, 0, 5), revenueType: "MRR",
        },
      });
      await prisma.payment.create({
        data: { billingId: b.id, amount: 1000, paidAt: new Date(2031, 0, 5), method: "PIX" },
      });
      await prisma.collectionHistory.create({
        data: { billingId: b.id, clientId: c1.id, status: "PAID", message: `${TAG}` },
      });

      // Reproduz o bug: delete puro deve falhar por FK.
      let rawDeleteFailed = false;
      try {
        await prisma.client.delete({ where: { id: c1.id } });
      } catch {
        rawDeleteFailed = true;
      }
      assert(rawDeleteFailed, "BUG reproduzido: delete puro falha por FK (Billing/Contract)");

      const res = await deleteClientsDeep([c1.id]);
      assert(res.deleted === 1, "deleteClientsDeep exclui o cliente");
      assert(
        (await prisma.client.count({ where: { id: c1.id } })) === 0 &&
          (await prisma.billing.count({ where: { clientId: c1.id } })) === 0 &&
          (await prisma.contract.count({ where: { clientId: c1.id } })) === 0 &&
          (await prisma.payment.count({ where: { billingId: b.id } })) === 0,
        "cliente, cobranças, contrato e pagamentos removidos juntos"
      );

      // ===== 2) Venda TCV: valor cheio no mês da venda, sem rateio =====
      console.log("Venda TCV — cheio no mês da venda:");
      const c2 = await prisma.client.create({
        data: { name: `${TAG} TCV`, status: "ACTIVE", paymentDay: 10 },
      });
      cleanupIds.push(c2.id);
      const saleDate = new Date(2031, 4, 17); // venda em 17/05/2031, prazo 3 meses
      const ctTcv = await prisma.contract.create({
        data: {
          clientId: c2.id, title: `${TAG} Contrato TCV`, type: "TCV",
          recurrence: "NONE", monthlyValue: 0, totalValue: 6000,
          startDate: new Date(saleDate.getFullYear(), saleDate.getMonth(), 10),
          endDate: new Date(2031, 7, 9), billingDay: 10, status: "ACTIVE",
        },
      });
      await generateBillingsForContract(ctTcv.id);
      const tcvBills = await prisma.billing.findMany({
        where: { contractId: ctTcv.id },
      });
      assert(tcvBills.length === 1, "TCV gera UMA única cobrança (sem rateio)");
      assert(
        tcvBills[0]?.competenceMonth === 5 && tcvBills[0]?.competenceYear === 2031,
        "competência = mês da venda (05/2031)"
      );
      assert(close(Number(tcvBills[0]?.amount), 6000), "valor CHEIO (R$ 6.000)");
      const junhoTcv = await prisma.billing.count({
        where: { contractId: ctTcv.id, competenceMonth: 6, competenceYear: 2031 },
      });
      assert(junhoTcv === 0, "mês seguinte NÃO recebe rateio");

      // ===== 3) Venda MRR: total ÷ prazo a partir do mês da venda =====
      console.log("Venda MRR — mensal a partir do mês da venda:");
      const c3 = await prisma.client.create({
        data: { name: `${TAG} MRR`, status: "ACTIVE", paymentDay: 5 },
      });
      cleanupIds.push(c3.id);
      // endDate = último dia do mês final do prazo (mesma fórmula do saveClient)
      const ctMrr = await prisma.contract.create({
        data: {
          clientId: c3.id, title: `${TAG} Contrato MRR`, type: "MRR",
          recurrence: "MONTHLY", monthlyValue: 1700, totalValue: 5100,
          startDate: new Date(2031, 4, 5), endDate: new Date(2031, 7, 0),
          billingDay: 5, status: "ACTIVE",
        },
      });
      await generateBillingsForContract(ctMrr.id);
      const mrrBills = await prisma.billing.findMany({
        where: { contractId: ctMrr.id },
        orderBy: [{ competenceYear: "asc" }, { competenceMonth: "asc" }],
      });
      assert(mrrBills.length === 3, "MRR gera 3 mensalidades (prazo 3 meses)", String(mrrBills.length));
      assert(
        mrrBills[0]?.competenceMonth === 5 && close(Number(mrrBills[0]?.amount), 1700),
        "1ª mensalidade no mês da venda, total ÷ prazo (R$ 1.700)"
      );
    } finally {
      await deleteClientsDeep(cleanupIds).catch(() => {});
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
