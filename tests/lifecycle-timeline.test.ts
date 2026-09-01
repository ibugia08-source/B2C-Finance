import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, createRelationship,
  destroyOwner, prisma, type TestOwner,
} from "./support/db";
import { pausarCliente, reativarCliente, retomarCliente } from "@/lib/services/lifecycle";
import { linhaDoTempo } from "@/lib/services/client-timeline";
import { nrrDoMes } from "@/lib/services/nrr";

/**
 * F1.16 — pausar/retomar/reativar + linha do tempo das 3 trilhas.
 *
 * O que os testes protegem, na frase da spec (01 §3.9): "Pausar suspende
 * geração recorrente; retomar cria evento e NOVO TERMO; retornou não é
 * estado — encerra o churn". E o efeito FINANCEIRO da pausa aparece no NRR
 * como contração: pausado não fatura, e a linha do tempo de termos registra
 * até quando valeu.
 */

describe("F1.16 — ciclo de vida", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  async function clienteAtivo(nome: string, valor = 1000) {
    const c = await createMrrClient(dono, { name: nome, monthlyValue: valor });
    const r = await createRelationship(dono, c.id, { startedAt: new Date(2028, 0, 1) });
    const t = await prisma.commercialTerm.create({
      data: {
        relationshipId: r.id, modality: "MRR", monthlyValue: valor,
        validFrom: new Date(2028, 0, 1), validTo: null,
      },
      select: { id: true },
    });
    await prisma.clientAgencyRelationship.update({
      where: { id: r.id },
      data: { currentCommercialTermId: t.id },
    });
    return { c, r, t };
  }

  it("pausar FECHA o termo vigente; retomar abre termo NOVO com o último valor", async () => {
    await asOwner(dono, async () => {
      const { c, r, t } = await clienteAtivo("Cliente que pausa");

      const pausa = await pausarCliente(c.id, { aPartirDe: new Date(2028, 5, 10) });
      expect(pausa.ok).toBe(true);

      const termoFechado = await prisma.commercialTerm.findUnique({
        where: { id: t.id }, select: { validTo: true },
      });
      expect(termoFechado?.validTo).not.toBeNull();

      const rel = await prisma.clientAgencyRelationship.findUnique({
        where: { id: r.id },
        select: { lifecycleStatus: true, pausedAt: true, currentCommercialTermId: true },
      });
      expect(rel?.lifecycleStatus).toBe("PAUSED");
      expect(rel?.currentCommercialTermId).toBeNull();

      // Pausar de novo recusa com mensagem limpa.
      const dobrada = await pausarCliente(c.id);
      expect(dobrada.ok).toBe(false);

      const volta = await retomarCliente(c.id);
      expect(volta.ok).toBe(true);
      const relDepois = await prisma.clientAgencyRelationship.findUnique({
        where: { id: r.id },
        select: {
          lifecycleStatus: true, pausedAt: true,
          currentCommercialTerm: { select: { monthlyValue: true, validFrom: true, reason: true } },
        },
      });
      expect(relDepois?.lifecycleStatus).toBe("ACTIVE");
      expect(relDepois?.pausedAt).toBeNull();
      expect(Number(relDepois?.currentCommercialTerm?.monthlyValue)).toBe(1000);
      expect(relDepois?.currentCommercialTerm?.reason).toMatch(/Retomada/);
    });
  });

  it("a pausa aparece no NRR como CONTRAÇÃO do mês — pausado não fatura", async () => {
    await asOwner(dono, async () => {
      const { c } = await clienteAtivo("Cliente pausado em julho", 800);
      await pausarCliente(c.id, { aPartirDe: new Date(2028, 6, 15) });

      const julho = await nrrDoMes("2028-07");
      // A base de julho tem os 800 (e o cliente do teste anterior, 1000).
      expect(julho.contracao).toBeGreaterThanOrEqual(800);
    });
  });

  it("reativar encerra o churn NA MESMA ficha, com termo novo", async () => {
    await asOwner(dono, async () => {
      const { c, r } = await clienteAtivo("Cliente que voltou", 1500);
      // Churn manual como o fluxo de perda faz.
      await prisma.client.update({
        where: { id: c.id }, data: { status: "CHURNED", churnedAt: new Date(2028, 3, 1) },
      });
      await prisma.clientAgencyRelationship.update({
        where: { id: r.id },
        data: { lifecycleStatus: "CHURNED", churnedAt: new Date(2028, 3, 1), currentCommercialTermId: null },
      });
      await prisma.commercialTerm.updateMany({
        where: { relationshipId: r.id }, data: { validTo: new Date(2028, 3, 1) },
      });

      // Retomar não serve para churnado — o caminho é reativar.
      const errada = await retomarCliente(c.id);
      expect(errada.ok).toBe(false);

      const volta = await reativarCliente(c.id, "Cliente fechou novo pacote");
      expect(volta.ok).toBe(true);

      const cli = await prisma.client.findUnique({
        where: { id: c.id }, select: { status: true, churnedAt: true },
      });
      expect(cli?.status).toBe("ACTIVE");
      expect(cli?.churnedAt).toBeNull();

      const rel = await prisma.clientAgencyRelationship.findUnique({
        where: { id: r.id },
        select: {
          lifecycleStatus: true, churnedAt: true,
          currentCommercialTerm: { select: { monthlyValue: true, reason: true } },
        },
      });
      expect(rel?.lifecycleStatus).toBe("ACTIVE");
      expect(rel?.churnedAt).toBeNull();
      expect(Number(rel?.currentCommercialTerm?.monthlyValue)).toBe(1500);
      expect(rel?.currentCommercialTerm?.reason).toMatch(/Reativação/);
    });
  });

  it("a linha do tempo intercala as TRÊS trilhas, sem copiar nada", async () => {
    await asOwner(dono, async () => {
      const { c } = await clienteAtivo("Cliente com história");
      // Trilha de cobrança e de contexto.
      const b = await createBilling(dono, c.id, { month: 2, year: 2028, amount: 500 });
      await prisma.collectionHistory.create({
        data: {
          billingId: b.id, clientId: c.id, status: "PROMISED",
          channel: "whatsapp", nextActionAt: new Date(),
        },
      });
      await prisma.clientNote.create({
        data: { clientId: c.id, title: "Reunião de alinhamento", content: "Cliente pediu novo criativo.", type: "atendimento" },
      });
      // Trilha de auditoria: a pausa escreve nela.
      await pausarCliente(c.id, { motivo: "Férias coletivas do cliente" });

      const eventos = await linhaDoTempo(c.id);
      const trilhas = new Set(eventos.map((e) => e.trilha));
      expect(trilhas.has("AUDITORIA")).toBe(true);
      expect(trilhas.has("COBRANCA")).toBe(true);
      expect(trilhas.has("CONTEXTO")).toBe(true);

      // Ordenada do mais novo para o mais velho.
      for (let i = 1; i < eventos.length; i++) {
        expect(eventos[i - 1].quando.getTime()).toBeGreaterThanOrEqual(eventos[i].quando.getTime());
      }
      // A promessa aparece com o nome de gente, não o enum.
      expect(eventos.some((e) => /Promessa de pagamento/.test(e.titulo))).toBe(true);
      // E o MOTIVO da pausa está na trilha de auditoria.
      expect(eventos.some((e) => /Férias coletivas/.test(e.detalhe ?? ""))).toBe(true);
    });
  });
});
