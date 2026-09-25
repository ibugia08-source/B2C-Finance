import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma, createOwner, destroyOwner, createMrrClient, createBilling, asOwner, type TestOwner } from "./support/db";

/**
 * ADIANTAMENTO CONTA NO MÊS EM QUE FOI PAGO (decisão do dono, 25/09/2026).
 * Card "Recebido" e série anual usam a mesma regra; o "Em aberto" é da
 * competência e não diz que falta receber o que já entrou antes.
 */

vi.mock("@/lib/auth/viewer", () => {
  const v = { id: "teste", name: "Teste", email: "teste@b2c.local", role: "ADMIN", permissions: [], personId: null };
  return {
    requirePermission: async () => v, tryPermission: async () => v, getViewer: async () => v,
    NO_PERMISSION: { ok: false, error: "Sem permissão." }, can: () => true,
  };
});
vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {}, revalidateFinance: () => {}, revalidateClients: () => {},
  revalidateCatalog: () => {}, revalidatePayroll: () => {},
}));
vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

let owner: TestOwner;
beforeAll(async () => {
  owner = await createOwner();
});
afterAll(async () => {
  await destroyOwner(owner);
});

describe("pagamento de outubro feito em setembro", () => {
  it("entra no Recebido de setembro (card e série) e não aparece como em aberto em outubro", async () => {
    const { settleBillingPayment } = await import("@/lib/services/payment-accounting");
    const { getReceiptsSummary } = await import("@/lib/services/revenue-metrics");
    const { getYearlySeries } = await import("@/lib/services/dashboard-main");

    const c = await createMrrClient(owner, { name: "Adianta Outubro", monthlyValue: 1000, startedAt: new Date(2029, 0, 1) });
    const out = await createBilling(owner, c.id, {
      year: 2029, month: 10, amount: 1000, dueDate: new Date(Date.UTC(2029, 9, 10)),
    });
    const r = await asOwner(owner, async () =>
      settleBillingPayment({
        billingId: out.id, amount: 1000, paidAt: new Date(Date.UTC(2029, 8, 20)),
        method: "PIX", accountId: null, notes: null,
      } as any)
    );
    expect(r.ok, (r as any).error).toBe(true);

    const set = await asOwner(owner, async () =>
      getReceiptsSummary(new Date(2029, 8, 1), new Date(2029, 9, 1), {})
    );
    expect(set.totalRevenue).toBe(1000);
    expect(set.advanceOutValue).toBe(1000);

    const outubro = await asOwner(owner, async () =>
      getReceiptsSummary(new Date(2029, 9, 1), new Date(2029, 10, 1), {})
    );
    expect(outubro.totalRevenue).toBe(0); // não entra de novo em outubro
    expect(outubro.advanceInValue).toBe(1000);
    expect(outubro.receivedForCompetence).toBe(1000);
    expect(outubro.openMonth).toBe(0); // nada a receber da competência de outubro

    const serie = await asOwner(owner, async () => getYearlySeries(2029));
    expect(serie.recebido[8]).toBe(1000); // setembro
    expect(serie.recebido[9]).toBe(0); // outubro
    expect(serie.adiantadoSaida[8]).toBe(1000);
    expect(serie.adiantadoEntrada[9]).toBe(1000);
  });
});
