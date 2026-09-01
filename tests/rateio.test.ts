import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  distribuirIgualmente, distribuirPorPeso, naoAlocado, porPercentual,
} from "@/lib/allocations/split";
import {
  aplicarRegras, despesasParaRatear, rateioDaOrigem, ratearPorPeso,
  resumoDoRateio, salvarRateio,
} from "@/lib/services/allocation";
import { margemDeContribuicao } from "@/lib/services/contribution-margin";
import { categoriaDe, permiteEvento } from "@/lib/periods/events";
import { fecharPeriodo, iniciarFechamento, reabrirParaOperacao } from "@/lib/services/closing-period";
import { montarChecklist } from "@/lib/services/closing-checklist";

/**
 * F3.4 — motor de rateio, regras e margem de contribuição.
 *
 * Duas invariantes carregam o módulo inteiro, e as duas erram em SILÊNCIO:
 *
 *  1. o rateio soma exatamente a origem (01 §3.14) — um centavo perdido por
 *     arredondamento não aparece em tela nenhuma;
 *  2. o rateio NUNCA ultrapassa a origem (01 §4.7) — ratear 120% de uma
 *     fatura não estoura nada: só faz a soma das margens ficar menor que o
 *     resultado real, e ninguém procura a diferença no lugar certo.
 */

const COMP = "2027-03";
const INICIO = new Date(2027, 2, 5);

describe("F3.4 — a aritmética, sem banco", () => {
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

  it("pesos todos zerados viram rateio igualitário, não divisão por zero", () => {
    const f = distribuirPorPeso(90, [
      { id: "a", peso: 0 }, { id: "b", peso: 0 }, { id: "c", peso: 0 },
    ]);
    expect(f.map((x) => x.amount)).toEqual([30, 30, 30]);
  });

  it("peso negativo é recusado", () => {
    expect(() => distribuirPorPeso(100, [{ id: "a", peso: -1 }])).toThrow();
  });

  it("rateio parcial deixa sobra visível", () => {
    const f = porPercentual(1000, [{ id: "a", percentual: 30 }]);
    expect(f[0].amount).toBe(300);
    expect(naoAlocado(1000, f)).toBe(700);
  });
});

describe("F3.4 — o rateio no banco", () => {
  let dono: TestOwner;
  let clienteA: { id: string; name: string };
  let clienteB: { id: string; name: string };
  let despesaId: string;

  async function criarDespesaDeMidia(valor: number, descricao = "META ADS - CAMPANHA") {
    return asOwner(dono, async () => {
      const t = await prisma.transaction.create({
        data: {
          date: INICIO,
          description: descricao,
          amount: valor,
          type: "despesa",
          expenseType: "ADS",
          status: "pago",
          belongsTo: "empresa",
        },
        select: { id: true },
      });
      return t.id;
    });
  }

  beforeAll(async () => {
    dono = await createOwner();
    clienteA = await createMrrClient(dono, { name: "Cliente A do rateio" });
    clienteB = await createMrrClient(dono, { name: "Cliente B do rateio" });
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.allocation.deleteMany({});
      await prisma.allocationRule.deleteMany({});
      await prisma.transaction.deleteMany({ where: { expenseType: "ADS" } });
    });
    despesaId = await criarDespesaDeMidia(1000);
  });

  afterAll(async () => {
    await asOwner(dono, async () => {
      await prisma.allocation.deleteMany({});
      await prisma.allocationRule.deleteMany({});
      await prisma.transaction.deleteMany({ where: { expenseType: "ADS" } });
    });
    await destroyOwner(dono);
  });

  it("grava o rateio e mostra o que ficou sem dono", async () => {
    await asOwner(dono, async () => {
      const r = await ratearPorPeso(despesaId, "CLIENT", [
        { id: clienteA.id, peso: 1 },
        { id: clienteB.id, peso: 1 },
      ], { valor: 600 });
      expect(r.ok).toBe(true);

      const rateio = (await rateioDaOrigem(despesaId))!;
      expect(rateio.alocado).toBe(600);
      expect(rateio.naoAlocado).toBe(400);
      expect(rateio.linhas).toHaveLength(2);
    });
  });

  it("salvar de novo SUBSTITUI: 40/60 corrigido para 50/50 não vira 200%", async () => {
    await asOwner(dono, async () => {
      await ratearPorPeso(despesaId, "CLIENT", [
        { id: clienteA.id, peso: 4 },
        { id: clienteB.id, peso: 6 },
      ]);
      await ratearPorPeso(despesaId, "CLIENT", [
        { id: clienteA.id, peso: 1 },
        { id: clienteB.id, peso: 1 },
      ]);
      const rateio = (await rateioDaOrigem(despesaId))!;
      expect(rateio.linhas).toHaveLength(2);
      expect(rateio.alocado).toBe(1000);
      expect(rateio.linhas.every((l) => l.amount === 500)).toBe(true);
    });
  });

  it("o SERVIÇO recusa rateio acima da origem", async () => {
    await asOwner(dono, async () => {
      const r = await salvarRateio({
        sourceId: despesaId,
        linhas: [
          { dimensionType: "CLIENT", dimensionId: clienteA.id, amount: 800 },
          { dimensionType: "CLIENT", dimensionId: clienteB.id, amount: 400 },
        ],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/1200,00|1200\.00/);
    });
  });

  it("o BANCO recusa rateio acima da origem, mesmo por fora do serviço", async () => {
    await asOwner(dono, async () => {
      await prisma.allocation.create({
        data: {
          sourceType: "TRANSACTION", sourceId: despesaId,
          dimensionType: "CLIENT", dimensionId: clienteA.id,
          amount: 900, competence: COMP,
        },
      });
      // Segunda linha estoura o total: é o gatilho, não o serviço, que barra.
      await expect(
        prisma.allocation.create({
          data: {
            sourceType: "TRANSACTION", sourceId: despesaId,
            dimensionType: "CLIENT", dimensionId: clienteB.id,
            amount: 200, competence: COMP,
          },
        })
      ).rejects.toThrow(/ultrapassa/i);
    });
  });

  it("a mesma dimensão duas vezes é recusada", async () => {
    await asOwner(dono, async () => {
      const r = await salvarRateio({
        sourceId: despesaId,
        linhas: [
          { dimensionType: "CLIENT", dimensionId: clienteA.id, amount: 100 },
          { dimensionType: "CLIENT", dimensionId: clienteA.id, amount: 100 },
        ],
      });
      expect(r.ok).toBe(false);
    });
  });

  it("o resumo mede VALOR, não quantidade de lançamentos", async () => {
    await asOwner(dono, async () => {
      const grande = await criarDespesaDeMidia(9000, "GOOGLE ADS - GRANDE");
      await ratearPorPeso(despesaId, "CLIENT", [{ id: clienteA.id, peso: 1 }]);

      const resumo = await resumoDoRateio(COMP);
      expect(resumo.despesas).toBe(2);
      expect(resumo.totalMidia).toBe(10000);
      expect(resumo.alocado).toBe(1000);
      // Metade dos LANÇAMENTOS está pronta, mas só 10% do dinheiro.
      expect(resumo.percentualConcluido).toBe(10);
      expect(resumo.semNenhumRateio).toBe(1);
      expect(grande).toBeTruthy();
    });
  });
});

describe("F3.4 — regras", () => {
  let dono: TestOwner;
  let cliente: { id: string; name: string };
  let outro: { id: string; name: string };

  beforeAll(async () => {
    dono = await createOwner();
    cliente = await createMrrClient(dono, { name: "Padaria do Bairro" });
    outro = await createMrrClient(dono, { name: "Oficina Central" });
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.allocation.deleteMany({});
      await prisma.allocationRule.deleteMany({});
      await prisma.transaction.deleteMany({ where: { expenseType: "ADS" } });
    });
  });

  afterAll(async () => {
    await asOwner(dono, async () => {
      await prisma.allocation.deleteMany({});
      await prisma.allocationRule.deleteMany({});
      await prisma.transaction.deleteMany({ where: { expenseType: "ADS" } });
    });
    await destroyOwner(dono);
  });

  async function despesa(descricao: string, valor: number) {
    return asOwner(dono, async () =>
      (
        await prisma.transaction.create({
          data: {
            date: INICIO, description: descricao, amount: valor,
            type: "despesa", expenseType: "ADS", status: "pago", belongsTo: "empresa",
          },
          select: { id: true },
        })
      ).id
    );
  }

  it("a regra reconhece a campanha pela descrição e manda 100% para o dono", async () => {
    await asOwner(dono, async () => {
      await despesa("META ADS PADARIA-BAIRRO 03", 400);
      await prisma.allocationRule.create({
        data: {
          name: "Campanha Padaria", descriptionContains: "PADARIA-BAIRRO",
          dimensionType: "CLIENT", dimensionId: cliente.id,
        },
      });
      const r = await aplicarRegras(COMP);
      expect(r.aplicadas).toBe(1);
      expect(r.valor).toBe(400);

      const lista = await despesasParaRatear(COMP);
      expect(lista[0].linhas[0].nome).toBe("Padaria do Bairro");
      expect(lista[0].naoAlocado).toBe(0);
      expect(lista[0].linhas[0].method).toBe("RULE");
    });
  });

  it("a regra NÃO sobrescreve rateio feito à mão", async () => {
    await asOwner(dono, async () => {
      const id = await despesa("META ADS PADARIA-BAIRRO 03", 400);
      await ratearPorPeso(id, "CLIENT", [{ id: outro.id, peso: 1 }]);
      await prisma.allocationRule.create({
        data: {
          name: "Campanha Padaria", descriptionContains: "PADARIA-BAIRRO",
          dimensionType: "CLIENT", dimensionId: cliente.id,
        },
      });
      const r = await aplicarRegras(COMP);
      expect(r.aplicadas).toBe(0);

      const lista = await despesasParaRatear(COMP);
      expect(lista[0].linhas[0].dimensionId).toBe(outro.id);
    });
  });

  it("regra SEM condição nenhuma não casa com nada", async () => {
    await asOwner(dono, async () => {
      await despesa("QUALQUER COISA", 100);
      await prisma.allocationRule.create({
        data: { name: "Vale tudo", dimensionType: "CLIENT", dimensionId: cliente.id },
      });
      const r = await aplicarRegras(COMP);
      expect(r.aplicadas).toBe(0);
      expect(r.semRegra).toBe(1);
    });
  });
});

describe("F3.4 — margem de contribuição", () => {
  let dono: TestOwner;
  let cliente: { id: string; name: string };

  beforeAll(async () => {
    dono = await createOwner();
    cliente = await createMrrClient(dono, { name: "Cliente da margem" });
  });

  afterAll(async () => {
    await asOwner(dono, async () => {
      await prisma.allocation.deleteMany({});
      await prisma.transaction.deleteMany({ where: { expenseType: "ADS" } });
    });
    await destroyOwner(dono);
  });

  it("receita reconhecida − custo direto − custo rateado, SEM contar duas vezes", async () => {
    await asOwner(dono, async () => {
      await createBilling(dono, cliente.id, { month: 3, year: 2027, amount: 3000 });

      // Custo direto: despesa com o cliente escrito nela e SEM rateio.
      await prisma.transaction.create({
        data: {
          date: INICIO, description: "Ferramenta do cliente", amount: 200,
          type: "despesa", status: "pago", belongsTo: "empresa", clientId: cliente.id,
        },
      });

      // Mídia com o cliente escrito nela E rateada — a armadilha da contagem
      // dupla mora exatamente aqui.
      const midia = await prisma.transaction.create({
        data: {
          date: INICIO, description: "META ADS", amount: 500,
          type: "despesa", expenseType: "ADS", status: "pago",
          belongsTo: "empresa", clientId: cliente.id,
        },
        select: { id: true },
      });
      await ratearPorPeso(midia.id, "CLIENT", [{ id: cliente.id, peso: 1 }]);

      const m = await margemDeContribuicao("2027-03");
      const linha = m.linhas.find((l) => l.clientId === cliente.id)!;
      expect(linha.receita).toBe(3000);
      expect(linha.custosDiretos).toBe(200);
      expect(linha.custosRateados).toBe(500);
      // 700, não 1200: a mídia conta uma vez só.
      expect(linha.custoTotal).toBe(700);
      expect(linha.margem).toBe(2300);
    });
  });

  it("o aviso de que isto NÃO é lucro viaja junto com o número (01 §7.4)", async () => {
    await asOwner(dono, async () => {
      const m = await margemDeContribuicao("2027-03");
      expect(m.overheadForaDaConta).toMatch(/não lucro do cliente/i);
    });
  });
});

describe("F3.4 — período e checklist", () => {
  let dono: TestOwner;
  let cliente: { id: string; name: string };
  let despesaId: string;

  beforeAll(async () => {
    dono = await createOwner();
    cliente = await createMrrClient(dono, { name: "Cliente do fechamento" });
    despesaId = await asOwner(dono, async () =>
      (
        await prisma.transaction.create({
          data: {
            date: new Date(2027, 3, 5), description: "META ADS ABRIL", amount: 800,
            type: "despesa", expenseType: "ADS", status: "pago", belongsTo: "empresa",
          },
          select: { id: true },
        })
      ).id
    );
  });

  afterAll(async () => {
    await runWithoutScope(async () => {
      await prisma.closingPeriod.deleteMany({ where: { competence: "2027-04" } });
    });
    await asOwner(dono, async () => {
      await prisma.allocation.deleteMany({});
      await prisma.transaction.deleteMany({ where: { expenseType: "ADS" } });
    });
    await destroyOwner(dono);
  });

  it("rateio é evento de FECHAMENTO, não econômico", () => {
    expect(categoriaDe("ALLOCATION_CHANGED")).toBe("FECHAMENTO");
    // Durante o fechamento ainda dá para concluir o rateio — é justamente
    // quando ele é feito, e é item do checklist.
    expect(permiteEvento("SOFT_CLOSED", "ALLOCATION_CHANGED").ok).toBe(true);
    expect(permiteEvento("CLOSED", "ALLOCATION_CHANGED").ok).toBe(false);
  });

  it("mês fechado bloqueia o rateio com a mensagem da reabertura", async () => {
    await asOwner(dono, async () => {
      await iniciarFechamento("2027-04", "teste");
      await fecharPeriodo("2027-04", "teste");

      const r = await ratearPorPeso(despesaId, "CLIENT", [{ id: cliente.id, peso: 1 }]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/reabrir/i);

      await reabrirParaOperacao("2027-04");
      const depois = await ratearPorPeso(despesaId, "CLIENT", [{ id: cliente.id, peso: 1 }]);
      expect(depois.ok).toBe(true);
    });
  });

  it("o item 9 do checklist deixou de ser 'não medido'", async () => {
    await asOwner(dono, async () => {
      const itens = await montarChecklist("2027-04");
      const rateio = itens.find((i) => i.id === "rateios")!;
      expect(rateio.situacao).not.toBe("NAO_MEDIDO");
      expect(rateio.href).toContain("/rateio");
    });
  });
});
