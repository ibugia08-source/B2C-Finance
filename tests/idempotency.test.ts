import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner,
  createMrrClient, createBilling, asOwner, type TestOwner,
} from "./support/db";

/**
 * IDEMPOTÊNCIA NO BANCO — ref. 03 §4.3; 01 §2.13.
 * "Throttle é só economia de trabalho": a garantia real é a constraint. Estes
 * testes provam que a duplicidade morre no BANCO, não na aplicação.
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

describe("pagamento externo (webhook duplicado — cenário S20)", () => {
  it("o mesmo evento externo entra UMA vez só", async () => {
    const b = await createBilling(owner, clientId, { month: 3, year: 2026, amount: 500 });
    const evento = {
      billingId: b.id, amount: 250, method: "PIX" as const,
      externalSource: "gateway-teste", externalId: "evt_12345",
    };

    await asOwner(owner, async () => prisma.payment.create({ data: evento }));
    // Reentrega do MESMO webhook:
    await expect(
      asOwner(owner, async () => prisma.payment.create({ data: evento }))
    ).rejects.toThrow();

    const n = await runWithoutScope(async () =>
      prisma.payment.count({ where: { billingId: b.id } })
    );
    expect(n).toBe(1);
  });

  it("a chave de deduplicação também é única", async () => {
    const b = await createBilling(owner, clientId, { month: 4, year: 2026, amount: 300 });
    await asOwner(owner, async () =>
      prisma.payment.create({
        data: { billingId: b.id, amount: 100, method: "PIX", idempotencyKey: "chave-unica-1" },
      })
    );
    await expect(
      asOwner(owner, async () =>
        prisma.payment.create({
          data: { billingId: b.id, amount: 100, method: "PIX", idempotencyKey: "chave-unica-1" },
        })
      )
    ).rejects.toThrow();
  });

  it("pagamento MANUAL não é travado: sem chave, quantos forem", async () => {
    const b = await createBilling(owner, clientId, { month: 5, year: 2026, amount: 900 });
    // No PostgreSQL, NULL não colide em índice único — é isso que permite
    // vários pagamentos parciais lançados à mão na mesma cobrança.
    for (const valor of [100, 200, 300]) {
      await asOwner(owner, async () =>
        prisma.payment.create({ data: { billingId: b.id, amount: valor, method: "PIX" } })
      );
    }
    const n = await runWithoutScope(async () =>
      prisma.payment.count({ where: { billingId: b.id } })
    );
    expect(n).toBe(3);
  });

  it("origens diferentes podem repetir o mesmo id externo", async () => {
    const b = await createBilling(owner, clientId, { month: 6, year: 2026, amount: 400 });
    await asOwner(owner, async () =>
      prisma.payment.create({
        data: { billingId: b.id, amount: 100, method: "PIX", externalSource: "banco-a", externalId: "1" },
      })
    );
    // Mesmo externalId, origem diferente: legítimo.
    const segundo = await asOwner(owner, async () =>
      prisma.payment.create({
        data: { billingId: b.id, amount: 100, method: "PIX", externalSource: "banco-b", externalId: "1" },
      })
    );
    expect(segundo.id).toBeTruthy();
  });
});

describe("geração de mensalidade (dedupe MRR)", () => {
  it("o banco recusa duas cobranças MRR vivas na mesma competência", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1000 });
    await createBilling(owner, c.id, { month: 7, year: 2026, amount: 1000 });
    // A trava é o índice único parcial Billing_client_competence_mrr_key.
    await expect(
      createBilling(owner, c.id, { month: 7, year: 2026, amount: 1000 })
    ).rejects.toThrow();
  });

  it("cobrança CANCELADA libera a competência (marcador não bloqueia no banco)", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1000 });
    const primeira = await createBilling(owner, c.id, { month: 8, year: 2026, amount: 1000 });
    await runWithoutScope(async () =>
      prisma.billing.update({ where: { id: primeira.id }, data: { status: "CANCELED" } })
    );
    // O índice é PARCIAL (só cobranças vivas), então o banco aceita —
    // quem impede a recriação automática é a regra do ciclo (01 §3.5),
    // testada em billing-generation.test.ts.
    const segunda = await createBilling(owner, c.id, { month: 8, year: 2026, amount: 1000 });
    expect(segunda.id).toBeTruthy();
  });

  it("TCV e MRR convivem na mesma competência", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1000 });
    await createBilling(owner, c.id, { month: 9, year: 2026, amount: 1000, revenueType: "MRR" });
    const tcv = await createBilling(owner, c.id, {
      month: 9, year: 2026, amount: 5000, revenueType: "TCV",
    });
    expect(tcv.id).toBeTruthy();
  });
});
