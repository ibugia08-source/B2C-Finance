import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, createRelationship, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import { revertBillingPayment, settleBillingPayment } from "@/lib/services/payment-accounting";
import { toNumber as n } from "@/lib/format";

/**
 * F1.4 — PaymentApplication e paidTotal derivado (01 §4.5).
 *
 * O invariante que estes testes protegem é um só e vale sempre:
 *
 *     paidTotal == Σ aplicações
 *
 * Ele tem de continuar valendo depois de pagar, pagar de novo, estornar o
 * primeiro e estornar o segundo — em qualquer ordem. Somar e subtrair na
 * mão (como o v1 fazia) é o que produz saldo que não fecha quando o
 * estorno cai no meio de dois parciais.
 */
async function invariante(billingId: string) {
  const b = await prisma.billing.findUniqueOrThrow({ where: { id: billingId } });
  const soma = await prisma.paymentApplication.aggregate({
    where: { billingId },
    _sum: { amount: true },
  });
  return { paidTotal: n(b.paidTotal), aplicado: n(soma._sum.amount), status: b.status };
}

describe("F1.4 — aplicação de pagamento", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("cada pagamento gera uma aplicação e o saldo sai dela", async () => {
    const cliente = await createMrrClient(dono, { name: "Aplicação simples" });
    const cob = await createBilling(dono, cliente.id, { month: 3, year: 2026, amount: 1000 });

    const r = await asOwner(dono, async () =>
      settleBillingPayment({
        billingId: cob.id, amount: 1000, paidAt: new Date(2026, 2, 5), method: "PIX",
      })
    );
    expect(r.ok).toBe(true);

    const est = await asOwner(dono, async () => invariante(cob.id));
    expect(est.paidTotal).toBe(1000);
    expect(est.aplicado).toBe(1000);
    expect(est.status).toBe("PAID");
  });

  it("dois parciais e o estorno do PRIMEIRO deixam o saldo correto", async () => {
    const cliente = await createMrrClient(dono, { name: "Estorno no meio" });
    const cob = await createBilling(dono, cliente.id, { month: 4, year: 2026, amount: 1000 });

    const p1: any = await asOwner(dono, async () =>
      settleBillingPayment({ billingId: cob.id, amount: 400, paidAt: new Date(2026, 3, 5), method: "PIX" })
    );
    await asOwner(dono, async () =>
      settleBillingPayment({ billingId: cob.id, amount: 600, paidAt: new Date(2026, 3, 20), method: "PIX" })
    );

    let est = await asOwner(dono, async () => invariante(cob.id));
    expect(est.paidTotal).toBe(1000);
    expect(est.status).toBe("PAID");

    // Estorna o PRIMEIRO, não o último — o caso que quebra soma manual.
    await asOwner(dono, async () => revertBillingPayment(p1.paymentId));

    est = await asOwner(dono, async () => invariante(cob.id));
    expect(est.paidTotal).toBe(600);
    expect(est.aplicado).toBe(600);
    expect(est.paidTotal).toBe(est.aplicado);
    expect(est.status).toBe("PARTIAL");
  });

  it("estornar tudo zera o saldo e não deixa aplicação órfã", async () => {
    const cliente = await createMrrClient(dono, { name: "Estorno total" });
    const cob = await createBilling(dono, cliente.id, { month: 5, year: 2026, amount: 800 });

    const p1: any = await asOwner(dono, async () =>
      settleBillingPayment({ billingId: cob.id, amount: 300, paidAt: new Date(2026, 4, 3), method: "PIX" })
    );
    const p2: any = await asOwner(dono, async () =>
      settleBillingPayment({ billingId: cob.id, amount: 500, paidAt: new Date(2026, 4, 9), method: "PIX" })
    );

    await asOwner(dono, async () => revertBillingPayment(p2.paymentId));
    await asOwner(dono, async () => revertBillingPayment(p1.paymentId));

    const est = await asOwner(dono, async () => invariante(cob.id));
    expect(est.paidTotal).toBe(0);
    expect(est.aplicado).toBe(0);

    const orfas = await asOwner(dono, async () =>
      prisma.paymentApplication.count({ where: { billingId: cob.id } })
    );
    expect(orfas).toBe(0);
  });

  it("um pagamento pode ser aplicado em DUAS cobranças — a razão do modelo", async () => {
    const cliente = await createMrrClient(dono, { name: "Pix que cobre dois meses" });
    const jan = await createBilling(dono, cliente.id, { month: 1, year: 2026, amount: 500 });
    const fev = await createBilling(dono, cliente.id, { month: 2, year: 2026, amount: 500 });

    const r: any = await asOwner(dono, async () =>
      settleBillingPayment({ billingId: jan.id, amount: 500, paidAt: new Date(2026, 0, 10), method: "PIX" })
    );

    // O mesmo pagamento cobre também fevereiro.
    await asOwner(dono, async () =>
      prisma.paymentApplication.create({
        data: { paymentId: r.paymentId, billingId: fev.id, amount: 500, appliedAt: new Date(2026, 0, 10) },
      })
    );

    const aplicacoes = await asOwner(dono, async () =>
      prisma.paymentApplication.findMany({ where: { paymentId: r.paymentId } })
    );
    expect(aplicacoes).toHaveLength(2);

    // A mesma aplicação duas vezes é recusada pelo banco.
    await expect(
      asOwner(dono, async () =>
        prisma.paymentApplication.create({
          data: { paymentId: r.paymentId, billingId: fev.id, amount: 1, appliedAt: new Date() },
        })
      )
    ).rejects.toThrow();
  });

  it("cobrança nova nasce ligada à relação — pelo gatilho, não pelo chamador", async () => {
    const cliente = await createMrrClient(dono, { name: "Vocabulário" });
    const rel = await createRelationship(dono, cliente.id);
    // createBilling NÃO informa a relação de propósito: quem preenche é o
    // banco, que é o que faz os 10 pontos de criação ficarem corretos sem
    // ter de lembrar de nenhum deles.
    const cob = await createBilling(dono, cliente.id, { month: 6, year: 2026, amount: 100 });
    const b = await asOwner(dono, async () =>
      prisma.billing.findUniqueOrThrow({ where: { id: cob.id } })
    );
    expect(b.relationshipId).toBe(rel.id);
    expect(b.billingKind).toBe("MRR");
    expect(b.recognitionMode).toBe("REVENUE");
  });
});
