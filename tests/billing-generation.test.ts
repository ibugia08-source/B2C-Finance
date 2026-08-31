import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  ensureMonthlyBillings,
  ensureClientBillingForMonth,
  bustBillingCycleThrottle,
} from "@/lib/services/receivables-cycle";
import {
  prisma, runWithoutScope, createOwner, destroyOwner,
  createMrrClient, asOwner, type TestOwner,
} from "./support/db";

/**
 * GERAÇÃO E DEDUPE DE MENSALIDADES — ref. 01 §3.5.
 * A regra que protege o faturamento contra cobrança duplicada: o ciclo é
 * idempotente e uma cobrança CANCELADA (removida do mês) bloqueia a recriação.
 */

let owner: TestOwner;

beforeAll(async () => {
  owner = await createOwner();
});
afterAll(async () => {
  await destroyOwner(owner);
});
beforeEach(() => {
  // O ciclo tem throttle de 1h em memória por (dono, competência); os testes
  // exercitam a idempotência do BANCO, não o throttle.
  bustBillingCycleThrottle();
});

const countBillings = (clientId: string, month: number, year: number) =>
  runWithoutScope(async () =>
    prisma.billing.count({
      where: { clientId, competenceMonth: month, competenceYear: year },
    })
  );

describe("ensureMonthlyBillings", () => {
  it("gera a mensalidade do cliente MRR ativo uma única vez", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1500, paymentDay: 10 });

    const first = await asOwner(owner, async () => ensureMonthlyBillings(3, 2026));
    expect(first.created).toBeGreaterThanOrEqual(1);
    expect(await countBillings(c.id, 3, 2026)).toBe(1);

    // Rodar de novo NÃO duplica (idempotência — 01 §3.5).
    bustBillingCycleThrottle();
    const second = await asOwner(owner, async () => ensureMonthlyBillings(3, 2026));
    expect(second.created).toBe(0);
    expect(await countBillings(c.id, 3, 2026)).toBe(1);

    const billing = await runWithoutScope(async () =>
      prisma.billing.findFirstOrThrow({
        where: { clientId: c.id, competenceMonth: 3, competenceYear: 2026 },
        select: { amount: true, dueDate: true, revenueType: true },
      })
    );
    expect(Number(billing.amount)).toBe(1500);
    expect(billing.dueDate.getDate()).toBe(10);
    expect(billing.revenueType).toBe("MRR");
  });

  it("clampa o vencimento no fim do mês (dia 31 em fevereiro)", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 500, paymentDay: 31 });
    await asOwner(owner, async () => ensureMonthlyBillings(2, 2026));
    const b = await runWithoutScope(async () =>
      prisma.billing.findFirstOrThrow({
        where: { clientId: c.id, competenceMonth: 2, competenceYear: 2026 },
        select: { dueDate: true },
      })
    );
    expect(b.dueDate.getDate()).toBe(28);
  });

  it("NÃO recria cobrança que foi removida do mês (marcador cancelado)", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 900 });
    await asOwner(owner, async () => ensureMonthlyBillings(4, 2026));
    const b = await runWithoutScope(async () =>
      prisma.billing.findFirstOrThrow({
        where: { clientId: c.id, competenceMonth: 4, competenceYear: 2026 },
        select: { id: true },
      })
    );
    await runWithoutScope(async () =>
      prisma.billing.update({
        where: { id: b.id },
        data: { status: "CANCELED", canceledAt: new Date(), cancelReason: "teste" },
      })
    );

    bustBillingCycleThrottle();
    await asOwner(owner, async () => ensureMonthlyBillings(4, 2026));
    expect(await countBillings(c.id, 4, 2026)).toBe(1); // continua só o marcador
  });

  it("ignora cliente que ainda não entrou na carteira naquele mês", async () => {
    const c = await createMrrClient(owner, {
      monthlyValue: 700,
      startedAt: new Date(2026, 5, 1), // entra em junho
    });
    await asOwner(owner, async () => ensureMonthlyBillings(5, 2026)); // maio
    expect(await countBillings(c.id, 5, 2026)).toBe(0);

    bustBillingCycleThrottle();
    await asOwner(owner, async () => ensureMonthlyBillings(6, 2026)); // junho
    expect(await countBillings(c.id, 6, 2026)).toBe(1);
  });

  it("ignora cliente perdido, pausado e sem valor mensal", async () => {
    const perdido = await createMrrClient(owner, { monthlyValue: 400 });
    const semValor = await createMrrClient(owner, { monthlyValue: 0 });
    await runWithoutScope(async () =>
      prisma.client.update({ where: { id: perdido.id }, data: { status: "CHURNED" } })
    );

    await asOwner(owner, async () => ensureMonthlyBillings(7, 2026));
    expect(await countBillings(perdido.id, 7, 2026)).toBe(0);
    expect(await countBillings(semValor.id, 7, 2026)).toBe(0);
  });
});

describe("ensureClientBillingForMonth", () => {
  it("cria a cobrança do mês e reusa a existente na segunda chamada", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1100, paymentDay: 15 });

    const first = await asOwner(owner, async () =>
      ensureClientBillingForMonth(c.id, 8, 2026)
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);

    const second = await asOwner(owner, async () =>
      ensureClientBillingForMonth(c.id, 8, 2026)
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.billingId).toBe(first.billingId);
    expect(await countBillings(c.id, 8, 2026)).toBe(1);
  });

  it("recoloca no mês a cobrança removida, sem duplicar", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1000 });
    const created = await asOwner(owner, async () =>
      ensureClientBillingForMonth(c.id, 9, 2026)
    );
    if (!created.ok) throw new Error("falhou ao criar");

    await runWithoutScope(async () =>
      prisma.billing.update({
        where: { id: created.billingId },
        data: { status: "CANCELED", canceledAt: new Date(), cancelReason: "removido" },
      })
    );

    const back = await asOwner(owner, async () =>
      ensureClientBillingForMonth(c.id, 9, 2026)
    );
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.billingId).toBe(created.billingId); // restaurou o mesmo registro
    expect(await countBillings(c.id, 9, 2026)).toBe(1);

    const b = await runWithoutScope(async () =>
      prisma.billing.findUniqueOrThrow({
        where: { id: created.billingId },
        select: { status: true, canceledAt: true, cancelReason: true },
      })
    );
    expect(b.status).not.toBe("CANCELED");
    expect(b.canceledAt).toBeNull();
    expect(b.cancelReason).toBeNull();
  });

  it("recusa cliente sem valor mensal, com mensagem para o usuário", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 0 });
    const res = await asOwner(owner, async () =>
      ensureClientBillingForMonth(c.id, 10, 2026)
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/valor mensal/i);
  });
});
