import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  settleBillingPayment,
  revertBillingPayment,
} from "@/lib/services/payment-accounting";
import {
  prisma, runWithoutScope, createOwner, destroyOwner,
  createMrrClient, createBilling, asOwner, type TestOwner,
} from "./support/db";

/**
 * REVERSÃO DE PAGAMENTO (o "Desfazer" da tela) — ref. 01 §3.3.
 * Na Fase 1 isto vira evento compensatório; aqui, a rede que garante que o
 * saldo, o status e a conciliação de caixa voltam exatamente ao estado anterior.
 */

let owner: TestOwner;
let clientId: string;

beforeAll(async () => {
  owner = await createOwner();
  clientId = (await createMrrClient(owner)).id;
});
afterAll(async () => {
  await destroyOwner(owner);
});

const settle = (billingId: string, amount: number, paidAt: Date) =>
  asOwner(owner, async () =>
    settleBillingPayment({ billingId, amount, paidAt, method: "PIX", accountId: null, notes: null })
  );

const readBilling = (id: string) =>
  runWithoutScope(async () =>
    prisma.billing.findUniqueOrThrow({
      where: { id },
      select: { status: true, paidTotal: true, paidAt: true, isLate: true, paidInDifferentMonth: true },
    })
  );

describe("revertBillingPayment", () => {
  it("devolve a cobrança quitada ao estado em aberto e apaga o caixa", async () => {
    const b = await createBilling(owner, clientId, {
      month: 3, year: 2026, amount: 1000, dueDate: new Date(2026, 2, 10),
    });
    const paid = await settle(b.id, 1000, new Date(2026, 2, 8));
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;

    const res = await asOwner(owner, async () => revertBillingPayment(paid.paymentId));
    expect(res.ok).toBe(true);

    const billing = await readBilling(b.id);
    expect(Number(billing.paidTotal)).toBe(0);
    expect(billing.paidAt).toBeNull();
    expect(billing.isLate).toBe(false);
    expect(billing.paidInDifferentMonth).toBe(false);
    // Vencimento 10/03/2026 já passou → volta como vencida, não como pendente.
    expect(billing.status).toBe("OVERDUE");

    const [payments, incomes] = await runWithoutScope(async () =>
      Promise.all([
        prisma.payment.count({ where: { billingId: b.id } }),
        prisma.income.count({ where: { billingId: b.id } }),
      ])
    );
    expect(payments).toBe(0);
    expect(incomes).toBe(0);
  });

  it("desfaz apenas o pagamento pedido quando há dois parciais iguais no mesmo dia", async () => {
    const b = await createBilling(owner, clientId, {
      month: 4, year: 2026, amount: 1000, dueDate: new Date(2026, 3, 10),
    });
    const dia = new Date(2026, 3, 5);
    const p1 = await settle(b.id, 300, dia);
    const p2 = await settle(b.id, 300, dia);
    expect(p1.ok && p2.ok).toBe(true);
    if (!p1.ok || !p2.ok) return;

    await asOwner(owner, async () => revertBillingPayment(p1.paymentId));

    const billing = await readBilling(b.id);
    expect(Number(billing.paidTotal)).toBe(300); // sobrou o segundo
    expect(billing.status).toBe("PARTIAL");

    const incomes = await runWithoutScope(async () =>
      prisma.income.findMany({ where: { billingId: b.id }, select: { paymentId: true } })
    );
    expect(incomes).toHaveLength(1);
    expect(incomes[0].paymentId).toBe(p2.paymentId); // a conciliação certa sobreviveu
  });

  it("reverter parcial de cobrança quitada volta para PARTIAL", async () => {
    const b = await createBilling(owner, clientId, {
      month: 5, year: 2026, amount: 1000, dueDate: new Date(2026, 4, 10),
    });
    const p1 = await settle(b.id, 400, new Date(2026, 4, 5));
    const p2 = await settle(b.id, 600, new Date(2026, 4, 6));
    expect((await readBilling(b.id)).status).toBe("PAID");
    if (!p1.ok || !p2.ok) return;

    await asOwner(owner, async () => revertBillingPayment(p2.paymentId));
    const billing = await readBilling(b.id);
    expect(Number(billing.paidTotal)).toBe(400);
    expect(billing.status).toBe("PARTIAL");
    expect(billing.paidAt).toBeNull();
  });

  it("pagamento inexistente devolve erro, não exceção", async () => {
    const res = await asOwner(owner, async () => revertBillingPayment("nao-existe"));
    expect(res.ok).toBe(false);
  });

  it("ciclo pagar → desfazer → pagar de novo deixa o saldo consistente", async () => {
    const b = await createBilling(owner, clientId, {
      month: 6, year: 2026, amount: 750, dueDate: new Date(2026, 5, 10),
    });
    const first = await settle(b.id, 750, new Date(2026, 5, 8));
    if (!first.ok) throw new Error("primeiro pagamento falhou");
    await asOwner(owner, async () => revertBillingPayment(first.paymentId));
    const second = await settle(b.id, 750, new Date(2026, 5, 9));
    expect(second.ok).toBe(true);

    const billing = await readBilling(b.id);
    expect(Number(billing.paidTotal)).toBe(750); // não somou 1.500
    expect(billing.status).toBe("PAID");
    const incomes = await runWithoutScope(async () =>
      prisma.income.count({ where: { billingId: b.id } })
    );
    expect(incomes).toBe(1);
  });
});
