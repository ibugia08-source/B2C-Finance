import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asOwner, createOwner, destroyOwner, prisma, type TestOwner } from "./support/db";
import {
  definirMeta, leadsParaRetomar, metasDoMes, METRICAS_DE_META, painelDoCloser,
} from "@/lib/services/commercial-goals";
import { criarOportunidade, moverEtapa } from "@/lib/services/pipeline";
import { criarLead } from "@/lib/services/leads";

/**
 * F4.5 — metas e painéis por papel (02 §5.4).
 *
 * A regra que os testes protegem: o sistema NUNCA inventa meta. Sem linha
 * cadastrada, o painel mostra o número sem alvo — uma meta chutada por média
 * dos últimos meses viraria o alvo oficial sem ninguém ter decidido, e depois
 * cobra-se em cima dela.
 */
describe("F4.5 — metas e painel do closer", () => {
  let dono: TestOwner;
  const HOJE = new Date(2027, 5, 15);

  beforeAll(async () => {
    dono = await createOwner();
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.commercialGoal.deleteMany({});
      await prisma.pipelineEvent.deleteMany({});
      await prisma.opportunity.deleteMany({});
      await prisma.interaction.deleteMany({});
      await prisma.lead.deleteMany({});
    });
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("cada métrica declara em quais escopos faz sentido", () => {
    const ligacoes = METRICAS_DE_META.find((m) => m.id === "ligacoes")!;
    expect(ligacoes.escopos).toEqual(["SDR"]);
    const valor = METRICAS_DE_META.find((m) => m.id === "valor")!;
    expect(valor.escopos).toContain("CLOSER");
    // Oferecer "ligações" para um closer criaria meta que painel nenhum lê.
    expect(valor.escopos).not.toContain("SDR");
  });

  it("meta zerada é recusada — desligar se faz apagando a linha", async () => {
    await asOwner(dono, async () => {
      const r = await definirMeta({
        competence: "2027-06", scopeType: "SDR", scopeId: "Bianca",
        metric: "ligacoes", target: 0,
      });
      expect(r.ok).toBe(false);
    });
  });

  it("definir duas vezes ATUALIZA em vez de duplicar", async () => {
    await asOwner(dono, async () => {
      const base = {
        competence: "2027-06", scopeType: "CLOSER" as const, scopeId: "Vitor",
        metric: "vendas" as const,
      };
      await definirMeta({ ...base, target: 5 });
      await definirMeta({ ...base, target: 8 });
      const metas = await metasDoMes("2027-06");
      expect(metas).toHaveLength(1);
      expect(metas[0].target).toBe(8);
    });
  });

  it("SEM meta, o painel do closer mostra o número sem alvo", async () => {
    await asOwner(dono, async () => {
      const p = await painelDoCloser("Vitor", HOJE);
      expect(p.metaDeVendas).toBeNull();
      expect(p.metaDeValor).toBeNull();
      expect(p.vendas).toBe(0);
    });
  });

  it("conversão é sobre o que foi DECIDIDO no mês", async () => {
    await asOwner(dono, async () => {
      const criar = async (titulo: string) => {
        const r = await criarOportunidade({ title: titulo, amount: 1000, closer: "Vitor" });
        if (!r.ok) throw new Error(r.error);
        return r.id;
      };
      const g1 = await criar("Ganha 1");
      const g2 = await criar("Ganha 2");
      const p1 = await criar("Perdida 1");
      await criar("Ainda aberta"); // não entra na conta

      await moverEtapa(g1, "GANHA", { quando: HOJE });
      await moverEtapa(g2, "GANHA", { quando: HOJE });
      await moverEtapa(p1, "PERDIDA", { motivo: "Preço", quando: HOJE });

      const p = await painelDoCloser("Vitor", HOJE);
      expect(p.vendas).toBe(2);
      expect(p.perdidasNoMes).toBe(1);
      // 2 de 3 DECIDIDAS. Dividir pelo funil inteiro (4) daria 50% e a taxa
      // cairia toda vez que entrasse lead novo.
      expect(p.conversao).toBe(66.7);
    });
  });

  it("o painel aponta as vendas ganhas que não viraram cliente", async () => {
    await asOwner(dono, async () => {
      const r = await criarOportunidade({ title: "Ganha sem entrega", amount: 2000, closer: "Vitor" });
      if (!r.ok) return;
      await moverEtapa(r.id, "GANHA", { quando: HOJE });

      const p = await painelDoCloser("Vitor", HOJE);
      expect(p.semHandoff.map((s) => s.id)).toContain(r.id);
    });
  });

  it("pipeline por etapa soma valor e quantidade por coluna", async () => {
    await asOwner(dono, async () => {
      const a = await criarOportunidade({ title: "A", amount: 1000, closer: "Vitor" });
      const b = await criarOportunidade({ title: "B", amount: 500, closer: "Vitor" });
      if (!a.ok || !b.ok) return;
      await moverEtapa(a.id, "PROPOSTA", { quando: HOJE });

      const p = await painelDoCloser("Vitor", HOJE);
      const proposta = p.porEtapa.find((e) => e.etapa === "PROPOSTA")!;
      const nova = p.porEtapa.find((e) => e.etapa === "NOVA")!;
      expect(proposta.quantidade).toBe(1);
      expect(proposta.valor).toBe(1000);
      expect(nova.quantidade).toBe(1);
      expect(nova.valor).toBe(500);
    });
  });

  it("retomadas: lead sem toque há mais de uma semana", async () => {
    await asOwner(dono, async () => {
      const antigo = await criarLead({ name: "Esquecido", company: "Empresa A", sdr: "Bianca" });
      const recente = await criarLead({ name: "Recente", company: "Empresa B", sdr: "Bianca" });
      if (!antigo.ok || !recente.ok) return;

      await prisma.lead.updateMany({
        where: { id: { in: [antigo.lead.id, recente.lead.id] } },
        data: { status: "CONTACTED" },
      });
      await prisma.lead.update({
        where: { id: antigo.lead.id },
        data: { createdAt: new Date(HOJE.getTime() - 20 * 86_400_000) },
      });
      await prisma.interaction.create({
        data: {
          leadId: recente.lead.id, type: "LIGACAO",
          happenedAt: new Date(HOJE.getTime() - 2 * 86_400_000),
        },
      });

      const lista = await leadsParaRetomar("Bianca", HOJE);
      expect(lista.map((l) => l.id)).toEqual([antigo.lead.id]);
      expect(lista[0].diasSemToque).toBe(20);
    });
  });

  it("lead CONVERTIDO ou PERDIDO não entra em retomadas", async () => {
    await asOwner(dono, async () => {
      const l = await criarLead({ name: "Perdido", company: "Empresa C", sdr: "Bianca" });
      if (!l.ok) return;
      await prisma.lead.update({
        where: { id: l.lead.id },
        data: {
          status: "LOST",
          lostReason: "Sem verba",
          createdAt: new Date(HOJE.getTime() - 30 * 86_400_000),
        },
      });
      expect(await leadsParaRetomar("Bianca", HOJE)).toHaveLength(0);
    });
  });
});
