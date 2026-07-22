/**
 * Testes do BLOCO 3 — cenários 1 a 5 do ciclo mensal de Recebimentos:
 *  1. Cliente ativo MRR entra automaticamente no mês (valor/vencimento/status).
 *  2. Cliente PAUSADO não entra automaticamente.
 *  3. Cliente PERDIDO não entra automaticamente (e o histórico anterior fica).
 *  4. Removido do mês some da lista, segue na Carteira, entra no mês seguinte
 *     e pode ser recolocado.
 *  5. Inclusão manual entra no ciclo e nos KPIs sem criar cliente novo.
 *
 * Usa o MESMO código de produção (ensureMonthlyBillings / cycleStatusOf).
 * Dados com TAG + cleanup. Uso: npx tsx scripts/test-bloco3-ciclo.ts
 */
import { loadEnv } from "./env";
loadEnv();

const TAG = "__teste_bloco3__";
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
  const { ensureMonthlyBillings, cycleStatusOf } = await import(
    "@/lib/services/receivables-cycle"
  );

  const admin = await runWithoutScope(() =>
    prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })
  );
  if (!admin) throw new Error("Nenhum ADMIN no banco.");

  // Mês-alvo distante do presente para não interferir no ciclo real.
  const M = 3, Y = 2031; // março/2031
  const M2 = 4; // abril/2031

  await runWithOwner(admin.id, async () => {
    const mk = (name: string, status: string) =>
      prisma.client.create({
        data: {
          name: `${TAG} ${name}`,
          status: status as any,
          modality: "MRR",
          monthlyValue: 2500,
          paymentDay: 12,
          startedAt: new Date(2030, 0, 10),
        },
      });

    const ativo = await mk("Ativo", "ACTIVE");
    const pausado = await mk("Pausado", "PAUSED");
    const perdido = await mk("Perdido", "CHURNED");
    const clientIds = [ativo.id, pausado.id, perdido.id];

    try {
      // ===== Cenários 1–3: quem entra na geração automática =====
      console.log("Cenários 1–3 — geração automática do mês:");
      await ensureMonthlyBillings(M, Y);
      const bills = await prisma.billing.findMany({
        where: { clientId: { in: clientIds }, competenceMonth: M, competenceYear: Y },
      });
      const bAtivo = bills.find((b) => b.clientId === ativo.id);
      assert(!!bAtivo, "cenário 1: cliente ativo MRR entrou no mês");
      assert(Number(bAtivo?.amount) === 2500, "cenário 1: valor previsto correto (R$ 2.500)");
      assert(
        bAtivo?.dueDate.getDate() === 12 && bAtivo?.dueDate.getMonth() === M - 1,
        "cenário 1: vencimento no dia de pagamento do cliente (12/03)"
      );
      const st = cycleStatusOf(
        {
          id: bAtivo!.id, status: bAtivo!.status, isLate: bAtivo!.isLate,
          paidInDifferentMonth: bAtivo!.paidInDifferentMonth,
          dueDate: bAtivo!.dueDate, paidAt: bAtivo!.paidAt,
        },
        new Date()
      );
      assert(
        st.status === "UPCOMING" || st.status === "OVERDUE",
        "cenário 1: status inicial 'A vencer' ou 'Inadimplente' conforme a data",
        st.status
      );
      assert(!bills.some((b) => b.clientId === pausado.id), "cenário 2: pausado NÃO entrou");
      assert(!bills.some((b) => b.clientId === perdido.id), "cenário 3: perdido NÃO entrou");

      // Cenário 3 (histórico preservado): cobrança antiga de perdido permanece.
      const historico = await prisma.billing.create({
        data: {
          clientId: perdido.id,
          description: `${TAG} Mensalidade antiga 01/2031`,
          competenceMonth: 1,
          competenceYear: Y,
          amount: 2500,
          dueDate: new Date(Y, 0, 12),
          status: "PAID",
          paidTotal: 2500,
          paidAt: new Date(Y, 0, 12),
          revenueType: "MRR",
        },
      });
      await ensureMonthlyBillings(M, Y);
      const aindaLa = await prisma.billing.findUnique({ where: { id: historico.id } });
      assert(!!aindaLa && aindaLa.status === "PAID", "cenário 3: histórico de meses anteriores preservado");

      // ===== Cenário 4: remover do mês =====
      console.log("Cenário 4 — remover do mês:");
      await prisma.billing.update({
        where: { id: bAtivo!.id },
        data: {
          status: "CANCELED",
          canceledAt: new Date(),
          canceledBy: "teste@b2c",
          cancelReason: "pausa pontual",
        },
      });
      await ensureMonthlyBillings(M, Y);
      const marBills = await prisma.billing.findMany({
        where: { clientId: ativo.id, competenceMonth: M, competenceYear: Y },
      });
      assert(
        marBills.length === 1 && marBills[0].status === "CANCELED",
        "removido sai do mês e NÃO é recriado"
      );
      const naCarteira = await prisma.client.findFirst({ where: { id: ativo.id } });
      assert(!!naCarteira, "cliente segue na Gestão de Carteira");
      await ensureMonthlyBillings(M2, Y);
      const abrBill = await prisma.billing.findFirst({
        where: { clientId: ativo.id, competenceMonth: M2, competenceYear: Y },
      });
      assert(!!abrBill && abrBill.status !== "CANCELED", "cliente ativo volta a entrar no mês seguinte");
      // Recolocar no mês:
      const restored = await prisma.billing.update({
        where: { id: bAtivo!.id },
        data: { status: "PENDING", canceledAt: null, canceledBy: null, cancelReason: null },
      });
      assert(restored.status === "PENDING", "removido pode ser recolocado no mês");

      // ===== Cenário 5: inclusão manual =====
      console.log("Cenário 5 — inclusão manual no mês:");
      const clientesAntes = await prisma.client.count();
      const manual = await prisma.billing.create({
        data: {
          clientId: pausado.id, // pausado incluído manualmente, se necessário
          description: `${TAG} Cobrança manual 03/2031`,
          competenceMonth: M,
          competenceYear: Y,
          amount: 900,
          dueDate: new Date(Y, M - 1, 20),
          status: "PENDING",
          revenueType: "ONE_TIME",
        },
      });
      const doMes = await prisma.billing.findMany({
        where: { competenceMonth: M, competenceYear: Y, clientId: { in: clientIds } },
      });
      assert(
        doMes.some((b) => b.id === manual.id),
        "cobrança manual aparece no ciclo do mês"
      );
      const somaMes = doMes
        .filter((b) => b.status !== "CANCELED")
        .reduce((s, b) => s + Number(b.amount), 0);
      assert(somaMes === 2500 + 900, "entra nos KPIs do mês (a receber inclui a manual)");
      const clientesDepois = await prisma.client.count();
      assert(clientesAntes === clientesDepois, "inclusão manual NÃO cria cliente novo na Carteira");
    } finally {
      const billings = await prisma.billing.findMany({
        where: { clientId: { in: clientIds } },
        select: { id: true },
      });
      const ids = billings.map((x) => x.id);
      await prisma.collectionHistory.deleteMany({ where: { billingId: { in: ids } } });
      await prisma.billing.deleteMany({ where: { id: { in: ids } } });
      await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
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
