import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  revertBillingPayment, settleBillingPayment,
} from "@/lib/services/payment-accounting";
import { newCorrelationId } from "@/lib/engines/context";

/**
 * ENSAIO da correção de 10/09/2026 → 10/07/2026 (arquivo temporário).
 *
 * Reproduz no banco de TESTES o erro que aconteceu em produção — baixa de
 * cobrança de 07/2026 com paidAt em 10/09 — e prova que estornar e
 * relançar pelo núcleo devolve o dinheiro para julho com a classificação
 * certa. Serve para não descobrir isso escrevendo em produção.
 */
describe("ensaio: corrigir a data de uma baixa lançada no mês errado", () => {
  let dono: TestOwner;
  beforeAll(async () => { dono = await createOwner(); });
  afterAll(async () => { await destroyOwner(dono); });

  it("estorno + relançamento move o caixa de setembro para julho e desfaz o RECOVERY", async () => {
    const cliente = await createMrrClient(dono, { name: "Ensaio da correção" });
    const cob = await createBilling(dono, cliente.id, {
      month: 7, year: 2026, amount: 1000, dueDate: new Date(2026, 6, 10),
    });

    // ---- o erro, igual ao de produção ----
    const errado = await asOwner(dono, async () =>
      await settleBillingPayment({
        billingId: cob.id, amount: 1000, paidAt: new Date(2026, 8, 10),
        method: "PIX", accountId: null, notes: null,
      } as any)
    );
    expect(errado.ok).toBe(true);

    const antes = await asOwner(dono, async () => await prisma.billing.findUniqueOrThrow({ where: { id: cob.id } }));
    const incAntes = await asOwner(dono, async () => await prisma.income.findFirstOrThrow({ where: { billingId: cob.id } }));
    expect(antes.status).toBe("PAID");
    expect(antes.paidInDifferentMonth).toBe(true);
    expect(incAntes.revenueType).toBe("RECOVERY");
    expect(incAntes.receivedAt.getMonth()).toBe(8); // setembro

    const pago = await asOwner(dono, async () => await prisma.payment.findFirstOrThrow({ where: { billingId: cob.id } }));

    // ---- a correção ----
    const ctx = {
      actorId: null, actorEmail: "ensaio@b2c.local", origin: "JOB" as const,
      reason: "Ensaio da correção de data", correlationId: newCorrelationId(),
    };
    await asOwner(dono, async () => {
      const rev = await revertBillingPayment(pago.id, ctx);
      expect(rev.ok).toBe(true);
      const set = await settleBillingPayment({
        billingId: cob.id, amount: 1000, paidAt: new Date(2026, 6, 10),
        method: "PIX", accountId: null, notes: null,
      } as any, ctx);
      expect(set.ok).toBe(true);
    });

    // ---- o resultado ----
    const depois = await asOwner(dono, async () => await prisma.billing.findUniqueOrThrow({ where: { id: cob.id } }));
    expect(depois.status).toBe("PAID");
    expect(Number(depois.paidTotal)).toBe(1000);
    expect(depois.paidAt?.getMonth()).toBe(6);          // julho
    expect(depois.paidInDifferentMonth).toBe(false);     // não é mais recuperação
    expect(depois.isLate).toBe(false);                   // pago no próprio vencimento

    // UM Income só — o antigo foi apagado junto com o estorno, não duplicou.
    const incomes = await asOwner(dono, async () => await prisma.income.findMany({ where: { billingId: cob.id } }));
    expect(incomes).toHaveLength(1);
    expect(incomes[0].receivedAt.getMonth()).toBe(6);    // caixa em julho
    expect(incomes[0].revenueType).not.toBe("RECOVERY");
    expect(Number(incomes[0].amount)).toBe(1000);

    // UM pagamento só, e uma aplicação só.
    const pagamentos = await asOwner(dono, async () => await prisma.payment.findMany({ where: { billingId: cob.id } }));
    expect(pagamentos).toHaveLength(1);
    expect(pagamentos[0].paidAt.getMonth()).toBe(6);
    const aplic = await asOwner(dono, async () =>
      await prisma.paymentApplication.findMany({ where: { billingId: cob.id } }));
    expect(aplic).toHaveLength(1);
    expect(Number(aplic[0].amount)).toBe(1000);

    // A trilha guarda o estorno com motivo — a correção não é silenciosa.
    // runWithoutScope: a trilha é consultada fora do escopo de dono, como
    // a auditoria de verdade faz — sem contexto, a extensão é fail-closed.
    const trilha = await runWithoutScope(async () =>
      await prisma.auditLog.findMany({
        where: { correlationId: ctx.correlationId },
        select: { entity: true, action: true, reason: true },
      })
    );
    expect(trilha.some((t) => t.action === "REVERSE")).toBe(true);
    expect(trilha.some((t) => t.action === "CREATE" && t.entity === "Payment")).toBe(true);
    expect(trilha.every((t) => t.reason === "Ensaio da correção de data")).toBe(true);
  });
});
