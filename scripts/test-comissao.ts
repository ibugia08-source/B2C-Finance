/**
 * Teste (temporário) do fluxo de comissões na folha.
 * Uso: npx tsx scripts/test-comissao.ts
 */
import { loadEnv } from "./env";
loadEnv();

const TAG = "__teste_com__";
const MONTH = 2;
const YEAR = 2099;

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");

  const admin = await runWithoutScope(async () =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  const ok = (name: string, cond: boolean, extra = "") =>
    console.log(`${name}: ${cond ? "OK" : "FALHA"} ${extra}`);

  await runWithOwner(admin!.id, async () => {
    // Replica a lógica interna de ensurePayroll (a action exige sessão/cookies).
    const ensure = async () => {
      let run = await prisma.payroll.findFirst({ where: { month: MONTH, year: YEAR } });
      if (!run) run = await prisma.payroll.create({ data: { month: MONTH, year: YEAR } });
      if (run.status === "DRAFT") {
        const [employees, existing] = await Promise.all([
          prisma.employee.findMany({ where: { active: true, name: { startsWith: TAG } } }),
          prisma.payrollItem.findMany({
            where: { payrollId: run.id, kind: "SALARY" },
            select: { employeeId: true },
          }),
        ]);
        const has = new Set(existing.map((e) => e.employeeId));
        const rows = employees
          .filter((e) => !has.has(e.id) && Number(e.baseSalary) > 0)
          .map((e) => ({
            payrollId: run!.id, employeeId: e.id, kind: "SALARY" as const,
            amount: e.baseSalary, notes: "Salário base",
          }));
        if (rows.length) await prisma.payrollItem.createMany({ data: rows });
      }
      if (run.status !== "PAID") {
        const pending = await prisma.commission.findMany({
          where: { month: MONTH, year: YEAR, status: "PENDING" },
          include: { client: { select: { name: true } } },
        });
        for (const c of pending) {
          await prisma.$transaction([
            prisma.payrollItem.create({
              data: {
                payrollId: run.id, employeeId: c.employeeId, kind: "COMMISSION",
                amount: c.amount,
                notes: [c.client?.name ? `Comissão — ${c.client.name}` : "Comissão", c.notes]
                  .filter(Boolean).join(" · "),
              },
            }),
            prisma.commission.update({ where: { id: c.id }, data: { status: "APPROVED" } }),
          ]);
        }
      }
      return run;
    };

    // seed
    const emp = await prisma.employee.create({
      data: { name: `${TAG}Vendedora`, type: "PJ", baseSalary: 2000, active: true },
    });
    const client = await prisma.client.create({ data: { name: `${TAG}ClienteX`, status: "ACTIVE" } });

    // comissão por base × percentual: 5000 × 10% = 500
    await prisma.commission.create({
      data: {
        employeeId: emp.id, clientId: client.id, month: MONTH, year: YEAR,
        basisAmount: 5000, rate: 0.1, amount: 500, notes: "venda tráfego",
      },
    });

    // 1. gerar folha → salário + comissão
    const run = await ensure();
    let items = await prisma.payrollItem.findMany({ where: { payrollId: run.id } });
    const total = items.reduce((s, i) => s + Number(i.amount) * (i.kind === "DEDUCTION" ? -1 : 1), 0);
    ok("1. folha com salário + comissão (2 itens)", items.length === 2, `(${items.length})`);
    ok("2. total calculado 2500 (2000 + 500)", total === 2500, `(${total})`);
    const comItem = items.find((i) => i.kind === "COMMISSION");
    ok("3. item de comissão com nota do cliente", !!comItem?.notes?.includes(`${TAG}ClienteX`), `(${comItem?.notes})`);

    // 2. idempotência: gerar de novo não duplica
    await ensure();
    items = await prisma.payrollItem.findMany({ where: { payrollId: run.id } });
    ok("4. atualizar de novo não duplica", items.length === 2, `(${items.length})`);
    const c1 = await prisma.commission.findFirst({ where: { employeeId: emp.id } });
    ok("5. comissão marcada como APPROVED (na folha)", c1?.status === "APPROVED");

    // 3. nova comissão depois da geração → atualizar puxa só a nova
    await prisma.commission.create({
      data: { employeeId: emp.id, month: MONTH, year: YEAR, amount: 150, notes: "bônus meta" },
    });
    await ensure();
    items = await prisma.payrollItem.findMany({ where: { payrollId: run.id } });
    const total2 = items.reduce((s, i) => s + Number(i.amount) * (i.kind === "DEDUCTION" ? -1 : 1), 0);
    ok("6. nova comissão entra ao atualizar (3 itens, total 2650)", items.length === 3 && total2 === 2650, `(${items.length}/${total2})`);

    // 4. pagar folha → comissões APPROVED viram PAID
    await prisma.$transaction([
      prisma.payroll.update({ where: { id: run.id }, data: { status: "PAID", paidAt: new Date() } }),
      prisma.commission.updateMany({
        where: { month: MONTH, year: YEAR, status: "APPROVED" },
        data: { status: "PAID", paidAt: new Date() },
      }),
    ]);
    const paid = await prisma.commission.count({ where: { month: MONTH, year: YEAR, status: "PAID" } });
    ok("7. ao pagar a folha, comissões ficam PAGAS", paid === 2, `(${paid})`);

    // limpeza
    await prisma.payrollItem.deleteMany({ where: { payrollId: run.id } });
    await prisma.payroll.deleteMany({ where: { month: MONTH, year: YEAR } });
    await prisma.commission.deleteMany({ where: { employeeId: emp.id } });
    await prisma.employee.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: TAG } } });
    console.log("8. limpeza: OK");
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
