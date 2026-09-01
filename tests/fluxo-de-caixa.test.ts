import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import { fluxoDeCaixa, HORIZONTES } from "@/lib/services/cash-flow";

/**
 * F3.11 — fluxo de caixa e projeção 30/60/90 (01 §7.2).
 *
 * O erro que estes testes evitam é o mais caro de uma projeção de caixa:
 * mentir para cima. Cobrança vencida contada como entrada dos próximos 30
 * dias, competência no lugar de vencimento, saldo bruto no lugar de liquidez
 * disponível — os três fazem a projeção mostrar dinheiro que não existe, e é
 * contra ela que alguém aprova uma despesa.
 */
describe("F3.11 — projeção de caixa", () => {
  let dono: TestOwner;
  let cliente: { id: string; name: string };
  let contaId: string;
  const HOJE = new Date(2027, 5, 10);

  beforeAll(async () => {
    dono = await createOwner();
    cliente = await createMrrClient(dono, { name: "Cliente do fluxo" });
    contaId = await asOwner(dono, async () =>
      (
        await prisma.account.create({
          data: { name: "Conta do fluxo", type: "corrente", balance: 5000 },
          select: { id: true },
        })
      ).id
    );
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.billing.deleteMany({});
      await prisma.transaction.deleteMany({});
    });
  });

  afterAll(async () => {
    await asOwner(dono, async () => {
      await prisma.transaction.deleteMany({});
      await prisma.account.deleteMany({ where: { id: contaId } });
    });
    await destroyOwner(dono);
  });

  async function despesa(vencimentoEmDias: number, valor: number, comConta = true) {
    const d = new Date(HOJE.getTime() + vencimentoEmDias * 86_400_000);
    return asOwner(dono, async () =>
      prisma.transaction.create({
        data: {
          date: d, dueDate: d, description: "Despesa projetada", amount: valor,
          type: "despesa", status: "pendente", belongsTo: "empresa",
          accountId: comConta ? contaId : null,
        },
        select: { id: true },
      })
    );
  }

  it("os três horizontes de 01 §7.2, acumulativos", async () => {
    await asOwner(dono, async () => {
      await despesa(10, 1000);
      await despesa(45, 2000);
      await despesa(80, 4000);

      const f = await fluxoDeCaixa(HOJE);
      expect(f.projecoes.map((p) => p.dias)).toEqual([...HORIZONTES]);
      // Cada horizonte INCLUI os anteriores — é a leitura que a pergunta
      // "tenho caixa até quando?" espera.
      expect(f.projecoes[0].saidas).toBe(1000);
      expect(f.projecoes[1].saidas).toBe(3000);
      expect(f.projecoes[2].saidas).toBe(7000);
    });
  });

  it("cobrança VENCIDA não vira entrada dos próximos 30 dias", async () => {
    await asOwner(dono, async () => {
      await createBilling(dono, cliente.id, {
        month: 5, year: 2027, amount: 3000,
        dueDate: new Date(HOJE.getTime() - 20 * 86_400_000),
      });
      const f = await fluxoDeCaixa(HOJE);
      expect(f.projecoes[0].entradas).toBe(0);
    });
  });

  it("a data que manda é o VENCIMENTO, não a competência", async () => {
    await asOwner(dono, async () => {
      // Competência de junho, vencimento em julho: entra no horizonte de 60,
      // não no de 30.
      await createBilling(dono, cliente.id, {
        month: 6, year: 2027, amount: 2500,
        dueDate: new Date(HOJE.getTime() + 40 * 86_400_000),
      });
      const f = await fluxoDeCaixa(HOJE);
      expect(f.projecoes[0].entradas).toBe(0);
      expect(f.projecoes[1].entradas).toBe(2500);
    });
  });

  it("a liquidez projetada parte do DISPONÍVEL, não do saldo bruto", async () => {
    await asOwner(dono, async () => {
      await despesa(10, 500);
      const f = await fluxoDeCaixa(HOJE);
      const p30 = f.projecoes[0];
      expect(p30.liquidezProjetada).toBe(
        Math.round((f.liquidez.disponivel + p30.entradas - p30.saidas) * 100) / 100
      );
    });
  });

  it("aponta o PRIMEIRO horizonte que fica negativo", async () => {
    await asOwner(dono, async () => {
      await despesa(45, 900_000);
      const f = await fluxoDeCaixa(HOJE);
      expect(f.primeiroNegativo).toBe(60);
      expect(f.projecoes[0].negativa).toBe(false);
      expect(f.projecoes[1].negativa).toBe(true);
    });
  });

  it("por conta mostra só saídas, e a despesa sem conta vai para a linha própria", async () => {
    await asOwner(dono, async () => {
      await despesa(10, 700, true);
      await despesa(10, 300, false);

      const f = await fluxoDeCaixa(HOJE);
      const minha = f.contas.find((c) => c.accountId === contaId)!;
      expect(minha.saldoAtual).toBe(5000);
      expect(minha.saidas[30]).toBe(700);
      expect(minha.saldoProjetado[30]).toBe(4300);

      const semConta = f.contas.find((c) => c.accountId === null)!;
      expect(semConta.saidas[30]).toBe(300);
      expect(semConta.saldoProjetado[30]).toBe(-300);
    });
  });

  it("a tela recebe o AVISO do que a projeção não enxerga", async () => {
    await asOwner(dono, async () => {
      const f = await fluxoDeCaixa(HOJE);
      expect(f.aviso).toMatch(/já existe/i);
      expect(f.aviso).toMatch(/recorrente/i);
    });
  });
});
