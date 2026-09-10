import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  revertBillingPayment, settleBillingPayment,
} from "@/lib/services/payment-accounting";
import { applyCredit, reconcileCredit } from "@/lib/services/customer-credit";
import { revertPayment } from "@/lib/engines/payment-engine";
import { toNumber as n } from "@/lib/format";

/**
 * ESTORNO SEM PONTA SOLTA — o que "excluir um recebimento" tem de desfazer.
 *
 * O gesto da Gestão do Mês ("excluir pagamento recebido por engano") só é
 * seguro se o estorno reverter TUDO o que o pagamento sustentava:
 *
 *  1. a régua de cobrança — collectionStatus não pode continuar PAID numa
 *     cobrança que voltou a dever;
 *  2. o crédito do excedente (F1.8) — o cache CustomerCredit.balance não
 *     tem FK com o pagamento e viraria crédito fantasma;
 *  3. as cobranças IRMÃS que receberam crédito deste pagamento — a
 *     aplicação some na cascata do delete e o saldo delas precisa reabrir;
 *  4. o fechamento — estornar tira dinheiro do caixa do mês em que ele
 *     entrou; mês fechado recusa, com instrução de reabrir.
 */
describe("estorno de pagamento — consistência completa", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await runWithoutScope(async () =>
      prisma.closingPeriod.deleteMany({ where: { competence: "2031-06" } })
    );
    await destroyOwner(dono);
  });

  const pay = (billingId: string, amount: number, paidAt: Date) =>
    settleBillingPayment({
      billingId, amount, paidAt, method: "PIX", accountId: null, notes: null,
    });

  it("régua de cobrança reabre: collectionStatus PAID volta a NOT_CONTACTED", async () => {
    const c = await createMrrClient(dono, { name: "Régua reaberta" });
    const cob = await createBilling(dono, c.id, { month: 5, year: 2031, amount: 800 });

    await asOwner(dono, async () => {
      const r = await pay(cob.id, 800, new Date(2031, 4, 5));
      expect(r.ok).toBe(true);
    });
    const paga = await asOwner(dono, async () =>
      await prisma.billing.findUniqueOrThrow({ where: { id: cob.id } })
    );
    expect(paga.collectionStatus).toBe("PAID");

    const pagamento = await asOwner(dono, async () =>
      await prisma.payment.findFirstOrThrow({ where: { billingId: cob.id } })
    );
    await asOwner(dono, async () => {
      const r = await revertBillingPayment(pagamento.id);
      expect(r.ok).toBe(true);
    });

    const reaberta = await asOwner(dono, async () =>
      await prisma.billing.findUniqueOrThrow({ where: { id: cob.id } })
    );
    expect(reaberta.status).toBe("PENDING"); // vence em 2031 — ainda não é vencida
    expect(reaberta.collectionStatus).toBe("NOT_CONTACTED");
    expect(n(reaberta.paidTotal)).toBe(0);
  });

  it("crédito do excedente é devolvido no estorno — sem crédito fantasma", async () => {
    const c = await createMrrClient(dono, { name: "Crédito devolvido" });
    const cob = await createBilling(dono, c.id, { month: 5, year: 2031, amount: 1000 });

    // Paga 1200 numa cobrança de 1000 → 200 viram crédito (F1.8).
    await asOwner(dono, async () => {
      const r = await pay(cob.id, 1200, new Date(2031, 4, 5));
      expect(r.ok).toBe(true);
      expect((r as any).creditGenerated).toBe(200);
    });
    const antes = await asOwner(dono, async () => await reconcileCredit(c.id));
    expect(antes.cache).toBe(200);
    expect(antes.bate).toBe(true);

    const pagamento = await asOwner(dono, async () =>
      await prisma.payment.findFirstOrThrow({ where: { billingId: cob.id } })
    );
    await asOwner(dono, async () => {
      const r = await revertBillingPayment(pagamento.id);
      expect(r.ok).toBe(true);
    });

    // O pagamento sumiu; o cache tem de acompanhar a conta derivada (0).
    const depois = await asOwner(dono, async () => await reconcileCredit(c.id));
    expect(depois.real).toBe(0);
    expect(depois.cache).toBe(0);
    expect(depois.bate).toBe(true);

    // E com história: a SAÍDA do estorno fica registrada, não só o IN.
    const movimentos = await asOwner(dono, async () =>
      await prisma.customerCreditMovement.findMany({
        where: { sourcePaymentId: pagamento.id },
        orderBy: { createdAt: "asc" },
      })
    );
    expect(movimentos.map((m) => m.kind)).toEqual(["IN", "OUT"]);
    expect(n(movimentos[1].amount)).toBe(200);
  });

  it("cobrança irmã que recebeu crédito do pagamento reabre junto", async () => {
    const c = await createMrrClient(dono, { name: "Crédito aplicado e estornado" });
    const cobA = await createBilling(dono, c.id, { month: 5, year: 2031, amount: 1000 });
    const cobB = await createBilling(dono, c.id, { month: 6, year: 2031, amount: 400 });

    await asOwner(dono, async () => {
      // 1500 na cobrança de 1000 → 500 de crédito…
      expect((await pay(cobA.id, 1500, new Date(2031, 4, 5))).ok).toBe(true);
      // …e 400 do crédito quitam a cobrança B.
      const ap = await applyCredit({ billingId: cobB.id });
      expect(ap.ok).toBe(true);
      expect((ap as any).applied).toBe(400);
    });

    const bPaga = await asOwner(dono, async () =>
      await prisma.billing.findUniqueOrThrow({ where: { id: cobB.id } })
    );
    expect(bPaga.status).toBe("PAID");

    const pagamento = await asOwner(dono, async () =>
      await prisma.payment.findFirstOrThrow({ where: { billingId: cobA.id } })
    );
    await asOwner(dono, async () => {
      const r = await revertBillingPayment(pagamento.id);
      expect(r.ok).toBe(true);
    });

    // A: reaberta. B: a aplicação sumiu na cascata — o saldo TEM de reabrir
    // junto, senão fica "paga" com um dinheiro que deixou de existir.
    const [a, b] = await asOwner(dono, async () => [
      await prisma.billing.findUniqueOrThrow({ where: { id: cobA.id } }),
      await prisma.billing.findUniqueOrThrow({ where: { id: cobB.id } }),
    ]);
    expect(n(a.paidTotal)).toBe(0);
    expect(a.status).toBe("PENDING");
    expect(n(b.paidTotal)).toBe(0);
    expect(b.status).toBe("PENDING");
    expect(b.collectionStatus).toBe("NOT_CONTACTED");
    expect(b.paidAt).toBeNull();

    // paidTotal = Σ aplicações nas duas, e o crédito zera de ponta a ponta.
    const rec = await asOwner(dono, async () => await reconcileCredit(c.id));
    expect(rec.real).toBe(0);
    expect(rec.cache).toBe(0);
    expect(rec.bate).toBe(true);

    // O rastro existe: a irmã ganhou linha na régua explicando o porquê.
    const historia = await asOwner(dono, async () =>
      await prisma.collectionHistory.findMany({ where: { billingId: cobB.id } })
    );
    expect(historia.some((h) => h.message?.includes("Estorno de pagamento"))).toBe(true);
  });

  it("mês do caixa FECHADO recusa o estorno e nada muda; reaberto, estorna", async () => {
    const c = await createMrrClient(dono, { name: "Estorno em mês fechado" });
    const cob = await createBilling(dono, c.id, { month: 6, year: 2031, amount: 700 });
    await asOwner(dono, async () => {
      expect((await pay(cob.id, 700, new Date(2031, 5, 8))).ok).toBe(true);
    });
    const pagamento = await asOwner(dono, async () =>
      await prisma.payment.findFirstOrThrow({ where: { billingId: cob.id } })
    );

    const ws = await runWithoutScope(async () =>
      (await prisma.workspace.findFirstOrThrow({ select: { id: true } })).id
    );
    await runWithoutScope(async () =>
      prisma.closingPeriod.create({
        data: {
          workspaceId: ws, scopeType: "WORKSPACE", scopeId: "",
          competence: "2031-06", state: "CLOSED",
          closedAt: new Date(), closedBy: "teste",
        },
      })
    );

    const recusa = await asOwner(dono, async () =>
      await revertPayment(pagamento.id, "teste de mês fechado")
    );
    expect(recusa.ok).toBe(false);
    expect((recusa as any).error).toContain("está fechado");
    // Recusa não é meia-execução: a cobrança segue paga, o caixa intacto.
    const intocada = await asOwner(dono, async () =>
      await prisma.billing.findUniqueOrThrow({ where: { id: cob.id } })
    );
    expect(intocada.status).toBe("PAID");

    await runWithoutScope(async () =>
      prisma.closingPeriod.deleteMany({ where: { competence: "2031-06" } })
    );
    const ok = await asOwner(dono, async () =>
      await revertPayment(pagamento.id, "reaberto — agora pode")
    );
    expect(ok.ok).toBe(true);
  });
});
