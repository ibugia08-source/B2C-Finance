import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling, asOwner,
  type TestOwner,
} from "./support/db";
import { addMonths, todayKey } from "@/lib/competence";

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

/**
 * GRÁFICOS DE EVOLUÇÃO DA VISÃO GERAL (26/09/2026): MRR × TCV em janela
 * móvel de 12 meses, clientes ativos e churn (qtd + R$) ao longo do ano.
 * Datas relativas ao dia real (a linha do tempo de status usa o relógio do banco).
 */

const HOJE = todayKey();
const CUR = HOJE.slice(0, 7);
const ANO = +CUR.slice(0, 4);
let owner: TestOwner;
let ev: typeof import("@/lib/services/dashboard-evolution");

beforeAll(async () => {
  owner = await createOwner();
  ev = await import("@/lib/services/dashboard-evolution");
});
afterAll(async () => destroyOwner(owner));

describe("getDashboardEvolution", () => {
  it("MRR por mês pela linha do tempo, TCV pela cobrança da competência, churn com R$ perdido", async () => {
    const tresAtras = addMonths(CUR, -3);
    const [ty, tm] = tresAtras.split("-").map(Number);
    // Ativo desde 3 meses atrás, R$ 1.000/mês.
    const a = await createMrrClient(owner, { monthlyValue: 1000, startedAt: new Date(Date.UTC(ty, tm - 1, 1, 15)) });
    // TCV de R$ 5.000 no mês atual.
    const t = await asOwner(owner, async () =>
      prisma.client.create({ data: { name: "TCV", status: "ACTIVE", modality: "TCV", totalContractValue: 5000 }, select: { id: true } })
    );
    const [cy, cm] = CUR.split("-").map(Number);
    await createBilling(owner, t.id, { year: cy, month: cm, amount: 5000, revenueType: "TCV" });
    // Uma perda registrada no mês atual (R$ 800 de mensalidade perdida).
    await runWithoutScope(async () =>
      prisma.clientLoss.create({ data: { clientId: a.id, ownerId: owner.id, modality: "MRR", monthlyValue: 800, lostAt: new Date() } })
    );

    const r = await asOwner(owner, async () => ev.getDashboardEvolution({ anchor: CUR, year: ANO }));
    expect(r.mrrTcv).toHaveLength(12);
    const ult = r.mrrTcv[11];
    expect(ult.competence).toBe(CUR);
    expect(ult.mrr).toBe(1000);
    expect(ult.tcv).toBe(5000);
    // Antes da entrada, não conta.
    const antes = r.mrrTcv.find((p) => p.competence === addMonths(tresAtras, -1))!;
    expect(antes.mrr).toBe(0);

    const mes = r.year[cm - 1];
    expect(mes.churn).toBe(1);
    expect(mes.churnValue).toBe(800);
    expect(mes.ativos).toBeGreaterThanOrEqual(1);
    // Meses que ainda não aconteceram ficam vazios (não é projeção).
    for (const p of r.year.slice(cm)) expect(p.ativos).toBeNull();
  });
});
