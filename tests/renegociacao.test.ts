import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import { acordosDe, renegociar, situacaoDoAcordo } from "@/lib/services/renegotiation";
import { settleBillingPayment } from "@/lib/services/payment-accounting";

/**
 * F3.7 — reparcelamento (01 §3.13).
 *
 * "NÃO cria nova receita" é a regra inteira e a mais fácil de violar sem
 * perceber: as parcelas parecem cobranças normais e, se entrarem como
 * receita, o faturamento do mês salta com dinheiro já faturado meses atrás —
 * o cliente aparece pagando duas vezes a mesma venda.
 */
describe("F3.7 — reparcelamento", () => {
  let dono: TestOwner;
  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("as parcelas novas são SETTLEMENT_ONLY — não reconhecem receita", async () => {
    const c = await createMrrClient(dono, { name: "Renegociou" });
    const a = await createBilling(dono, c.id, { month: 3, year: 2027, amount: 1000 });
    const b = await createBilling(dono, c.id, { month: 4, year: 2027, amount: 1000 });

    const r: any = await asOwner(dono, async () =>
      renegociar({
        clientId: c.id,
        billingIds: [a.id, b.id],
        parcelas: 4,
        primeiroVencimento: new Date(2027, 5, 10),
        criadoPor: "Israel",
      })
    );
    expect(r.ok).toBe(true);
    expect(r.saldoOriginal).toBe(2000);

    const parcelas = await asOwner(dono, async () =>
      prisma.billing.findMany({ where: { settlementOfId: r.agreementId } })
    );
    expect(parcelas).toHaveLength(4);
    for (const p of parcelas) expect(p.recognitionMode).toBe("SETTLEMENT_ONLY");
  });

  it("as cobranças antigas viram RENEGOTIATED — nem pagas nem canceladas", async () => {
    const antigas = await asOwner(dono, async () =>
      prisma.billing.findMany({ where: { renegotiatedInId: { not: null } } })
    );
    expect(antigas).toHaveLength(2);
    for (const b of antigas) {
      expect(b.status).toBe("RENEGOTIATED");
      // Paga faria o recebido do mês subir sem ninguém ter pago.
      expect(Number(b.paidTotal)).toBe(0);
    }
  });

  it("a soma das parcelas bate EXATAMENTE com o negociado", async () => {
    const c = await createMrrClient(dono, { name: "Divisão exata" });
    const a = await createBilling(dono, c.id, { month: 5, year: 2027, amount: 1000 });

    const r: any = await asOwner(dono, async () =>
      renegociar({
        clientId: c.id, billingIds: [a.id], parcelas: 3,
        primeiroVencimento: new Date(2027, 6, 5),
      })
    );
    const soma = r.parcelas.reduce((s: number, v: number) => s + v, 0);
    expect(Math.round(soma * 100)).toBe(Math.round(r.negociado * 100));
    // Resíduo na ÚLTIMA, como no TCV — duas rotinas de arredondamento
    // diferentes no mesmo sistema é como nasce o centavo que ninguém acha.
    expect(r.parcelas).toEqual([333.33, 333.33, 333.34]);
  });

  it("a conta do acordo tem de fechar — o banco recusa se não fechar", async () => {
    const c = await createMrrClient(dono, { name: "Conta que não fecha" });
    await expect(
      asOwner(dono, async () =>
        prisma.renegotiationAgreement.create({
          data: {
            clientId: c.id, originalBalance: 1000, negotiatedBalance: 500,
            discountAmount: 0, interestAmount: 0, installments: 2,
            signedAt: new Date(),
          },
        })
      )
    ).rejects.toThrow();
  });

  it("desconto e juros entram na conta e ficam separados", async () => {
    const c = await createMrrClient(dono, { name: "Com desconto e juros" });
    const a = await createBilling(dono, c.id, { month: 6, year: 2027, amount: 1000 });

    const r: any = await asOwner(dono, async () =>
      renegociar({
        clientId: c.id, billingIds: [a.id], parcelas: 2,
        desconto: 100, juros: 50,
        primeiroVencimento: new Date(2027, 7, 10),
      })
    );
    expect(r.negociado).toBe(950);

    const [acordo] = await asOwner(dono, async () => acordosDe(c.id));
    expect(Number(acordo.discountAmount)).toBe(100);
    expect(Number(acordo.interestAmount)).toBe(50);
    expect(Number(acordo.originalBalance)).toBe(1000);
  });

  it("acordo quebrado é FATO, não opinião: parcela vencida e não paga", async () => {
    const c = await createMrrClient(dono, { name: "Quebrou o acordo" });
    const a = await createBilling(dono, c.id, { month: 1, year: 2026, amount: 600 });

    const r: any = await asOwner(dono, async () =>
      renegociar({
        clientId: c.id, billingIds: [a.id], parcelas: 2,
        primeiroVencimento: new Date(2026, 1, 10), // no passado
      })
    );

    const s1 = await asOwner(dono, async () => situacaoDoAcordo(r.agreementId));
    expect(s1!.situacao).toBe("BROKEN");
    expect(s1!.vencidasAbertas).toBeGreaterThan(0);

    // Pagando tudo, o acordo é cumprido.
    const parcelas = await asOwner(dono, async () =>
      prisma.billing.findMany({ where: { settlementOfId: r.agreementId } })
    );
    for (const p of parcelas) {
      await asOwner(dono, async () =>
        settleBillingPayment({
          billingId: p.id, amount: Number(p.amount), paidAt: new Date(2026, 2, 1),
          method: "PIX", accountId: null, notes: null,
        })
      );
    }
    const s2 = await asOwner(dono, async () => situacaoDoAcordo(r.agreementId));
    expect(s2!.situacao).toBe("FULFILLED");
  });

  it("não dá para renegociar duas vezes a mesma cobrança", async () => {
    const antiga = await asOwner(dono, async () =>
      prisma.billing.findFirstOrThrow({ where: { status: "RENEGOTIATED" } })
    );
    const r = await asOwner(dono, async () =>
      renegociar({
        clientId: antiga.clientId, billingIds: [antiga.id], parcelas: 2,
        primeiroVencimento: new Date(2027, 8, 10),
      })
    );
    expect(r.ok).toBe(false);
  });
});
