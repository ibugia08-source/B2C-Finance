/**
 * Teste (temporário) do dashboard executivo — services + cálculos.
 * Uso: npx tsx scripts/test-dashboard.ts
 */
import { loadEnv } from "../env";
loadEnv();

const TAG = "__teste_dash__";

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { getExecutiveDashboard, getCommercialKpis, getMonthlySeries, getBreakdowns } =
    await import("@/lib/services/dashboard-metrics");
  const { resolvePeriod } = await import("@/lib/period");

  const admin = await runWithoutScope(() =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  if (!admin) throw new Error("sem admin");
  const owner = admin.id;

  const period = resolvePeriod({ periodo: "mes" });
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

  await runWithOwner(owner, async () => {
    // --- seed mínimo ---
    const client = await prisma.client.create({
      data: { name: `${TAG}cliente`, status: "ACTIVE" },
    });
    const service = await prisma.service.create({
      data: { name: `${TAG}servico`, defaultPrice: 1000 },
    });
    const contract = await prisma.contract.create({
      data: {
        clientId: client.id,
        title: `${TAG}contrato`,
        type: "MRR",
        recurrence: "MONTHLY",
        monthlyValue: 2000,
        totalValue: 24000,
        startDate: new Date(now.getFullYear(), now.getMonth() - 2, 1),
        billingDay: 5,
        status: "ACTIVE",
        renewalDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 10),
      },
    });
    // cobrança vencida (mês passado) e pendente (mês que vem)
    const overdue = await prisma.billing.create({
      data: {
        clientId: client.id,
        contractId: contract.id,
        serviceId: service.id,
        description: `${TAG}vencida`,
        competenceMonth: lastMonth.getMonth() + 1,
        competenceYear: lastMonth.getFullYear(),
        amount: 2000,
        dueDate: lastMonth,
        status: "OVERDUE",
        revenueType: "MRR",
      },
    });
    const pending = await prisma.billing.create({
      data: {
        clientId: client.id,
        contractId: contract.id,
        serviceId: service.id,
        description: `${TAG}pendente`,
        competenceMonth: now.getMonth() + 1,
        competenceYear: now.getFullYear(),
        amount: 2000,
        dueDate: new Date(now.getFullYear(), now.getMonth() + 1, 5),
        status: "PENDING",
        revenueType: "MRR",
      },
    });
    // pagamento confirmado hoje (dentro do período "mes") em outra cobrança paga
    const paid = await prisma.billing.create({
      data: {
        clientId: client.id,
        contractId: contract.id,
        serviceId: service.id,
        description: `${TAG}paga`,
        competenceMonth: now.getMonth() + 1,
        competenceYear: now.getFullYear(),
        amount: 2000,
        paidTotal: 2000,
        dueDate: now,
        paidAt: now,
        status: "PAID",
        revenueType: "MRR",
      },
    });
    await prisma.payment.create({
      data: { billingId: paid.id, amount: 2000, paidAt: now, status: "CONFIRMED" },
    });

    const f = { period, clientId: client.id };

    // --- KPIs ---
    const kpis = await getCommercialKpis(f);
    const ok = (name: string, cond: boolean, extra = "") =>
      console.log(`${name}: ${cond ? "OK" : "FALHA"} ${extra}`);

    ok("1. receita vencida 2000", kpis.receitaVencida === 2000, `(${kpis.receitaVencida})`);
    ok("2. receita pendente 2000", kpis.receitaPendente === 2000, `(${kpis.receitaPendente})`);
    ok("3. recebido no período 2000", kpis.faturamentoRecebido === 2000, `(${kpis.faturamentoRecebido})`);
    ok("4. inadimplência 50%", Math.round(kpis.inadimplenciaTaxa * 100) === 50, `(${kpis.inadimplenciaTaxa})`);
    ok("5. MRR 2000", kpis.mrrAtivo === 2000, `(${kpis.mrrAtivo})`);
    ok("6. clientes inadimplentes 1", kpis.clientesInadimplentes === 1, `(${kpis.clientesInadimplentes})`);
    ok("7. contrato em renovação 1", kpis.contratosEmRenovacao >= 1, `(${kpis.contratosEmRenovacao})`);

    // --- séries ---
    const series = await getMonthlySeries(f);
    ok("8. série com 12 meses", series.labels.length === 12 && series.receitas.length === 12);
    ok("9. MRR do mês atual 2000", series.mrr[11] === 2000, `(${series.mrr[11]})`);
    ok("10. inadimplência mês passado 2000", series.inadimplencia[10] === 2000, `(${series.inadimplencia[10]})`);
    ok("11. receita do mês inclui pagamento", series.receitas[11] >= 2000, `(${series.receitas[11]})`);

    // --- rankings ---
    const bd = await getBreakdowns(f);
    const cli = bd.receitaPorCliente.find((s) => s.label.includes(TAG));
    const svc = bd.receitaPorServico.find((s) => s.label.includes(TAG));
    ok("12. receita por cliente 2000", cli?.value === 2000, `(${cli?.value})`);
    ok("13. receita por serviço 2000", svc?.value === 2000, `(${svc?.value})`);

    // --- orquestrador completo (sem filtro de entidade) ---
    const dash = await getExecutiveDashboard({ period });
    ok(
      "14. health válido",
      dash.health.score >= 0 && dash.health.score <= 100 && dash.health.fatores.length === 6,
      `(score ${dash.health.score} → ${dash.health.label})`
    );
    ok(
      "15. alerta de vencidas presente",
      dash.alerts.some((a) => a.title.includes("vencidas")),
      `(${dash.alerts.length} alertas)`
    );
    ok(
      "16. ação de cobrança sugerida",
      dash.actions.some((a) => a.text.includes(`${TAG}cliente`)),
      `(${dash.actions.length} ações)`
    );

    // --- limpeza ---
    await prisma.payment.deleteMany({ where: { billing: { description: { startsWith: TAG } } } });
    await prisma.billing.deleteMany({ where: { description: { startsWith: TAG } } });
    await prisma.contract.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.service.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: TAG } } });
    console.log("17. limpeza: OK");
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
