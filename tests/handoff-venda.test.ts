import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, destroyOwner, prisma, type TestOwner,
} from "./support/db";
import { criarLead } from "@/lib/services/leads";
import { criarOportunidade, moverEtapa } from "@/lib/services/pipeline";
import { fecharVenda, vendasSemHandoff } from "@/lib/services/sale-handoff";

/**
 * F4.4 — handoff da venda (01 §6.1).
 *
 * A frase que governa: "Sem contrato aprovado, o lançamento direto continua
 * possível." O contrato FORMALIZA, não bloqueia — nasce rascunho e nada
 * espera por ele. Um sistema que trava a operação até alguém assinar o PDF é
 * um sistema que a equipe contorna lançando por fora, e o dado real volta a
 * viver na planilha.
 *
 * Cenário S3: TCV de 3.000 em 2x cria Client, Relationship, Contract e DUAS
 * cobranças; vendido = 3.000 no mês da venda, faturado = 1.500 por competência.
 */
describe("F4.4 — da venda à operação", () => {
  let dono: TestOwner;
  const HOJE = new Date(2027, 4, 10);

  beforeAll(async () => {
    dono = await createOwner();
  });

  beforeEach(async () => {
    await asOwner(dono, async () => {
      await prisma.billing.deleteMany({});
      await prisma.pipelineEvent.deleteMany({});
      await prisma.opportunity.deleteMany({});
      await prisma.lead.deleteMany({});
      await prisma.onboardingTask.deleteMany({});
      await prisma.commercialTerm.deleteMany({});
      await prisma.clientAgencyRelationship.updateMany({ data: { currentCommercialTermId: null } });
      await prisma.clientAgencyRelationship.deleteMany({});
      await prisma.contract.deleteMany({});
      await prisma.client.deleteMany({});
    });
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  async function vendaTcv(total = 3000, parcelas = 2) {
    const lead = await criarLead({ name: "Contato", company: "Padaria Nova", document: "11.222.333/0001-44" });
    if (!lead.ok) throw new Error(lead.error);
    const op = await criarOportunidade({
      title: "Gestão de tráfego — Padaria Nova",
      leadId: lead.lead.id,
      amount: total,
      modality: "TCV",
      months: 6,
      closer: "Vitor",
    });
    if (!op.ok) throw new Error(op.error);
    return { leadId: lead.lead.id, opportunityId: op.id, parcelas };
  }

  it("S3: TCV de 3.000 em 2x cria cliente, relação, contrato e DUAS cobranças", async () => {
    await asOwner(dono, async () => {
      const v = await vendaTcv();
      const r = await fecharVenda(v.opportunityId, {
        parcelas: 2,
        primeiroVencimento: new Date(2027, 4, 15),
        quando: HOJE,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const cliente = await prisma.client.findUniqueOrThrow({ where: { id: r.clientId } });
      expect(cliente.name).toBe("Padaria Nova");
      expect(cliente.status).toBe("ACTIVE");
      expect(Number(cliente.totalContractValue)).toBe(3000);

      expect(r.relationshipId).not.toBeNull();
      expect(r.contractId).not.toBeNull();
      expect(r.billingIds).toHaveLength(2);

      const cobrancas = await prisma.billing.findMany({
        where: { id: { in: r.billingIds } },
        orderBy: { installmentNumber: "asc" },
      });
      // Faturado = 1.500 por competência, em meses seguidos.
      expect(cobrancas.map((b) => Number(b.amount))).toEqual([1500, 1500]);
      expect(cobrancas[0].competenceMonth).toBe(5);
      expect(cobrancas[1].competenceMonth).toBe(6);
      expect(cobrancas.every((b) => b.revenueType === "TCV")).toBe(true);
    });
  });

  it("o contrato nasce RASCUNHO e nada espera por ele (01 §6.1)", async () => {
    await asOwner(dono, async () => {
      const v = await vendaTcv();
      const r = await fecharVenda(v.opportunityId, { quando: HOJE });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const c = await prisma.contract.findUniqueOrThrow({ where: { id: r.contractId! } });
      expect(c.status).toBe("PENDING");
      // O contrato está pendente E a cobrança existe: é isso que "formaliza,
      // não bloqueia" significa na prática.
      expect(r.billingIds.length).toBeGreaterThan(0);
    });
  });

  it("abre relação, termo e implantação — o cliente entra INTEIRO", async () => {
    await asOwner(dono, async () => {
      const v = await vendaTcv();
      const r = await fecharVenda(v.opportunityId, { quando: HOJE });
      if (!r.ok) return;

      const rel = await prisma.clientAgencyRelationship.findFirstOrThrow({
        where: { clientId: r.clientId },
      });
      // A relação nasce em ONBOARDING, não ACTIVE: o cliente foi vendido,
      // mas ainda não está sendo entregue. Marcá-lo ativo no dia da venda
      // faria a carteira contar como ativo quem ainda não recebeu nada.
      expect(rel.lifecycleStatus).toBe("ONBOARDING");
      expect(await prisma.commercialTerm.count({ where: { relationshipId: rel.id } })).toBeGreaterThan(0);
      expect(await prisma.onboardingTask.count({ where: { relationshipId: rel.id } })).toBeGreaterThan(0);
    });
  });

  it("MRR NÃO gera cobrança avulsa — a mensalidade vem do ciclo do mês", async () => {
    await asOwner(dono, async () => {
      const lead = await criarLead({ name: "Contato", company: "Oficina MRR" });
      if (!lead.ok) throw new Error(lead.error);
      const op = await criarOportunidade({
        title: "Mensalidade — Oficina", leadId: lead.lead.id,
        amount: 1200, modality: "MRR", months: 12,
      });
      if (!op.ok) throw new Error(op.error);

      const r = await fecharVenda(op.id, { quando: HOJE });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Zero cobranças: criar uma agora faria o primeiro mês ser faturado
      // duas vezes quando o ciclo mensal rodasse.
      expect(r.billingIds).toHaveLength(0);

      const cliente = await prisma.client.findUniqueOrThrow({ where: { id: r.clientId } });
      expect(cliente.modality).toBe("MRR");
      expect(Number(cliente.monthlyValue)).toBe(1200);
    });
  });

  it("é IDEMPOTENTE: fechar duas vezes não cria dois clientes nem duas cobranças", async () => {
    await asOwner(dono, async () => {
      const v = await vendaTcv();
      const um = await fecharVenda(v.opportunityId, { parcelas: 2, quando: HOJE });
      const dois = await fecharVenda(v.opportunityId, { parcelas: 2, quando: HOJE });
      expect(um.ok && dois.ok).toBe(true);
      if (!um.ok || !dois.ok) return;

      expect(dois.jaTinhaSidoFeito).toBe(true);
      expect(dois.clientId).toBe(um.clientId);
      expect(await prisma.client.count({})).toBe(1);
      expect(await prisma.billing.count({})).toBe(2);
    });
  });

  it("a venda reaproveita o cliente do MESMO DOCUMENTO em vez de duplicar", async () => {
    await asOwner(dono, async () => {
      const existente = await prisma.client.create({
        data: { name: "Padaria Nova", document: "11222333000144", status: "CHURNED", churnedAt: new Date(2026, 5, 1) },
        select: { id: true },
      });
      const v = await vendaTcv();
      const r = await fecharVenda(v.opportunityId, { quando: HOJE });
      expect(r.ok && r.clientId).toBe(existente.id);
      expect(await prisma.client.count({})).toBe(1);

      const cliente = await prisma.client.findUniqueOrThrow({ where: { id: existente.id } });
      expect(cliente.status).toBe("ACTIVE");
      expect(cliente.churnedAt).toBeNull();
    });
  });

  it("oportunidade sem lead e sem cliente é recusada com a razão certa", async () => {
    await asOwner(dono, async () => {
      const op = await criarOportunidade({ title: "Venda solta", amount: 500, modality: "TCV" });
      if (!op.ok) return;
      const r = await fecharVenda(op.id, { quando: HOJE });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/escolha para quem/i);
    });
  });

  it("venda marcada GANHA sem passar pelo handoff aparece como pendência", async () => {
    await asOwner(dono, async () => {
      const v = await vendaTcv();
      // Arrastar o card no quadro: muda a etapa e não entrega nada.
      await moverEtapa(v.opportunityId, "GANHA", { quando: HOJE });

      const pendentes = await vendasSemHandoff();
      expect(pendentes.map((p) => p.id)).toContain(v.opportunityId);

      // Depois do handoff, some da lista.
      await fecharVenda(v.opportunityId, { quando: HOJE });
      const depois = await vendasSemHandoff();
      expect(depois.map((p) => p.id)).not.toContain(v.opportunityId);
    });
  });
});
