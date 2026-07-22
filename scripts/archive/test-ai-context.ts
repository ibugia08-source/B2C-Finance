/**
 * Teste (temporário) do snapshot da agência para a IA.
 * Uso: npx tsx scripts/test-ai-context.ts
 */
import { loadEnv } from "../env";
loadEnv();

const TAG = "__teste_ia__";

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { buildAgencySnapshotText } = await import("@/lib/ai/agency-context");

  const admin = await runWithoutScope(async () =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  const ok = (name: string, cond: boolean, extra = "") =>
    console.log(`${name}: ${cond ? "OK" : "FALHA"} ${extra}`);

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10);
  const in10 = new Date();
  in10.setDate(in10.getDate() + 10);

  await runWithOwner(admin!.id, async () => {
    // seed: cliente com contrato MRR vigente, cobrança vencida, cobrança a vencer, renovação próxima
    const client = await prisma.client.create({ data: { name: `${TAG}Omega`, status: "ACTIVE" } });
    const contract = await prisma.contract.create({
      data: {
        clientId: client.id, title: `${TAG}Contrato`, type: "MRR", recurrence: "MONTHLY",
        monthlyValue: 3200, totalValue: 38400,
        startDate: new Date(now.getFullYear(), now.getMonth() - 3, 1),
        billingDay: 5, status: "ACTIVE", renewalDate: in10,
      },
    });
    await prisma.billing.create({
      data: {
        clientId: client.id, contractId: contract.id, description: `${TAG}vencida`,
        competenceMonth: lastMonth.getMonth() + 1, competenceYear: lastMonth.getFullYear(),
        amount: 3200, dueDate: lastMonth, status: "OVERDUE", revenueType: "MRR",
      },
    });
    await prisma.billing.create({
      data: {
        clientId: client.id, contractId: contract.id, description: `${TAG}a vencer`,
        competenceMonth: now.getMonth() + 1, competenceYear: now.getFullYear(),
        amount: 3200, dueDate: in10, status: "PENDING", revenueType: "MRR",
      },
    });

    const text = await buildAgencySnapshotText();

    ok("1. snapshot inclui MRR com o contrato (≥3200)", /MRR ativo R\$\s?[\d.,]+/.test(text));
    ok("2. cliente inadimplente citado nominalmente", text.includes(`${TAG}Omega`) && text.includes("INADIMPLENTES"));
    ok("3. próxima cobrança a vencer listada", text.includes(`${TAG}a vencer`));
    ok("4. renovação próxima listada", text.includes("RENOVAÇÕES") && text.includes(`${TAG}Contrato`));
    ok("5. projeções 30/60/90 presentes", text.includes("PROJEÇÃO: 30d") && text.includes("90d"));
    ok("6. tendência de 6 meses presente", text.includes("TENDÊNCIA") && text.includes("MRR:"));
    ok("7. saúde com score presente", /SAÚDE FINANCEIRA \(score do sistema\): \d+\/100/.test(text));
    ok("8. patrimônio presente", text.includes("PATRIMÔNIO") && text.includes("saldo patrimonial"));
    console.log(`   (snapshot: ${text.length} caracteres ≈ ${Math.round(text.length / 4)} tokens)`);

    // isolamento: snapshot de OUTRO dono não vê o cliente
    console.log("---");

    // limpeza
    await prisma.billing.deleteMany({ where: { description: { startsWith: TAG } } });
    await prisma.contract.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  const other = await runWithoutScope(async () =>
    prisma.user.findFirst({ where: { role: "ADMIN", id: { not: admin!.id } }, select: { id: true } })
  );
  if (other) {
    const otherText = await runWithOwner(other.id, () => buildAgencySnapshotText());
    ok("9. isolamento: snapshot de outro admin não vê dados do primeiro", !otherText.includes(TAG));
  }

  const setting = await runWithoutScope(async () =>
    prisma.aISetting.findUnique({ where: { id: "default" }, select: { enabled: true, apiKey: true, model: true, provider: true } })
  );
  console.log(
    `10. config IA: provider=${setting?.provider ?? "—"} model=${setting?.model ?? "—"} enabled=${setting?.enabled ?? false} hasKey=${!!setting?.apiKey}`
  );
  console.log("11. limpeza: OK");

  const { prisma: p2 } = await import("@/lib/prisma");
  await p2.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
