import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { settleBillingPayment } from "@/lib/services/payment-accounting";
import {
  prisma,
  runWithoutScope,
  createOwner,
  destroyOwner,
  createMrrClient,
  createBilling,
  asOwner,
  type TestOwner,
} from "./support/db";

/**
 * PAGAMENTO: as três situações do fechamento mensal — ref. 01 §3.3.
 * Rede de proteção do código ATUAL, antes do PaymentEngine da Fase 1.
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
    settleBillingPayment({
      billingId,
      amount,
      paidAt,
      method: "PIX",
      accountId: null,
      notes: null,
    })
  );

const readBilling = (id: string) =>
  runWithoutScope(async () =>
    prisma.billing.findUniqueOrThrow({
      where: { id },
      select: {
        status: true, paidTotal: true, paidAt: true,
        isLate: true, paidInDifferentMonth: true,
      },
    })
  );

const readIncomes = (billingId: string) =>
  runWithoutScope(async () =>
    prisma.income.findMany({
      where: { billingId },
      select: { amount: true, revenueType: true, receivedAt: true, paymentId: true },
    })
  );

describe("settleBillingPayment — situação 1: pago no prazo", () => {
  it("quita, não marca atraso e concilia o caixa na competência", async () => {
    const b = await createBilling(owner, clientId, {
      month: 3, year: 2026, amount: 1000, dueDate: new Date(2026, 2, 10),
    });
    const res = await settle(b.id, 1000, new Date(2026, 2, 8)); // 08/03, antes do vencimento

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fullyPaid).toBe(true);
    expect(res.isLate).toBe(false);
    expect(res.paidInDifferentMonth).toBe(false);

    const billing = await readBilling(b.id);
    expect(billing.status).toBe("PAID");
    expect(Number(billing.paidTotal)).toBe(1000);
    expect(billing.isLate).toBe(false);
    expect(billing.paidInDifferentMonth).toBe(false);

    const incomes = await readIncomes(b.id);
    expect(incomes).toHaveLength(1);
    expect(Number(incomes[0].amount)).toBe(1000);
    expect(incomes[0].revenueType).toBe("MRR"); // competência, não recuperação
    expect(incomes[0].paymentId).toBe(res.paymentId);
  });
});

describe("settleBillingPayment — situação 2: pago com atraso, no mesmo mês", () => {
  it("marca isLate mas continua contando na competência", async () => {
    const b = await createBilling(owner, clientId, {
      month: 4, year: 2026, amount: 800, dueDate: new Date(2026, 3, 10),
    });
    const res = await settle(b.id, 800, new Date(2026, 3, 25)); // 25/04, depois do vencimento

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.isLate).toBe(true);
    expect(res.paidInDifferentMonth).toBe(false);

    const billing = await readBilling(b.id);
    expect(billing.status).toBe("PAID");
    expect(billing.isLate).toBe(true);
    expect(billing.paidInDifferentMonth).toBe(false);

    const incomes = await readIncomes(b.id);
    expect(incomes[0].revenueType).toBe("MRR"); // atraso no mês NÃO é recuperação
  });
});

describe("settleBillingPayment — situação 3: pago em mês posterior", () => {
  it("marca recuperação e classifica o caixa como RECOVERY", async () => {
    const b = await createBilling(owner, clientId, {
      month: 5, year: 2026, amount: 1200, dueDate: new Date(2026, 4, 10),
    });
    const res = await settle(b.id, 1200, new Date(2026, 5, 3)); // 03/06: mês seguinte

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.paidInDifferentMonth).toBe(true);

    const billing = await readBilling(b.id);
    expect(billing.status).toBe("PAID");
    expect(billing.paidInDifferentMonth).toBe(true);

    const incomes = await readIncomes(b.id);
    expect(incomes[0].revenueType).toBe("RECOVERY");
    // O caixa entra no mês do PAGAMENTO (junho), não na competência (maio).
    expect(incomes[0].receivedAt.getMonth()).toBe(5);
  });

  it("NÃO cria Receita Extra automática (regra atual: extra é só manual)", async () => {
    // Competência própria: o índice único parcial do MRR admite uma única
    // cobrança viva por cliente e competência (protege contra duplicidade).
    const b = await createBilling(owner, clientId, {
      month: 10, year: 2026, amount: 500, dueDate: new Date(2026, 9, 10),
    });
    const res = await settle(b.id, 500, new Date(2026, 11, 2)); // dois meses depois
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.extraRevenueId).toBeNull();

    const extras = await runWithoutScope(async () =>
      prisma.extraRevenue.count({ where: { originBillingId: b.id } })
    );
    expect(extras).toBe(0);
  });
});

describe("settleBillingPayment — parcial e excedente", () => {
  it("pagamento parcial deixa a cobrança em PARTIAL, sem data de quitação", async () => {
    const b = await createBilling(owner, clientId, {
      month: 6, year: 2026, amount: 1000, dueDate: new Date(2026, 5, 10),
    });
    const res = await settle(b.id, 400, new Date(2026, 5, 5));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fullyPaid).toBe(false);

    const billing = await readBilling(b.id);
    expect(billing.status).toBe("PARTIAL");
    expect(Number(billing.paidTotal)).toBe(400);
    expect(billing.paidAt).toBeNull();
  });

  it("a soma dos parciais quita a cobrança", async () => {
    const b = await createBilling(owner, clientId, {
      month: 7, year: 2026, amount: 900, dueDate: new Date(2026, 6, 10),
    });
    await settle(b.id, 300, new Date(2026, 6, 5));
    await settle(b.id, 600, new Date(2026, 6, 8));

    const billing = await readBilling(b.id);
    expect(billing.status).toBe("PAID");
    expect(Number(billing.paidTotal)).toBe(900);
    expect(await readIncomes(b.id)).toHaveLength(2);
  });

  // REGRA TROCADA NA F1.8. Este teste travava a recusa do v1 e está
  // reescrito de propósito: 01 §3.12 e a Camada de Simplicidade (02 §1)
  // mandam "aplicar até o saldo e criar crédito". A hierarquia da spec é
  // explícita — regra de 01 vence código do v1. Recusar obrigava o
  // operador a lançar um valor DIFERENTE do que o cliente pagou, e aí o
  // extrato deixava de bater com o sistema, que é o pior desfecho.
  it("ACEITA valor acima do saldo e transforma o excedente em crédito (F1.8)", async () => {
    const b = await createBilling(owner, clientId, {
      month: 8, year: 2026, amount: 1000, dueDate: new Date(2026, 7, 10),
    });
    const res = await settle(b.id, 1100, new Date(2026, 7, 5));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fullyPaid).toBe(true);
    expect(res.creditGenerated).toBe(100);

    // A cobrança recebe só o que cabia nela; o resto virou crédito.
    const billing = await readBilling(b.id);
    expect(Number(billing.paidTotal)).toBe(1000);
    expect(billing.status).toBe("PAID");

    // O caixa registra o que entrou de VERDADE: os 1100.
    const incomes = await readIncomes(b.id);
    expect(incomes).toHaveLength(1);
    expect(Number(incomes[0].amount)).toBe(1100);
  });

  it("recusa pagamento em cobrança cancelada", async () => {
    const b = await createBilling(owner, clientId, {
      month: 9, year: 2026, amount: 700, dueDate: new Date(2026, 8, 10),
    });
    await runWithoutScope(async () =>
      prisma.billing.update({ where: { id: b.id }, data: { status: "CANCELED" } })
    );
    const res = await settle(b.id, 700, new Date(2026, 8, 5));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/cancelada/i);
  });

  it("erro de negócio nunca vira exceção (a tela recebe { ok:false })", async () => {
    const res = await settle("id-que-nao-existe", 100, new Date(2026, 2, 1));
    expect(res.ok).toBe(false);
  });
});
