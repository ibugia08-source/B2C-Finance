import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  asOwner, createOwner, createMrrClient, destroyOwner, prisma, type TestOwner,
} from "./support/db";
import type { Period } from "@/lib/period";

vi.mock("next/cache", async (orig) => ({
  ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {},
}));

/**
 * DETALHES DOS CARDS DO DASHBOARD = TOTAL DO CARD (25/09/2026).
 *
 * - O popup do MRR segue o PERÍODO e a regra clientActiveInMonth, mês a mês,
 *   sem corte de 60 linhas: a soma da lista é o MRR do card.
 * - Novo cliente TCV vale o totalContractValue do cliente primeiro e, só sem
 *   ele, o total do contrato mais recente (ordem de expectedRenewalValues).
 *
 * Ano de 2024 (passado): só entrada/saída decidem quem é ativo no mês.
 */

const periodo = (start: Date, end: Date): Period =>
  ({ key: "custom", start, end, label: "", parcial: false, decorridoAte: null, preset: "custom" }) as Period;
const TRI = periodo(new Date(2024, 0, 1), new Date(2024, 3, 1)); // jan–mar/2024
const MAR = periodo(new Date(2024, 2, 1), new Date(2024, 3, 1));

let dono: TestOwner;
let dm: typeof import("@/lib/services/dashboard-main");

beforeAll(async () => {
  dm = await import("@/lib/services/dashboard-main");
  dono = await createOwner();
  // A: o trimestre inteiro.
  await createMrrClient(dono, { name: "MRR A", monthlyValue: 1000, startedAt: new Date(2023, 5, 1) });
  // B: entra em 15/02 → fevereiro e março.
  await createMrrClient(dono, { name: "MRR B", monthlyValue: 500, startedAt: new Date(2024, 1, 15) });
  // C: sai em 10/02 → janeiro e fevereiro.
  const c = await createMrrClient(dono, { name: "MRR C", monthlyValue: 700, startedAt: new Date(2023, 0, 1) });
  await asOwner(dono, async () =>
    prisma.client.update({ where: { id: c.id }, data: { status: "CHURNED", churnedAt: new Date(2024, 1, 10) } })
  );
  // 70 clientes pequenos: a lista antiga cortava em 60.
  for (let i = 0; i < 70; i++)
    await createMrrClient(dono, { name: `MRR miúdo ${i}`, monthlyValue: 10, startedAt: new Date(2023, 0, 1) });

  // Novos clientes TCV de março/2024.
  await asOwner(dono, async () => {
    const comTotal = await prisma.client.create({
      data: {
        name: "TCV com total", status: "ACTIVE", modality: "TCV", monthlyValue: null,
        totalContractValue: 9000, startedAt: new Date(2024, 2, 5),
      },
      select: { id: true },
    });
    const semTotal = await prisma.client.create({
      data: {
        name: "TCV sem total", status: "ACTIVE", modality: "TCV", monthlyValue: null,
        totalContractValue: null, startedAt: new Date(2024, 2, 6),
      },
      select: { id: true },
    });
    for (const id of [comTotal.id, semTotal.id])
      await prisma.contract.create({
        data: { clientId: id, title: "Contrato", type: "TCV", totalValue: 6000, startDate: new Date(2024, 2, 1) },
      });
  });
});
afterAll(async () => {
  await destroyOwner(dono);
});

describe("popup do MRR = card do MRR", () => {
  it("trimestre: cada cliente soma só os meses em que estava ativo; total = card", async () => {
    const lista = await asOwner(dono, async () => dm.getMrrClientsDetail(TRI));
    const porNome = new Map(lista.map((x) => [x.name, x.value]));
    expect(porNome.get("MRR A")).toBe(3000);
    expect(porNome.get("MRR B")).toBe(1000);
    expect(porNome.get("MRR C")).toBe(1400);
    // Sem corte: os 70 miúdos estão todos lá.
    expect(lista.filter((x) => x.name.startsWith("MRR miúdo"))).toHaveLength(70);

    const soma = lista.reduce((s, x) => s + x.value, 0);
    expect(soma).toBe(3000 + 1000 + 1400 + 70 * 10 * 3);
    const card = await asOwner(dono, async () => dm.getDashboardMainMetrics(TRI));
    expect(soma).toBe(card.current.mrr);
  });

  it("mês fechado: quem saiu antes do mês não aparece, mesmo lista de hoje sendo outra", async () => {
    const lista = await asOwner(dono, async () => dm.getMrrClientsDetail(MAR));
    const nomes = lista.map((x) => x.name);
    expect(nomes).not.toContain("MRR C");
    expect(nomes).toContain("MRR B");
    const card = await asOwner(dono, async () => dm.getDashboardMainMetrics(MAR));
    expect(lista.reduce((s, x) => s + x.value, 0)).toBe(card.current.mrr);
  });
});

describe("novos clientes TCV — valor", () => {
  it("totalContractValue do cliente primeiro; sem ele, o total do contrato", async () => {
    const lista = await asOwner(dono, async () => dm.getNewClientsDetail(MAR));
    const porNome = new Map(lista.map((x) => [x.name, x.value]));
    expect(porNome.get("TCV com total")).toBe(9000);
    expect(porNome.get("TCV sem total")).toBe(6000);
  });
});

describe("periodMonths", () => {
  it("lista as competências do período, na ordem", () => {
    expect(dm.periodMonths(TRI)).toEqual([
      { year: 2024, month: 1 }, { year: 2024, month: 2 }, { year: 2024, month: 3 },
    ]);
    expect(dm.periodMonths(MAR)).toEqual([{ year: 2024, month: 3 }]);
  });
});
