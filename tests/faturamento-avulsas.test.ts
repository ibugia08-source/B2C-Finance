import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, createOwner, destroyOwner, createMrrClient, createBilling, asOwner, type TestOwner } from "./support/db";
import { getPeriodRevenue, computeLossSnapshots } from "@/lib/services/revenue-metrics";

/** Auditoria 25/09/2026 — faturamento com avulsas e perda de TCV. */
let owner: TestOwner;
beforeAll(async () => {
  owner = await createOwner();
});
afterAll(async () => {
  await destroyOwner(owner);
});

describe("faturamento total inclui as cobranças avulsas da competência", () => {
  it("upsell (ONE_TIME) entra no total; cancelada e fora do mês não", async () => {
    const c = await createMrrClient(owner, { name: "Avulsa Fat", monthlyValue: 1000, startedAt: new Date(2027, 0, 1) });
    await createBilling(owner, c.id, { year: 2027, month: 5, amount: 800, revenueType: "ONE_TIME" });
    const cancelada = await createBilling(owner, c.id, { year: 2027, month: 5, amount: 999, revenueType: "SETUP" });
    await asOwner(owner, async () => prisma.billing.update({ where: { id: cancelada.id }, data: { status: "CANCELED" } }));
    await createBilling(owner, c.id, { year: 2027, month: 6, amount: 500, revenueType: "ONE_TIME" });

    const r = await asOwner(owner, async () => getPeriodRevenue(new Date(2027, 4, 1), new Date(2027, 5, 1), {}));
    expect(r.avulso).toBe(800);
    expect(r.total).toBe(r.mrr + r.tcv + 800);
    // Filtro de modalidade não traz avulsas (elas não têm modalidade).
    const soMrr = await asOwner(owner, async () => getPeriodRevenue(new Date(2027, 4, 1), new Date(2027, 5, 1), { modality: "MRR" } as any));
    expect(soMrr.avulso).toBe(0);
  });
});

describe("perda de TCV usa o valor do contrato atual, não o acumulado", () => {
  it("TCV de 12 mil renovado (contrato acumulado em 24 mil) perde 12 mil", async () => {
    const c = await createMrrClient(owner, { name: "TCV Perdido" });
    await asOwner(owner, async () =>
      prisma.client.update({ where: { id: c.id }, data: { modality: "TCV", monthlyValue: null, totalContractValue: 12000 } })
    );
    await asOwner(owner, async () =>
      prisma.contract.create({
        data: { clientId: c.id, title: "TCV", type: "TCV", recurrence: "NONE", monthlyValue: 0, totalValue: 24000, startDate: new Date(2026, 0, 1), status: "ACTIVE" },
      })
    );
    const [snap] = await asOwner(owner, async () => computeLossSnapshots([c.id]));
    expect(snap.referenceValue).toBe(12000);
  });
});
