/**
 * Teste (temporário) do cadastro de cliente com modelo MRR/TCV e renovação.
 * Uso: npx tsx scripts/test-cliente-contrato.ts
 */
import { loadEnv } from "./env";
loadEnv();

const TAG = "__teste_cc__";

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { generateBillingsForContract } = await import("@/lib/services/contract-metrics");

  const admin = await runWithoutScope(async () =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  const ok = (name: string, cond: boolean, extra = "") =>
    console.log(`${name}: ${cond ? "OK" : "FALHA"} ${extra}`);

  const now = new Date();

  await runWithOwner(admin!.id, async () => {
    // ===== 1. Cliente MRR: total 5100, 3 meses → mensal 1700, 3 cobranças =====
    const cliMrr = await prisma.client.create({ data: { name: `${TAG}MRR Ltda`, status: "ACTIVE", paymentDay: 10 } });
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const endM = new Date(start.getFullYear(), start.getMonth() + 3, start.getDate());
    endM.setDate(endM.getDate() - 1);
    const cMrr = await prisma.contract.create({
      data: {
        clientId: cliMrr.id, title: `Contrato ${TAG}MRR`, type: "MRR", recurrence: "MONTHLY",
        monthlyValue: 1700, totalValue: 5100, startDate: start, endDate: endM,
        renewalDate: endM, billingDay: 10, status: "ACTIVE",
      },
    });
    await generateBillingsForContract(cMrr.id);
    const billsMrr = await prisma.billing.findMany({ where: { contractId: cMrr.id } });
    const totalMrr = billsMrr.reduce((s, b) => s + Number(b.amount), 0);
    ok("1. MRR: 3 cobranças de 1700 (recorrente no prazo)", billsMrr.length === 3 && totalMrr === 5100, `(${billsMrr.length}/${totalMrr})`);

    // ===== 2. Cliente TCV: 8000 lançado no mês escolhido (única) =====
    const cliTcv = await prisma.client.create({ data: { name: `${TAG}TCV SA`, status: "ACTIVE", paymentDay: 15 } });
    const launch = new Date(now.getFullYear(), now.getMonth() + 1, 15); // mês que vem
    const endT = new Date(launch.getFullYear(), launch.getMonth() + 6, launch.getDate() - 1);
    const cTcv = await prisma.contract.create({
      data: {
        clientId: cliTcv.id, title: `Contrato ${TAG}TCV`, type: "TCV", recurrence: "NONE",
        monthlyValue: 0, totalValue: 8000, startDate: launch, endDate: endT,
        renewalDate: endT, billingDay: 15, status: "ACTIVE",
      },
    });
    await generateBillingsForContract(cTcv.id);
    const billsTcv = await prisma.billing.findMany({ where: { contractId: cTcv.id } });
    ok("2. TCV: 1 cobrança única de 8000 no mês de lançamento",
      billsTcv.length === 1 && Number(billsTcv[0].amount) === 8000 &&
      billsTcv[0].competenceMonth === launch.getMonth() + 1,
      `(${billsTcv.length}/${billsTcv[0]?.amount}/comp ${billsTcv[0]?.competenceMonth})`);
    ok("3. TCV não polui MRR (monthlyValue 0)", Number(cTcv.monthlyValue) === 0);

    // ===== 3. Renovação TCV: paga o valor cheio de novo (replica renewClientContract) =====
    const months = 6;
    const total = 8000;
    const today = new Date();
    const base = cTcv.endDate && cTcv.endDate > today ? cTcv.endDate : today;
    const newEnd = new Date(base);
    newEnd.setMonth(newEnd.getMonth() + months);
    await prisma.contract.update({
      where: { id: cTcv.id },
      data: {
        status: "ACTIVE", endDate: newEnd, renewalDate: newEnd,
        totalValue: Number(cTcv.totalValue) + total,
        paymentMethod: "pix", paymentMode: "a_vista",
      },
    });
    const due = new Date(today.getFullYear(), today.getMonth(), 15);
    if (due < today) due.setMonth(due.getMonth() + 1);
    await prisma.billing.create({
      data: {
        clientId: cliTcv.id, contractId: cTcv.id,
        description: `Contrato ${TAG}TCV — renovação`,
        competenceMonth: due.getMonth() + 1, competenceYear: due.getFullYear(),
        amount: total, dueDate: due, revenueType: "TCV", status: "PENDING",
      },
    });
    const after = await prisma.contract.findUnique({ where: { id: cTcv.id } });
    const billsAfter = await prisma.billing.count({ where: { contractId: cTcv.id } });
    ok("4. renovação TCV: nova cobrança cheia (2 no total) + TCV acumulado 16000",
      billsAfter === 2 && Number(after?.totalValue) === 16000, `(${billsAfter}/${after?.totalValue})`);
    ok("5. forma/modalidade gravadas no contrato",
      after?.paymentMethod === "pix" && after?.paymentMode === "a_vista");

    // ===== 4. receitas do mês via cobranças (MRR aparece no esperado) =====
    const compAgg = await prisma.billing.aggregate({
      where: {
        contractId: { in: [cMrr.id, cTcv.id] },
        competenceMonth: now.getMonth() + 1,
        competenceYear: now.getFullYear(),
      },
      _sum: { amount: true },
    });
    ok("6. competência do mês inclui a mensalidade MRR (≥1700)", Number(compAgg._sum.amount) >= 1700, `(${compAgg._sum.amount})`);

    // limpeza
    await prisma.billing.deleteMany({ where: { contractId: { in: [cMrr.id, cTcv.id] } } });
    await prisma.contract.deleteMany({ where: { id: { in: [cMrr.id, cTcv.id] } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: TAG } } });
    console.log("7. limpeza: OK");
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
