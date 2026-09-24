import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, asOwner, type TestOwner,
} from "./support/db";
import {
  derivedRenewalMonths, zonedMonthBounds, zonedMonthOf, scheduledRenewals, monthKey,
} from "@/lib/services/renewal-schedule";

/**
 * AGENDA ÚNICA DE RENOVAÇÕES (24/09/2026). O painel do mês, o card do
 * dashboard, a faixa "Próximos meses" e o relatório precisam contar as
 * MESMAS renovações: agenda do cadastro, data do contrato vigente e, na
 * falta dos dois, entrada + prazo.
 */

vi.mock("@/lib/auth/viewer", () => ({
  requirePermission: async () => ({
    id: "teste", name: "Teste", email: "teste@b2c.local",
    role: "ADMIN", permissions: [], personId: null,
  }),
  can: () => true,
}));
vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {}, revalidateFinance: () => {}, revalidateClients: () => {},
}));

let owner: TestOwner;
let getRenewalPanel: typeof import("@/lib/services/renewal-metrics")["getRenewalPanel"];
let getRenewalStrip: typeof import("@/lib/services/renewal-metrics")["getRenewalStrip"];
let getRenewalOutlook: typeof import("@/lib/services/revenue-metrics")["getRenewalOutlook"];
let getRenewalClientsDetail: typeof import("@/lib/services/dashboard-main")["getRenewalClientsDetail"];
let renewClientFlow: typeof import("@/lib/actions/renewals")["renewClientFlow"];

const HOJE = zonedMonthOf(new Date());
const ALVO = HOJE; // mês corrente: o outlook só enxerga a partir de hoje

beforeAll(async () => {
  owner = await createOwner();
  ({ getRenewalPanel, getRenewalStrip } = await import("@/lib/services/renewal-metrics"));
  ({ getRenewalOutlook } = await import("@/lib/services/revenue-metrics"));
  ({ getRenewalClientsDetail } = await import("@/lib/services/dashboard-main"));
  ({ renewClientFlow } = await import("@/lib/actions/renewals"));
});
afterAll(async () => {
  await destroyOwner(owner);
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("regras puras", () => {
  it("deriva os meses de renovação a partir da entrada e do prazo", () => {
    const janela = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 2027 }));
    // Entrou em março/2026 com 6 meses → set/26, mar/27, set/27.
    const r = derivedRenewalMonths(new Date(2026, 2, 10, 12), 6, janela);
    expect(r).toEqual([{ month: 3, year: 2027 }, { month: 9, year: 2027 }]);
    // 12 meses → sempre o mesmo mês da entrada.
    expect(derivedRenewalMonths(new Date(2026, 2, 10, 12), 12, janela)).toEqual([{ month: 3, year: 2027 }]);
    // Sem prazo ou sem entrada → nada.
    expect(derivedRenewalMonths(null, 12, janela)).toEqual([]);
    expect(derivedRenewalMonths(new Date(), null, janela)).toEqual([]);
    // O próprio mês de entrada não é renovação.
    expect(derivedRenewalMonths(new Date(2027, 4, 1, 12), 12, janela)).toEqual([]);
  });

  it("limita o mês no fuso do workspace (Bahia, UTC-3), não no do servidor", () => {
    const { start, end } = zonedMonthBounds(2026, 9);
    expect(start.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    // 30/09 às 22h na Bahia = 01/10 01h UTC → ainda é setembro.
    const noite = new Date("2026-10-01T01:00:00.000Z");
    expect(noite >= start && noite < end).toBe(true);
    expect(zonedMonthOf(noite)).toEqual({ month: 9, year: 2026 });
  });
});

describe("agenda única — as quatro telas contam igual", () => {
  it("cliente com contrato (renewalDate) e sem mês de renovação entra em todas", async () => {
    const c = await createMrrClient(owner, { name: "Só contrato" });
    const dia15 = new Date(Date.UTC(ALVO.year, ALVO.month - 1, 15, 15));
    await asOwner(owner, async () =>
      prisma.contract.create({
        data: {
          clientId: c.id, title: "Contrato", type: "MRR", recurrence: "MONTHLY",
          monthlyValue: 1000, totalValue: 12000, startDate: new Date(2026, 0, 1),
          endDate: dia15, renewalDate: dia15, status: "ACTIVE",
        },
      })
    );

    const agenda = await asOwner(owner, async () => scheduledRenewals([ALVO]));
    const lista = agenda.get(monthKey(ALVO)) ?? [];
    expect(lista.map((x) => [x.name, x.source])).toContainEqual(["Só contrato", "contrato"]);

    const panel = await asOwner(owner, async () => getRenewalPanel(ALVO.month, ALVO.year));
    expect(panel.rows.map((r) => r.name)).toContain("Só contrato");

    const strip = await asOwner(owner, async () => getRenewalStrip(ALVO.month, ALVO.year, 1));
    expect(strip[0].count).toBe(panel.rows.length);

    const outlook = await asOwner(owner, async () => getRenewalOutlook([0]));
    expect(outlook[0].clients.map((x) => x.name)).toContain("Só contrato");
    expect(outlook[0].count).toBe(panel.rows.length);

    const card = await asOwner(owner, async () => getRenewalClientsDetail(ALVO.month, ALVO.year));
    expect(card.map((x) => x.name)).toContain("Só contrato");
    expect(card).toHaveLength(panel.rows.length);
  });

  it("cliente só com entrada + prazo entra pelo ciclo derivado", async () => {
    // Entrou há exatamente 12 meses, prazo 12 → renova neste mês.
    const entrada = new Date(Date.UTC(ALVO.year - 1, ALVO.month - 1, 10, 15));
    const c = await createMrrClient(owner, { name: "Só prazo", startedAt: entrada });
    await asOwner(owner, async () =>
      prisma.client.update({ where: { id: c.id }, data: { contractMonths: 12 } })
    );
    const agenda = await asOwner(owner, async () => scheduledRenewals([ALVO]));
    const lista = agenda.get(monthKey(ALVO)) ?? [];
    expect(lista.map((x) => [x.name, x.source])).toContainEqual(["Só prazo", "prazo"]);
  });

  it("cliente que já saiu não entra pela agenda", async () => {
    const c = await createMrrClient(owner, { name: "Saiu" });
    await asOwner(owner, async () =>
      prisma.client.update({ where: { id: c.id }, data: { status: "CHURNED", renewalMonth: ALVO.month } })
    );
    const agenda = await asOwner(owner, async () => scheduledRenewals([ALVO]));
    expect((agenda.get(monthKey(ALVO)) ?? []).map((x) => x.name)).not.toContain("Saiu");
  });
});

describe("depois de 'Sim, renovou'", () => {
  it("segue contado no mês como renovado, e o valor esperado TCV não acumula", async () => {
    const c = await createMrrClient(owner, { name: "Renovou TCV" });
    await asOwner(owner, async () =>
      prisma.client.update({
        where: { id: c.id },
        data: { modality: "TCV", monthlyValue: null, totalContractValue: 5000, renewalMonth: ALVO.month },
      })
    );
    const ct = await asOwner(owner, async () =>
      prisma.contract.create({
        data: {
          clientId: c.id, title: "TCV", type: "TCV", recurrence: "NONE",
          monthlyValue: 0, totalValue: 5000, startDate: new Date(2025, 0, 1),
          endDate: new Date(2026, 0, 31), status: "ACTIVE",
        },
      })
    );

    const antes = await asOwner(owner, async () => getRenewalPanel(ALVO.month, ALVO.year));
    expect(antes.rows.find((r) => r.name === "Renovou TCV")?.expected).toBe(5000);

    const res = await asOwner(owner, async () =>
      renewClientFlow(form({
        clientId: c.id, contractId: ct.id, months: "12", modality: "TCV",
        totalValue: "6.000,00", launch: "0",
      }))
    );
    expect(res.ok).toBe(true);

    const depois = await asOwner(owner, async () => getRenewalPanel(ALVO.month, ALVO.year));
    const linha = depois.rows.find((r) => r.name === "Renovou TCV");
    expect(linha?.renewal?.totalValue).toBe(6000);
    expect(depois.renewedCount).toBeGreaterThanOrEqual(1);
    // Contract.totalValue virou 11.000 (acumulado); o esperado da PRÓXIMA
    // renovação é o valor do contrato atual (6.000), não a soma.
    const contrato = await runWithoutScope(async () =>
      prisma.contract.findUniqueOrThrow({ where: { id: ct.id }, select: { totalValue: true } })
    );
    expect(Number(contrato.totalValue)).toBe(11000);
    expect(linha?.expected).toBe(6000);

    // O card do dashboard mostra o mesmo cliente como "renovou".
    const card = await asOwner(owner, async () => getRenewalClientsDetail(ALVO.month, ALVO.year));
    expect(card.find((x) => x.name === "Renovou TCV")?.sub).toContain("renovou");
  });
});
