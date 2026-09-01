import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, destroyOwner, prisma, type TestOwner,
} from "./support/db";
import {
  carregarFunil, criarOportunidade, funilEm, moverEtapa, tempoPorEtapa,
} from "@/lib/services/pipeline";
import { COLUNAS_DO_QUADRO, DIAS_PARA_PARADA, ORDEM_DA_ETAPA } from "@/lib/commercial/funil";

/**
 * F4.2 — funil, tempo por etapa e reconstrução histórica (01 §4.6).
 *
 * A decisão que estes testes protegem: a etapa atual é um CACHE; a verdade é
 * a lista de eventos. Sem isso, mudar a etapa sobrescreve a anterior e o
 * funil do mês passado é irrecuperável — que é exatamente o que a spec manda
 * evitar ao pedir a tabela de eventos.
 */
describe("F4.2 — o funil", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.pipelineEvent.deleteMany({});
      await prisma.opportunity.deleteMany({});
    });
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("as cinco colunas do quadro, sem as terminais", () => {
    expect(COLUNAS_DO_QUADRO.map((c) => c.id)).toEqual([
      "NOVA", "QUALIFICACAO", "REUNIAO", "PROPOSTA", "NEGOCIACAO",
    ]);
    expect(ORDEM_DA_ETAPA.NEGOCIACAO).toBeGreaterThan(ORDEM_DA_ETAPA.NOVA);
  });

  it("oportunidade NASCE com o evento de criação", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Padaria — tráfego", amount: 1500 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const eventos = await prisma.pipelineEvent.findMany({ where: { opportunityId: r.id } });
      expect(eventos).toHaveLength(1);
      expect(eventos[0].fromStage).toBeNull();
      expect(eventos[0].toStage).toBe("NOVA");
    });
  });

  it("mover grava evento e etapa na MESMA transação", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Oficina", amount: 900 });
      if (!r.ok) return;
      const m = await moverEtapa(r.id, "PROPOSTA");
      expect(m.ok && m.avancou).toBe(true);

      const o = await prisma.opportunity.findUniqueOrThrow({ where: { id: r.id } });
      expect(o.stage).toBe("PROPOSTA");
      const eventos = await prisma.pipelineEvent.findMany({
        where: { opportunityId: r.id },
        orderBy: { changedAt: "asc" },
      });
      expect(eventos).toHaveLength(2);
      expect(eventos[1].fromStage).toBe("NOVA");
      expect(eventos[1].toStage).toBe("PROPOSTA");
    });
  });

  it("PERDIDA exige motivo — no serviço e no banco", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Sem motivo", amount: 100 });
      if (!r.ok) return;

      const semMotivo = await moverEtapa(r.id, "PERDIDA");
      expect(semMotivo.ok).toBe(false);

      const comMotivo = await moverEtapa(r.id, "PERDIDA", { motivo: "Preço acima do orçamento" });
      expect(comMotivo.ok).toBe(true);

      const o = await prisma.opportunity.findUniqueOrThrow({ where: { id: r.id } });
      expect(o.lostAt).not.toBeNull();
      expect(o.wonAt).toBeNull();
      expect(o.lostReason).toMatch(/orçamento/);
    });
  });

  it("mover de PERDIDA para GANHA limpa a data antiga (o CHECK exige)", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Voltou", amount: 500 });
      if (!r.ok) return;
      await moverEtapa(r.id, "PERDIDA", { motivo: "Adiou a decisão" });
      const g = await moverEtapa(r.id, "GANHA");
      expect(g.ok).toBe(true);

      const o = await prisma.opportunity.findUniqueOrThrow({ where: { id: r.id } });
      expect(o.wonAt).not.toBeNull();
      expect(o.lostAt).toBeNull();
      expect(o.lostReason).toBeNull();
    });
  });

  it("o quadro marca como parada quem não anda há 7 dias", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Esquecida", amount: 2000 });
      if (!r.ok) return;
      const antigo = new Date(Date.now() - 20 * 86_400_000);
      await prisma.pipelineEvent.updateMany({
        where: { opportunityId: r.id },
        data: { changedAt: antigo },
      });
      await prisma.opportunity.update({ where: { id: r.id }, data: { createdAt: antigo } });

      const f = await carregarFunil();
      const card = f.colunas.flatMap((c) => c.cards).find((c) => c.id === r.id)!;
      expect(card.diasNaEtapa).toBeGreaterThanOrEqual(DIAS_PARA_PARADA);
      expect(card.parada).toBe(true);
      expect(f.paradas).toBe(1);
    });
  });

  it("tempo por etapa conta só as passagens CONCLUÍDAS", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Com histórico", amount: 1000 });
      if (!r.ok) return;

      const dia = (d: number) => new Date(2027, 0, d);
      await prisma.pipelineEvent.updateMany({
        where: { opportunityId: r.id },
        data: { changedAt: dia(1) },
      });
      await moverEtapa(r.id, "QUALIFICACAO", { quando: dia(5) }); // 4 dias em NOVA
      await moverEtapa(r.id, "PROPOSTA", { quando: dia(11) }); // 6 em QUALIFICACAO

      const t = await tempoPorEtapa();
      const nova = t.find((x) => x.etapa === "NOVA")!;
      const qualificacao = t.find((x) => x.etapa === "QUALIFICACAO")!;
      const proposta = t.find((x) => x.etapa === "PROPOSTA")!;

      expect(nova.mediaDeDias).toBe(4);
      expect(qualificacao.mediaDeDias).toBe(6);
      // A oportunidade AINDA está em proposta: a passagem não fechou, e
      // contá-la puxaria a média para baixo todo dia.
      expect(proposta.mediaDeDias).toBeNull();
      expect(proposta.amostras).toBe(0);
    });
  });

  it("reconstrói o funil de uma data PASSADA a partir dos eventos", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Máquina do tempo", amount: 3000 });
      if (!r.ok) return;
      const dia = (d: number) => new Date(2027, 1, d);
      await prisma.pipelineEvent.updateMany({
        where: { opportunityId: r.id },
        data: { changedAt: dia(1) },
      });
      await prisma.opportunity.update({ where: { id: r.id }, data: { createdAt: dia(1) } });
      await moverEtapa(r.id, "REUNIAO", { quando: dia(10) });
      await moverEtapa(r.id, "GANHA", { quando: dia(20) });

      // Hoje ela está GANHA; em 5 de fevereiro estava NOVA.
      expect((await funilEm(dia(5))).NOVA).toBe(1);
      expect((await funilEm(dia(5))).GANHA).toBe(0);
      expect((await funilEm(dia(15))).REUNIAO).toBe(1);
      expect((await funilEm(dia(25))).GANHA).toBe(1);
      // Antes de existir, ela não aparece em retrato nenhum.
      expect(Object.values(await funilEm(new Date(2027, 0, 1))).reduce((a, b) => a + b, 0)).toBe(0);
    });
  });

  it("evento que não muda de etapa é recusado pelo banco", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Ruído", amount: 100 });
      if (!r.ok) return;
      await expect(
        prisma.pipelineEvent.create({
          data: { opportunityId: r.id, fromStage: "NOVA", toStage: "NOVA" },
        })
      ).rejects.toThrow();
    });
  });

  it("mover para a MESMA etapa não gera evento", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Sem movimento", amount: 100 });
      if (!r.ok) return;
      const m = await moverEtapa(r.id, "NOVA");
      expect(m.ok && m.avancou).toBe(false);
      expect(await prisma.pipelineEvent.count({ where: { opportunityId: r.id } })).toBe(1);
    });
  });
});
