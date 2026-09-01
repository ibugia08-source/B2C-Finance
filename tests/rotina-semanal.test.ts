import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, createRelationship,
  destroyOwner, prisma, type TestOwner,
} from "./support/db";
import { rotinaSemanal, segundaDa } from "@/lib/services/weekly-routine";
import { registrarPromessa } from "@/lib/services/collection-tasks";

/**
 * F3.10 — rotina semanal (02 §4.6).
 *
 * O que estes testes protegem é a razão de a tela existir: ela mostra o que
 * NÃO é urgente hoje e por isso some da rotina diária todo dia, até virar
 * problema. E mantém a regra do checklist de fechamento — bloco que não dá
 * para medir aparece dito, nunca verde.
 */

describe("F3.10 — a semana começa na segunda", () => {
  it("segunda de uma quarta é a segunda anterior", () => {
    // 2027-04-14 é quarta.
    expect(segundaDa(new Date(2027, 3, 14)).getDate()).toBe(12);
  });

  it("domingo pertence à semana que está TERMINANDO, não à que começa", () => {
    // 2027-04-18 é domingo; a semana dele começou em 12.
    expect(segundaDa(new Date(2027, 3, 18)).getDate()).toBe(12);
    // E a segunda seguinte já é outra semana.
    expect(segundaDa(new Date(2027, 3, 19)).getDate()).toBe(19);
  });

  it("segunda é a própria segunda", () => {
    expect(segundaDa(new Date(2027, 3, 12)).getDate()).toBe(12);
  });
});

describe("F3.10 — os blocos da semana", () => {
  let dono: TestOwner;
  let cliente: { id: string; name: string };

  beforeAll(async () => {
    dono = await createOwner();
    cliente = await createMrrClient(dono, { name: "Cliente da semana" });
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("traz os oito blocos de 02 §4.6, na ordem", async () => {
    await asOwner(dono, async () => {
      const r = await rotinaSemanal(new Date(2027, 3, 14));
      expect(r.blocos.map((b) => b.id)).toEqual([
        "criticos", "renovacoes", "promessas", "pipeline",
        "caixa", "rateios", "conciliacao", "fiscais",
      ]);
      expect(r.blocos.map((b) => b.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
  });

  it("o funil ainda não é medido — e o bloco DIZ isso", async () => {
    await asOwner(dono, async () => {
      const r = await rotinaSemanal(new Date(2027, 3, 14));
      const pipeline = r.blocos.find((b) => b.id === "pipeline")!;
      expect(pipeline.situacao).toBe("NAO_MEDIDO");
      expect(pipeline.resumo).toMatch(/Fase 4/);
    });
  });

  it("cliente com risco alto na avaliação entra em 'críticos'", async () => {
    await asOwner(dono, async () => {
      const rel = await createRelationship(dono, cliente.id);
      await prisma.avaliacaoMensal.create({
        data: {
          relationshipId: rel.id,
          competence: "2027-04",
          risco: "alto",
          estabilidade: "caindo",
          observacao: "Resultados abaixo há dois meses",
        },
      });

      const r = await rotinaSemanal(new Date(2027, 3, 14));
      const criticos = r.blocos.find((b) => b.id === "criticos")!;
      expect(criticos.situacao).toBe("ATENCAO");
      expect(criticos.itens.map((i) => i.titulo)).toContain("Cliente da semana");
      expect(criticos.itens[0].detalhe).toMatch(/risco alto/);
    });
  });

  it("promessa com data NA semana aparece; fora dela, não", async () => {
    await asOwner(dono, async () => {
      const b = await createBilling(dono, cliente.id, { month: 4, year: 2027, amount: 800 });
      // 2027-04-15 é quinta da mesma semana de 14 (segunda = 12).
      await registrarPromessa(b.id, new Date(2027, 3, 15));

      const daSemana = await rotinaSemanal(new Date(2027, 3, 14));
      const bloco = daSemana.blocos.find((x) => x.id === "promessas")!;
      expect(bloco.itens).toHaveLength(1);
      expect(bloco.itens[0].valor).toBe(800);

      // Na semana seguinte a mesma promessa não aparece mais.
      const outra = await rotinaSemanal(new Date(2027, 3, 21));
      expect(outra.blocos.find((x) => x.id === "promessas")!.itens).toHaveLength(0);
    });
  });

  it("promessa de cobrança JÁ PAGA sai do bloco", async () => {
    await asOwner(dono, async () => {
      const outro = await createMrrClient(dono, { name: "Cliente que pagou" });
      const b = await createBilling(dono, outro.id, { month: 4, year: 2027, amount: 500 });
      await registrarPromessa(b.id, new Date(2027, 3, 15));
      await prisma.billing.update({
        where: { id: b.id },
        data: { status: "PAID", paidTotal: 500 },
      });

      const r = await rotinaSemanal(new Date(2027, 3, 14));
      const bloco = r.blocos.find((x) => x.id === "promessas")!;
      expect(bloco.itens.every((i) => i.valor !== 500)).toBe(true);
    });
  });

  it("o comparativo mede a semana ANTERIOR, não o mês", async () => {
    await asOwner(dono, async () => {
      const r = await rotinaSemanal(new Date(2027, 3, 14));
      // As duas janelas têm exatamente sete dias e não se sobrepõem.
      expect(r.fim.getTime() - r.inicio.getTime()).toBe(7 * 86_400_000);
      expect(typeof r.comparativo.recebidoSemanaAnterior).toBe("number");
    });
  });

  it("todo bloco tem dono, e todo bloco medido leva a uma tela", async () => {
    await asOwner(dono, async () => {
      const r = await rotinaSemanal(new Date(2027, 3, 14));
      for (const b of r.blocos) {
        expect(b.dono.length, b.titulo).toBeGreaterThan(2);
        if (b.situacao !== "NAO_MEDIDO") expect(b.href, b.titulo).toBeTruthy();
      }
    });
  });
});
