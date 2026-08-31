import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { ajustarCobranca, ajustesDa } from "@/lib/services/billing-adjustment";
import { settleBillingPayment } from "@/lib/services/payment-accounting";
import { isLedgerEnabled } from "@/lib/accounting/engine";
import { setLedgerEnabled } from "@/lib/accounting/health";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { montarDre } from "@/lib/services/dre";

/**
 * F3.8 — ajuste de cobrança (01 §4.7).
 *
 * A distinção que estes testes protegem é a que mais confunde na prática:
 * DESCONTO reduz a receita (a venda foi menor); WRITE-OFF reconhece PERDA e
 * deixa a receita de pé (a venda aconteceu, o dinheiro é que não veio).
 * Tratar os dois igual faz a receita do mês encolher retroativamente e o
 * histórico de faturamento mentir.
 */
describe("F3.8 — ajuste de cobrança", () => {
  let dono: TestOwner;
  let ws: string;
  let ligadoAntes = false;

  beforeAll(async () => {
    dono = await createOwner();
    ws = await currentWorkspaceId();
    ligadoAntes = await isLedgerEnabled(ws);
    await setLedgerEnabled(ws, true);
  });
  afterAll(async () => {
    await runWithoutScope(async () => {
      await prisma.ledgerEntry.deleteMany({
        where: { ledgerTransaction: { competence: "2027-01" } },
      });
      await prisma.ledgerTransaction.deleteMany({ where: { competence: "2027-01" } });
    });
    await setLedgerEnabled(ws, ligadoAntes);
    await destroyOwner(dono);
  });

  it("motivo é obrigatório — e a regra é do banco, não só da tela", async () => {
    const c = await createMrrClient(dono, { name: "Sem motivo" });
    const cob = await createBilling(dono, c.id, { month: 1, year: 2027, amount: 1000 });

    const r = await asOwner(dono, async () =>
      ajustarCobranca({ billingId: cob.id, type: "DISCOUNT", amount: 100, reason: "ok" })
    );
    expect(r.ok).toBe(false);

    await expect(
      asOwner(dono, async () =>
        prisma.billingAdjustment.create({
          data: {
            billingId: cob.id, type: "DISCOUNT", amount: 100,
            originalAmount: 1000, resultingAmount: 900, reason: "x",
          },
        })
      )
    ).rejects.toThrow();
  });

  it("desconto guarda de quanto para quanto e muda o valor", async () => {
    const c = await createMrrClient(dono, { name: "Com desconto" });
    const cob = await createBilling(dono, c.id, { month: 1, year: 2027, amount: 1000 });

    const r: any = await asOwner(dono, async () =>
      ajustarCobranca({
        billingId: cob.id, type: "DISCOUNT", amount: 150,
        reason: "negociação de renovação", requestedBy: "Israel",
      })
    );
    expect(r.ok).toBe(true);
    expect(r.de).toBe(1000);
    expect(r.para).toBe(850);

    const b = await asOwner(dono, async () =>
      prisma.billing.findUniqueOrThrow({ where: { id: cob.id } })
    );
    expect(Number(b.amount)).toBe(850);

    const hist = await asOwner(dono, async () => ajustesDa(cob.id));
    expect(hist).toHaveLength(1);
    expect(Number(hist[0].originalAmount)).toBe(1000);
    expect(Number(hist[0].resultingAmount)).toBe(850);
    expect(hist[0].requestedBy).toBe("Israel");
  });

  it("desconto que zera o saldo QUITA a cobrança", async () => {
    // Deixar como PENDING mandaria a equipe cobrar de novo um cliente que
    // não deve mais nada.
    const c = await createMrrClient(dono, { name: "Desconto total" });
    const cob = await createBilling(dono, c.id, { month: 1, year: 2027, amount: 500 });
    await asOwner(dono, async () =>
      settleBillingPayment({
        billingId: cob.id, amount: 400, paidAt: new Date(2027, 0, 5),
        method: "PIX", accountId: null, notes: null,
      })
    );
    await asOwner(dono, async () =>
      ajustarCobranca({
        billingId: cob.id, type: "DISCOUNT", amount: 100,
        reason: "arredondamento acordado com o cliente",
      })
    );
    const b = await asOwner(dono, async () =>
      prisma.billing.findUniqueOrThrow({ where: { id: cob.id } })
    );
    expect(Number(b.amount)).toBe(400);
    expect(b.status).toBe("PAID");
  });

  it("desconto maior que o saldo em aberto é recusado", async () => {
    const c = await createMrrClient(dono, { name: "Desconto grande demais" });
    const cob = await createBilling(dono, c.id, { month: 1, year: 2027, amount: 300 });
    const r = await asOwner(dono, async () =>
      ajustarCobranca({
        billingId: cob.id, type: "DISCOUNT", amount: 999,
        reason: "erro de digitação proposital",
      })
    );
    expect(r.ok).toBe(false);
  });

  it("WRITE-OFF reconhece PERDA e NÃO reduz a receita", async () => {
    const c = await createMrrClient(dono, { name: "Perdeu a dívida" });
    const cob = await createBilling(dono, c.id, { month: 1, year: 2027, amount: 2000 });

    const antes = await asOwner(dono, async () => montarDre("2027-01"));

    const r: any = await asOwner(dono, async () =>
      ajustarCobranca({
        billingId: cob.id, type: "WRITE_OFF", amount: 2000,
        reason: "cliente encerrou atividades, dívida irrecuperável",
      })
    );
    expect(r.ok).toBe(true);
    // O valor da cobrança NÃO muda: a venda aconteceu.
    expect(r.para).toBe(2000);

    const depois = await asOwner(dono, async () => montarDre("2027-01"));
    // A receita não encolheu...
    expect(depois.receitaOperacional).toBe(antes.receitaOperacional);
    // ...e apareceu uma perda.
    expect(depois.despesas).toBe(antes.despesas + 2000);

    const perda = depois.blocos
      .find((b) => b.chave === "ajustes")
      ?.linhas.find((l) => l.code === "14.2");
    expect(perda?.valor).toBe(2000);
  });

  it("não existe campo de aprovação — 19.35/19.36 (o controle é a trilha)", async () => {
    const colunas = await runWithoutScope(async () =>
      prisma.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name='BillingAdjustment'`
      )
    );
    const nomes = colunas.map((c) => c.column_name);
    // Campo que nunca é preenchido é pior que campo nenhum: dá a impressão
    // de um controle que não existe.
    expect(nomes).not.toContain("approvedBy");
    expect(nomes).toContain("reason");
    expect(nomes).toContain("originalAmount");
  });
});
