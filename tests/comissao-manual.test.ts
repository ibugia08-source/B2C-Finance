import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asOwner, createOwner, destroyOwner, prisma, type TestOwner } from "./support/db";
import {
  registrarComissao, resumoDeComissoes, vendasSemComissao,
} from "@/lib/services/commissions";
import { criarOportunidade, moverEtapa } from "@/lib/services/pipeline";

/**
 * F4.7 — comissão DIGITADA À MÃO (decisão 19.14).
 *
 * A spec original previa regra de comissão VERSIONADA com gatilho automático
 * (01 §4.8; 03 §57). A direção decidiu que isso não existe nesta versão.
 *
 * Estes testes protegem a AUSÊNCIA. Sem eles, a próxima pessoa que ler
 * "regras de comissão versionadas" na spec vai achar que é dívida técnica e
 * implementar — automatizando uma decisão que a direção quis manual.
 */
describe("F4.7 — comissão manual", () => {
  let dono: TestOwner;
  let employeeId: string;
  const COMP = "2027-08";
  const DIA = new Date(2027, 7, 12);

  beforeAll(async () => {
    dono = await createOwner();
    employeeId = await asOwner(dono, async () =>
      (
        await prisma.employee.create({
          data: { name: "Vitor", role: "Closer", baseSalary: 3000 },
          select: { id: true },
        })
      ).id
    );
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.commission.deleteMany({});
      await prisma.pipelineEvent.deleteMany({});
      await prisma.opportunity.deleteMany({});
    });
  });

  afterAll(async () => {
    await asOwner(dono, async () => {
      await prisma.commission.deleteMany({});
      await prisma.employee.deleteMany({ where: { id: employeeId } });
    });
    await destroyOwner(dono);
  });

  it("A AUSÊNCIA: não existe tabela de regra de comissão no banco", async () => {
    const tabelas = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name ILIKE '%commissionrule%'
    `;
    expect(tabelas).toHaveLength(0);
  });

  it("ganhar uma venda NÃO cria comissão sozinho", async () => {
    await asOwner(dono, async () => {
      const o = await criarOportunidade({ title: "Venda grande", amount: 30_000, modality: "TCV", closer: "Vitor" });
      if (!o.ok) return;
      await moverEtapa(o.id, "GANHA", { quando: DIA });
      expect(await prisma.commission.count({})).toBe(0);
    });
  });

  it("a lista de vendas sem comissão NÃO sugere valor", async () => {
    await asOwner(dono, async () => {
      const o = await criarOportunidade({ title: "Venda", amount: 30_000, modality: "TCV", closer: "Vitor" });
      if (!o.ok) return;
      await moverEtapa(o.id, "GANHA", { quando: DIA });

      const lista = await vendasSemComissao(COMP);
      expect(lista).toHaveLength(1);
      expect(lista[0].valorDaVenda).toBe(30_000);
      // Sugerir percentual seria a regra automática voltando pela porta dos
      // fundos: o número sugerido vira o número aceito.
      expect(Object.keys(lista[0])).not.toContain("comissaoSugerida");
      expect(Object.keys(lista[0])).not.toContain("percentual");
    });
  });

  it("o valor gravado é EXATAMENTE o digitado", async () => {
    await asOwner(dono, async () => {
      const r = await registrarComissao({ employeeId, amount: 1234.56, competence: COMP });
      expect(r.ok).toBe(true);
      const c = await prisma.commission.findFirstOrThrow({});
      expect(Number(c.amount)).toBe(1234.56);
      // Nada foi calculado: base e taxa continuam vazias.
      expect(c.basisAmount).toBeNull();
      expect(c.rate).toBeNull();
    });
  });

  it("valor zerado ou negativo é recusado", async () => {
    await asOwner(dono, async () => {
      expect((await registrarComissao({ employeeId, amount: 0, competence: COMP })).ok).toBe(false);
      expect((await registrarComissao({ employeeId, amount: -50, competence: COMP })).ok).toBe(false);
    });
  });

  it("a comissão guarda de qual VENDA veio, e a venda sai da lista", async () => {
    await asOwner(dono, async () => {
      const o = await criarOportunidade({ title: "Venda", amount: 30_000, modality: "TCV", closer: "Vitor" });
      if (!o.ok) return;
      await moverEtapa(o.id, "GANHA", { quando: DIA });

      const r = await registrarComissao({
        employeeId, amount: 900, competence: COMP, opportunityId: o.id,
      });
      expect(r.ok).toBe(true);
      expect(await vendasSemComissao(COMP)).toHaveLength(0);

      // E a mesma venda não é comissionada duas vezes.
      const segunda = await registrarComissao({
        employeeId, amount: 900, competence: COMP, opportunityId: o.id,
      });
      expect(segunda.ok).toBe(false);
      if (!segunda.ok) expect(segunda.error).toMatch(/já tem comissão/i);
    });
  });

  it("o resumo separa pendente, aprovada e paga", async () => {
    await asOwner(dono, async () => {
      await registrarComissao({ employeeId, amount: 500, competence: COMP });
      await registrarComissao({ employeeId, amount: 300, competence: COMP });
      const r = await resumoDeComissoes(COMP);
      expect(r.total).toBe(800);
      expect(r.pendente).toBe(800);
      expect(r.paga).toBe(0);
      expect(r.quantidade).toBe(2);
    });
  });
});
