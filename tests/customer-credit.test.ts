import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import { settleBillingPayment } from "@/lib/services/payment-accounting";
import { applyCredit, creditBalance, reconcileCredit } from "@/lib/services/customer-credit";
import { toNumber as n } from "@/lib/format";

/**
 * F1.8 — excedente vira crédito e crédito abate cobrança futura
 * (01 §3.12; 02 §1).
 *
 * O invariante que sustenta tudo:
 *     crédito = Σ pagamentos do cliente − Σ aplicações desses pagamentos
 * Ou seja: o dinheiro entra UMA vez e é aplicado até acabar. Usar crédito
 * não cria pagamento novo — se criasse, o mesmo dinheiro apareceria duas
 * vezes no caixa.
 */
const pay = (billingId: string, amount: number, paidAt: Date) =>
  settleBillingPayment({ billingId, amount, paidAt, method: "PIX", accountId: null, notes: null });

describe("F1.8 — crédito do cliente", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("pagar a mais gera crédito com a história de onde veio", async () => {
    const cliente = await createMrrClient(dono, { name: "Pagou a mais" });
    const cob = await createBilling(dono, cliente.id, { month: 1, year: 2026, amount: 500 });

    const r: any = await asOwner(dono, async () => pay(cob.id, 800, new Date(2026, 0, 5)));
    expect(r.ok).toBe(true);
    expect(r.creditGenerated).toBe(300);

    const saldo = await asOwner(dono, async () => creditBalance(cliente.id));
    expect(saldo).toBe(300);

    const movs = await asOwner(dono, async () =>
      prisma.customerCreditMovement.findMany({ where: { credit: { clientId: cliente.id } } })
    );
    expect(movs).toHaveLength(1);
    expect(movs[0].kind).toBe("IN");
    expect(n(movs[0].amount)).toBe(300);
    expect(movs[0].sourcePaymentId).toBe(r.paymentId);
  });

  it("o crédito abate a cobrança seguinte SEM criar pagamento novo", async () => {
    const cliente = await createMrrClient(dono, { name: "Usa o crédito" });
    const jan = await createBilling(dono, cliente.id, { month: 1, year: 2026, amount: 500 });
    const fev = await createBilling(dono, cliente.id, { month: 2, year: 2026, amount: 500 });

    await asOwner(dono, async () => pay(jan.id, 800, new Date(2026, 0, 5)));

    const antes = await asOwner(dono, async () =>
      prisma.payment.count({ where: { billing: { clientId: cliente.id } } })
    );

    const res: any = await asOwner(dono, async () => applyCredit({ billingId: fev.id }));
    expect(res.ok).toBe(true);
    expect(res.applied).toBe(300);

    // NENHUM pagamento novo: o dinheiro já tinha entrado em janeiro.
    const depois = await asOwner(dono, async () =>
      prisma.payment.count({ where: { billing: { clientId: cliente.id } } })
    );
    expect(depois).toBe(antes);

    const b = await asOwner(dono, async () =>
      prisma.billing.findUniqueOrThrow({ where: { id: fev.id } })
    );
    expect(n(b.paidTotal)).toBe(300);
    expect(b.status).toBe("PARTIAL");

    const saldo = await asOwner(dono, async () => creditBalance(cliente.id));
    expect(saldo).toBe(0);
  });

  it("o cache do saldo bate com a conta real", async () => {
    const cliente = await createMrrClient(dono, { name: "Cache confere" });
    const cob = await createBilling(dono, cliente.id, { month: 3, year: 2026, amount: 200 });
    await asOwner(dono, async () => pay(cob.id, 350, new Date(2026, 2, 4)));

    const c = await asOwner(dono, async () => reconcileCredit(cliente.id));
    expect(c.real).toBe(150);
    expect(c.cache).toBe(150);
    expect(c.bate).toBe(true);
  });

  it("sem crédito, aplicar não inventa dinheiro", async () => {
    const cliente = await createMrrClient(dono, { name: "Sem crédito" });
    const cob = await createBilling(dono, cliente.id, { month: 4, year: 2026, amount: 300 });
    const res: any = await asOwner(dono, async () => applyCredit({ billingId: cob.id }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/não tem crédito/i);
  });

  it("não aplica crédito em cobrança já quitada", async () => {
    const cliente = await createMrrClient(dono, { name: "Já quitada" });
    const a = await createBilling(dono, cliente.id, { month: 5, year: 2026, amount: 100 });
    const b = await createBilling(dono, cliente.id, { month: 6, year: 2026, amount: 100 });
    await asOwner(dono, async () => pay(a.id, 250, new Date(2026, 4, 3)));
    await asOwner(dono, async () => pay(b.id, 100, new Date(2026, 5, 3)));

    const res: any = await asOwner(dono, async () => applyCredit({ billingId: b.id }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/já está quitada/i);
  });
});
