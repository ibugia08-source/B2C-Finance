/**
 * Teste (temporário) da camada de relatórios + visões salvas.
 * Uso: npx tsx scripts/test-reports.ts
 */
import { loadEnv } from "../env";
loadEnv();

const TAG = "__teste_rel__";

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { getReport } = await import("@/lib/reports/registry");
  const { parseReportQuery, parsePresentation } = await import("@/lib/reports/query");
  const { presentReport } = await import("@/lib/reports/present");

  const users = await runWithoutScope(() =>
    prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true }, take: 1 })
  );
  const owner = users[0].id;
  const other = await runWithoutScope(() =>
    prisma.user.findFirst({ where: { id: { not: owner } }, select: { id: true } })
  );

  const ok = (name: string, cond: boolean, extra = "") =>
    console.log(`${name}: ${cond ? "OK" : "FALHA"} ${extra}`);

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

  await runWithOwner(owner, async () => {
    // baseline antes do seed (o banco tem dados reais)
    const spMesBase = { periodo: "mes" } as Record<string, string>;
    const fmBefore = await getReport("financeiro-mensal")!.build(parseReportQuery(spMesBase));
    const receitasBefore = Number(fmBefore[fmBefore.length - 1]?.receitas ?? 0);

    // --- seed ---
    const client = await prisma.client.create({ data: { name: `${TAG}cliente`, status: "ACTIVE" } });
    const service = await prisma.service.create({ data: { name: `${TAG}servico`, defaultPrice: 500 } });
    const contract = await prisma.contract.create({
      data: {
        clientId: client.id, title: `${TAG}contrato`, type: "MRR", recurrence: "MONTHLY",
        monthlyValue: 2000, totalValue: 24000,
        startDate: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        billingDay: 5, status: "ACTIVE",
      },
    });
    await prisma.billing.create({
      data: {
        clientId: client.id, contractId: contract.id, serviceId: service.id,
        description: `${TAG}vencida`, competenceMonth: lastMonth.getMonth() + 1,
        competenceYear: lastMonth.getFullYear(), amount: 1500, dueDate: lastMonth,
        status: "OVERDUE", revenueType: "MRR",
      },
    });
    const paid = await prisma.billing.create({
      data: {
        clientId: client.id, contractId: contract.id, serviceId: service.id,
        description: `${TAG}paga`, competenceMonth: now.getMonth() + 1,
        competenceYear: now.getFullYear(), amount: 2000, paidTotal: 2000,
        dueDate: now, paidAt: now, status: "PAID", revenueType: "MRR",
      },
    });
    await prisma.payment.create({
      data: { billingId: paid.id, amount: 2000, paidAt: now, status: "CONFIRMED" },
    });
    // fluxo real: registerBillingPayment cria o Income conciliado junto
    await prisma.income.create({
      data: {
        description: `${TAG}income`, amount: 2000, receivedAt: now,
        status: "RECEIVED", clientId: client.id, billingId: paid.id,
      },
    });
    await prisma.transaction.create({
      data: {
        date: now, description: `${TAG}despesa`, amount: 500, type: "despesa",
        status: "pago", expenseType: "ADS", clientId: client.id, serviceId: service.id,
      },
    });

    const spMes = { periodo: "mes" } as Record<string, string>;

    // 1. financeiro-mensal (delta de +2000 sobre o baseline)
    const fm = await getReport("financeiro-mensal")!.build(parseReportQuery(spMes));
    const fmRow = fm[fm.length - 1];
    const deltaReceitas = Number(fmRow?.receitas) - receitasBefore;
    ok("1. financeiro-mensal +2000 de receita", deltaReceitas === 2000, `(delta ${deltaReceitas})`);
    ok("2. financeiro-mensal despesas ≥ 500", Number(fmRow?.despesas) >= 500, `(${fmRow?.despesas})`);

    // 2. clientes (filtro por cliente + situação inadimplente)
    const cl = await getReport("clientes")!.build(
      parseReportQuery({ cliente: client.id, situacao: "inadimplente" })
    );
    ok("3. relatório clientes: inadimplente com vencido 1500", cl.length === 1 && cl[0].vencido === 1500, `(${cl[0]?.vencido})`);

    // 3. inadimplência
    const inad = await getReport("inadimplencia")!.build(parseReportQuery({ cliente: client.id }));
    ok("4. inadimplência 1500", inad[0]?.valorVencido === 1500, `(${inad[0]?.valorVencido})`);

    // 4. contratos com valorMin
    const con = await getReport("contratos")!.build(
      parseReportQuery({ cliente: client.id, valorMin: "10000" })
    );
    ok("5. contratos valorMin 10000 → 1 linha TCV 24000", con.length === 1 && con[0].valorTotal === 24000, `(${con.length})`);

    // 5. despesas com filtros tipo + pago + valor
    const desp = await getReport("despesas")!.build(
      parseReportQuery({ ...spMes, cliente: client.id, tipo: "ADS", pago: "sim", valorMin: "100", valorMax: "600" })
    );
    ok("6. despesas filtradas (ADS, paga, 100-600) → 500", desp.length === 1 && desp[0].valor === 500, `(${desp.length})`);

    // 6. caixa: entrada 2000 (income conciliado? payment não gera income aqui) + saída 500
    const cx = await getReport("caixa")!.build(parseReportQuery({ ...spMes, cliente: client.id }));
    const saldo = cx.reduce((s, r) => s + Number(r.valor), 0);
    ok("7. caixa: saída de 500 presente", cx.some((r) => r.valor === -500), `(saldo ${saldo})`);

    // 7. rentabilidade por cliente e serviço
    const rc = await getReport("rentabilidade-cliente")!.build(parseReportQuery({ ...spMes, cliente: client.id }));
    ok("8. rentabilidade cliente: 2000 − 500 = 1500 (75%)",
      rc[0]?.receita === 2000 && rc[0]?.resultado === 1500 && rc[0]?.margem === 75,
      `(${JSON.stringify(rc[0])})`);
    const rs = await getReport("rentabilidade-servico")!.build(parseReportQuery({ ...spMes, servico: service.id }));
    ok("9. rentabilidade serviço: resultado 1500", rs[0]?.resultado === 1500, `(${rs[0]?.resultado})`);

    // 8. apresentação: colunas + ordenação + totais + agrupamento
    const def = getReport("despesas")!;
    const rows = await def.build(parseReportQuery({ ...spMes, cliente: client.id }));
    const pres = presentReport(def, rows, parsePresentation({ colunas: "descricao,valor", agrupar: "categoria", ordenar: "valor", dir: "desc" }));
    ok("10. colunas selecionadas (2)", pres.columns.length === 2, `(${pres.columns.map((c) => c.key).join(",")})`);
    ok("11. totais gerais valor 500", pres.totals.valor === 500, `(${pres.totals.valor})`);
    ok("12. agrupado com subtotal", pres.groups.length >= 1 && pres.groups[0].subtotals.valor != null, `(${pres.groups.length} grupos)`);

    // 9. visões salvas: isolamento por dono
    const view = await prisma.savedView.create({
      data: { name: `${TAG}visao`, module: "cobrancas", params: "status=OVERDUE", visibility: "GLOBAL", createdBy: owner },
    });
    ok("13. savedView ownerId injetado", (view as any).ownerId === owner);
  });

  if (other) {
    const leak = await runWithOwner(other.id, async () =>
      prisma.savedView.findMany({ where: { name: `${TAG}visao` } })
    );
    ok("14. savedView isolada de outro dono", leak.length === 0, `(${leak.length})`);
  }

  // --- limpeza ---
  await runWithOwner(owner, async () => {
    await prisma.savedView.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.income.deleteMany({ where: { description: { startsWith: TAG } } });
    await prisma.payment.deleteMany({ where: { billing: { description: { startsWith: TAG } } } });
    await prisma.billing.deleteMany({ where: { description: { startsWith: TAG } } });
    await prisma.transaction.deleteMany({ where: { description: { startsWith: TAG } } });
    await prisma.contract.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.service.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: TAG } } });
    console.log("15. limpeza: OK");
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
