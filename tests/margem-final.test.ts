import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import { margemTotalmenteAlocada } from "@/lib/services/full-margin";
import { runWithoutScope } from "@/lib/auth/owner-scope";

/**
 * F5.5 — margem totalmente alocada.
 *
 * O que os testes provam:
 *  1. O POOL mostra a composição (despesas gerais + folha + impostos) e a
 *     distribuição FECHA NO CENTAVO — mesma aritmética do motor de rateio.
 *  2. Despesa já rateada a cliente NÃO volta no pool (seria cobrada 2x).
 *  3. Cliente sem receita não absorve overhead; sem receita nenhuma, o
 *     overhead fica DECLARADO como não distribuído.
 */

const COMP = "2028-03";

describe("F5.5 — margem totalmente alocada", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    // A folha criada aqui referencia o colaborador (FK RESTRICT) — sai antes.
    await asOwner(dono, async () => {
      await prisma.payrollItem.deleteMany({});
      await prisma.payroll.deleteMany({});
      await prisma.taxProvision.deleteMany({ where: { competence: COMP } });
    });
    await destroyOwner(dono);
  });

  it("pool composto, distribuição proporcional à receita fechando no centavo", async () => {
    await asOwner(dono, async () => {
      const a = await createMrrClient(dono, { name: "Cliente A" });
      const b = await createMrrClient(dono, { name: "Cliente B" });
      const c = await createMrrClient(dono, { name: "Cliente C" });
      // Receitas 2.000 / 1.000 / 0 — C não absorve overhead.
      await createBilling(dono, a.id, { month: 3, year: 2028, amount: 2000 });
      await createBilling(dono, b.id, { month: 3, year: 2028, amount: 1000 });

      // Despesa geral sem dono: 100,00 (÷ 2/3 e 1/3 não fecha sem resto).
      await prisma.transaction.create({
        data: {
          date: new Date(2028, 2, 10), description: "Aluguel do escritório",
          amount: 100, type: "despesa", status: "pago",
        },
      });
      // Despesa DIRETA do cliente A: fica nos custos diretos, fora do pool.
      await prisma.transaction.create({
        data: {
          date: new Date(2028, 2, 12), description: "Mídia do cliente A",
          amount: 300, type: "despesa", status: "pago", clientId: a.id,
        },
      });
      // Folha da competência: 600 (500 + 100).
      const folha = await prisma.payroll.create({
        data: { month: 3, year: 2028, status: "APPROVED" },
        select: { id: true },
      });
      const emp = await prisma.employee.create({
        data: { name: "Colaborador", role: "Gestor" },
        select: { id: true },
      });
      await prisma.payrollItem.createMany({
        data: [
          { payrollId: folha.id, employeeId: emp.id, kind: "SALARY", amount: 500 },
          { payrollId: folha.id, employeeId: emp.id, kind: "BONUS", amount: 100 },
        ],
      });
      // Imposto provisionado: 90.
      const le = await runWithoutScope(async () =>
        prisma.legalEntity.findFirstOrThrow({ select: { id: true } })
      );
      // A unique (legalEntity, competência) é GLOBAL: a linha da rodada
      // anterior sobrevive ao destroyOwner e colidiria aqui.
      await runWithoutScope(async () =>
        prisma.taxProvision.deleteMany({ where: { competence: COMP } })
      );
      await prisma.taxProvision.create({
        data: {
          legalEntityId: le.id, competence: COMP, baseAmount: 3000,
          rate: 3, amount: 90,
        },
      });

      const r = await margemTotalmenteAlocada([COMP]);
      expect(r.pool.despesasGerais).toBe(100);
      expect(r.pool.folha).toBe(600);
      expect(r.pool.impostos).toBe(90);
      expect(r.pool.total).toBe(790);
      expect(r.naoDistribuido).toBe(0);

      const la = r.linhas.find((l) => l.cliente === "Cliente A")!;
      const lb = r.linhas.find((l) => l.cliente === "Cliente B")!;
      // Fecha no centavo: as duas fatias somam EXATAMENTE o pool.
      expect(Math.round((la.overheadAlocado + lb.overheadAlocado) * 100) / 100).toBe(790);
      // Proporção 2:1, com o resto indo para a maior fatia.
      expect(la.overheadAlocado).toBeGreaterThan(lb.overheadAlocado);
      expect(Math.abs(la.overheadAlocado - (790 * 2) / 3)).toBeLessThan(0.02);

      // Margem final = contribuição − overhead. A tem 300 de custo direto.
      expect(la.margemDeContribuicao).toBe(1700);
      expect(la.margemFinal).toBe(Math.round((1700 - la.overheadAlocado) * 100) / 100);

      // C não aparece com overhead (sem receita, sem peso).
      const lc = r.linhas.find((l) => l.cliente === "Cliente C");
      expect(lc?.overheadAlocado ?? 0).toBe(0);
    });
  });

  it("despesa geral JÁ rateada a cliente sai do pool — nunca cobrada duas vezes", async () => {
    await asOwner(dono, async () => {
      const d = await createMrrClient(dono, { name: "Cliente D" });
      await createBilling(dono, d.id, { month: 5, year: 2028, amount: 1000 });
      const t = await prisma.transaction.create({
        data: {
          date: new Date(2028, 4, 8), description: "Fatura do cartão de mídia",
          amount: 400, type: "despesa", status: "pago",
        },
        select: { id: true },
      });
      // Metade rateada ao cliente D (decisão manual da F3.4)…
      await prisma.allocation.create({
        data: {
          sourceType: "TRANSACTION", sourceId: t.id,
          dimensionType: "CLIENT", dimensionId: d.id,
          amount: 200, percentage: 50, competence: "2028-05", method: "MANUAL",
        },
      });
      const r = await margemTotalmenteAlocada(["2028-05"]);
      // …então só a METADE sem destino entra no pool.
      expect(r.pool.despesasGerais).toBe(200);
      const ld = r.linhas.find((l) => l.cliente === "Cliente D")!;
      expect(ld.custosRateados).toBe(200);
      // Contribuição 800; overhead = os 200 restantes (único cliente com receita).
      expect(ld.margemFinal).toBe(600);
    });
  });

  it("sem receita nenhuma no período, o overhead fica declarado como não distribuído", async () => {
    await asOwner(dono, async () => {
      await prisma.transaction.create({
        data: {
          date: new Date(2028, 7, 3), description: "Servidor",
          amount: 250, type: "despesa", status: "pago",
        },
      });
      const r = await margemTotalmenteAlocada(["2028-08"]);
      expect(r.pool.total).toBe(250);
      expect(r.naoDistribuido).toBe(250);
      expect(r.linhas.every((l) => l.overheadAlocado === 0)).toBe(true);
    });
  });
});
