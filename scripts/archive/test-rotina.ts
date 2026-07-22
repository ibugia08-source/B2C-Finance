/**
 * Teste (temporário) da fila de cobrança priorizada e mensagens.
 * Uso: npx tsx scripts/test-rotina.ts
 */
import { loadEnv } from "../env";
loadEnv();

const TAG = "__teste_rot__";

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { runWithOwner, runWithoutScope } = await import("@/lib/auth/owner-scope");
  const { getCollectionQueue } = await import("@/lib/services/collection-priority");
  const { buildBillingMessage, TONE_LABEL } = await import("@/lib/billing-message");

  const admin = await runWithoutScope(async () =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  const ok = (name: string, cond: boolean, extra = "") =>
    console.log(`${name}: ${cond ? "OK" : "FALHA"} ${extra}`);

  const now = new Date();
  const daysAgo = (d: number) => {
    const x = new Date(now);
    x.setDate(x.getDate() - d);
    return x;
  };

  await runWithOwner(admin!.id, async () => {
    // Cliente A: ALTA — 70d de atraso, R$ 6.000, recorrente, renovação próxima, promessa vencida
    const a = await prisma.client.create({ data: { name: `${TAG}Alta Ltda`, status: "ACTIVE", phone: "71999990000" } });
    const contractA = await prisma.contract.create({
      data: {
        clientId: a.id, title: `${TAG}mrr A`, type: "MRR", recurrence: "MONTHLY",
        monthlyValue: 3000, totalValue: 36000, startDate: daysAgo(200), billingDay: 5,
        status: "ACTIVE", renewalDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 10),
      },
    });
    const billA = await prisma.billing.create({
      data: {
        clientId: a.id, contractId: contractA.id, description: `${TAG}A vencida`,
        competenceMonth: 1, competenceYear: now.getFullYear(),
        amount: 6000, dueDate: daysAgo(70), status: "OVERDUE", revenueType: "MRR",
      },
    });
    await prisma.collectionHistory.create({
      data: {
        billingId: billA.id, clientId: a.id, status: "PROMISED",
        message: "prometeu pagar", nextActionAt: daysAgo(5), contactedAt: daysAgo(8),
      },
    });

    // Cliente B: BAIXA — 3d de atraso, R$ 300, avulso, sem histórico
    const b = await prisma.client.create({ data: { name: `${TAG}Baixa ME`, status: "ACTIVE" } });
    await prisma.billing.create({
      data: {
        clientId: b.id, description: `${TAG}B vencida`,
        competenceMonth: now.getMonth() + 1, competenceYear: now.getFullYear(),
        amount: 300, dueDate: daysAgo(3), status: "OVERDUE", revenueType: "ONE_TIME",
      },
    });

    const queue = await getCollectionQueue();
    const qa = queue.find((q) => q.clientName === `${TAG}Alta Ltda`);
    const qb = queue.find((q) => q.clientName === `${TAG}Baixa ME`);

    ok("1. fila contém os 2 clientes", !!qa && !!qb);
    ok("2. cliente A classificado ALTA", qa?.priority === "alta", `(score ${qa?.score})`);
    ok("3. cliente B classificado BAIXA", qb?.priority === "baixa", `(score ${qb?.score})`);
    ok("4. A vem antes de B (ordenado por score)", queue.indexOf(qa!) < queue.indexOf(qb!));
    ok("5. promessa vencida detectada em A", qa?.promise?.broken === true);
    ok("6. motivos legíveis presentes", (qa?.reasons.length ?? 0) >= 4, `(${qa?.reasons.join(" · ")})`);
    ok("7. tom sugerido p/ A é última tentativa (70d)", qa?.suggestedTone === "ultima_tentativa", `(${qa?.suggestedTone})`);
    ok("8. cobrança-âncora de A com valor 6000", qa?.anchorBilling.openAmount === 6000);
    ok("9. recorrente/renovação/valor marcados em A", qa?.recurring === true && qa?.renewalSoon === true);

    // mensagens: 6 tons com variáveis
    const input = {
      clientName: `${TAG}Alta Ltda`, openAmount: "R$ 6.000,00", dueDate: "01/05/2026",
      daysOverdue: 70, serviceNames: ["Gestão de tráfego"], hasPromise: true, contactCount: 3,
      paymentInfo: "PIX chave financeiro@b2c.com",
    };
    const tones = Object.keys(TONE_LABEL) as (keyof typeof TONE_LABEL)[];
    const msgs = tones.map((t) => buildBillingMessage(t as any, input));
    ok("10. 6 tons geram mensagem", tones.length === 6 && msgs.every((m) => m.length > 50), `(${tones.join(", ")})`);
    ok("11. variáveis presentes (valor, dias, serviço, PIX)",
      msgs.every((m) => m.includes("R$ 6.000,00")) &&
      msgs.some((m) => m.includes("70 dias")) &&
      msgs.every((m) => m.includes("Gestão de tráfego")) &&
      msgs.filter((m) => m.includes("PIX chave financeiro@b2c.com")).length >= 5);
    const ultima = buildBillingMessage("ultima_tentativa", input);
    ok("12. última tentativa menciona suspensão e tentativas",
      ultima.includes("suspensos") && ultima.includes("3 tentativas"));

    // registrar contato hoje → item marcado contactedToday
    await prisma.collectionHistory.create({
      data: { billingId: billA.id, clientId: a.id, status: "CONTACTED", message: "cobrado via whatsapp" },
    });
    const queue2 = await getCollectionQueue();
    ok("13. contato de hoje marca 'contactedToday'",
      queue2.find((q) => q.clientId === a.id)?.contactedToday === true);

    // limpeza
    await prisma.collectionHistory.deleteMany({ where: { clientId: { in: [a.id, b.id] } } });
    await prisma.billing.deleteMany({ where: { description: { startsWith: TAG } } });
    await prisma.contract.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: TAG } } });
    console.log("14. limpeza: OK");
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
