import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import {
  distribuirIgualmente, distribuirPorPeso, naoAlocado, porPercentual,
} from "@/lib/allocations/split";
import { margemDeContribuicao } from "@/lib/services/contribution-margin";

/**
 * DISTRIBUIÇÃO DETERMINÍSTICA E MARGEM DE CONTRIBUIÇÃO.
 *
 * O rateio de mídia por cliente saiu em 10/09/2026. A ARITMÉTICA dele ficou —
 * quem usa agora é o overhead da margem totalmente alocada (F5.5) —, e ela
 * erra em silêncio: um centavo perdido por arredondamento não aparece em tela
 * nenhuma; só faz a soma das partes não bater com o todo.
 *
 * A margem de contribuição continua existindo, com a fórmula v2: receita
 * reconhecida menos os custos DIRETOS, isto é, as despesas com o cliente
 * escrito nelas. Sem rateio, não há mais a armadilha da contagem dupla — e o
 * aviso de que isto NÃO é lucro continua viajando junto com o número.
 */

const INICIO = new Date(2027, 2, 5);

describe("a aritmética da distribuição, sem banco", () => {
  it("a soma das fatias é exatamente o total, em qualquer divisão", () => {
    for (const total of [100, 1000, 333.33, 9999.99, 0.03, 12345.67]) {
      for (const partes of [1, 2, 3, 6, 7, 11]) {
        const fatias = distribuirIgualmente(
          total,
          Array.from({ length: partes }, (_, i) => `c${i}`)
        );
        const soma = fatias.reduce((s, f) => s + f.amount, 0);
        expect(Math.round(soma * 100)).toBe(Math.round(total * 100));
      }
    }
  });

  it("R$ 100 em 3 partes soma 100,00 (S21)", () => {
    const f = distribuirIgualmente(100, ["a", "b", "c"]);
    expect(f.map((x) => x.amount)).toEqual([33.33, 33.33, 33.34]);
  });

  it("o residual vai para o MAIOR peso", () => {
    const f = distribuirPorPeso(100, [
      { id: "grande", peso: 7 },
      { id: "pequeno", peso: 1 },
    ]);
    const grande = f.find((x) => x.id === "grande")!;
    const pequeno = f.find((x) => x.id === "pequeno")!;
    expect(grande.amount + pequeno.amount).toBe(100);
    // 87,5 e 12,5 fecham redondo; com 3 pesos o centavo aparece:
    const g = distribuirPorPeso(100, [
      { id: "a", peso: 1 }, { id: "b", peso: 1 }, { id: "c", peso: 4 },
    ]);
    expect(g.find((x) => x.id === "c")!.amount).toBeGreaterThan(66);
    expect(g.reduce((s, x) => s + x.amount, 0)).toBe(100);
  });

  it("é DETERMINÍSTICO: a mesma entrada dá a mesma saída", () => {
    const a = distribuirPorPeso(777.77, [
      { id: "x", peso: 3 }, { id: "y", peso: 3 }, { id: "z", peso: 1 },
    ]);
    const b = distribuirPorPeso(777.77, [
      { id: "x", peso: 3 }, { id: "y", peso: 3 }, { id: "z", peso: 1 },
    ]);
    expect(a).toEqual(b);
  });

  it("pesos todos zerados viram divisão igualitária, não divisão por zero", () => {
    const f = distribuirPorPeso(90, [
      { id: "a", peso: 0 }, { id: "b", peso: 0 }, { id: "c", peso: 0 },
    ]);
    expect(f.map((x) => x.amount)).toEqual([30, 30, 30]);
  });

  it("peso negativo é recusado", () => {
    expect(() => distribuirPorPeso(100, [{ id: "a", peso: -1 }])).toThrow();
  });

  it("distribuição parcial deixa sobra visível", () => {
    const f = porPercentual(1000, [{ id: "a", percentual: 30 }]);
    expect(f[0].amount).toBe(300);
    expect(naoAlocado(1000, f)).toBe(700);
  });
});

describe("margem de contribuição por cliente (v2, sem rateio)", () => {
  let dono: TestOwner;
  let cliente: { id: string; name: string };

  beforeAll(async () => {
    dono = await createOwner();
    cliente = await createMrrClient(dono, { name: "Cliente da margem" });
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("receita reconhecida menos os custos diretos do cliente", async () => {
    await asOwner(dono, async () => {
      await createBilling(dono, cliente.id, { month: 3, year: 2027, amount: 3000 });

      await prisma.transaction.create({
        data: {
          date: INICIO, description: "Ferramenta do cliente", amount: 200,
          type: "despesa", status: "pago", belongsTo: "empresa", clientId: cliente.id,
        },
      });
      // Mídia COM o cliente escrito nela: antes ela era rateada e contava
      // pelas linhas do rateio; agora é custo direto como qualquer outra.
      await prisma.transaction.create({
        data: {
          date: INICIO, description: "META ADS", amount: 500,
          type: "despesa", expenseType: "ADS", status: "pago",
          belongsTo: "empresa", clientId: cliente.id,
        },
      });

      const m = await margemDeContribuicao("2027-03");
      const linha = m.linhas.find((l) => l.clientId === cliente.id)!;
      expect(linha.receita).toBe(3000);
      expect(linha.custosDiretos).toBe(700);
      expect(linha.custoTotal).toBe(700);
      expect(linha.margem).toBe(2300);
    });
  });

  it("despesa SEM cliente não entra na margem de ninguém", async () => {
    await asOwner(dono, async () => {
      await prisma.transaction.create({
        data: {
          date: INICIO, description: "META ADS institucional", amount: 900,
          type: "despesa", expenseType: "ADS", status: "pago", belongsTo: "empresa",
        },
      });
      const m = await margemDeContribuicao("2027-03");
      const linha = m.linhas.find((l) => l.clientId === cliente.id)!;
      // Continua 700: mídia sem dono é overhead, e overhead só entra na
      // margem TOTALMENTE alocada (F5.5), que diz que está fazendo isso.
      expect(linha.custoTotal).toBe(700);
    });
  });

  it("o aviso de que isto NÃO é lucro viaja junto com o número (01 §7.4)", async () => {
    await asOwner(dono, async () => {
      const m = await margemDeContribuicao("2027-03");
      expect(m.overheadForaDaConta).toMatch(/não lucro do cliente/i);
    });
  });
});
