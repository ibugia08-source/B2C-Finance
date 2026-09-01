import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, createRelationship,
  destroyOwner, prisma, type TestOwner,
} from "./support/db";
import { buildAgencySnapshotText } from "@/lib/ai/agency-context";

/**
 * F5.6 — retrato ampliado do Assistente.
 *
 * O guardrail do v1 não muda ("o retrato é a única fonte; nunca invente");
 * muda o quanto ele ENXERGA: agências, fechamento e avaliação entram como
 * FATO no texto. O teste prova que os quatro blocos novos aparecem e que o
 * cliente com sinais acesos está lá COM os motivos — porque um assistente
 * que diz "cliente em risco" sem dizer por quê é ruído, não conselho.
 */

describe("F5.6 — retrato ampliado", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("agências, fechamento e avaliações entram no retrato como fato", async () => {
    await asOwner(dono, async () => {
      const c = await createMrrClient(dono, { name: "Cliente do Retrato" });
      const r = await createRelationship(dono, c.id, {
        startedAt: new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1),
      });
      const termo = await prisma.commercialTerm.create({
        data: {
          relationshipId: r.id, modality: "MRR", monthlyValue: 1200,
          validFrom: new Date(2026, 0, 1), validTo: null,
        },
        select: { id: true },
      });
      await prisma.clientAgencyRelationship.update({
        where: { id: r.id },
        data: { currentCommercialTermId: termo.id },
      });
      const hoje = new Date();
      const competencia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
      await prisma.avaliacaoMensal.create({
        data: {
          relationshipId: r.id, competence: competencia,
          estabilidade: "caindo", ads: "pausado", risco: "alto",
        },
      });
      // Vencida há 40 dias: acende o sinal de atraso grave.
      const vencida = new Date(hoje.getTime() - 40 * 86_400_000);
      await createBilling(dono, c.id, {
        month: vencida.getMonth() + 1, year: vencida.getFullYear(),
        amount: 900, dueDate: vencida,
      });

      const texto = await buildAgencySnapshotText();

      expect(texto).toMatch(/POR AGÊNCIA:/);
      expect(texto).toMatch(/MRR vigente/);
      expect(texto).toMatch(/FECHAMENTO:/);
      expect(texto).toMatch(/checklist de /);
      expect(texto).toMatch(/AVALIAÇÕES MENSAIS:/);
      expect(texto).toMatch(/SINAIS DE CHURN/);
      expect(texto).toMatch(/Cliente do Retrato/);
      // O sinal vem COM o motivo, nunca só o rótulo.
      expect(texto).toMatch(/Atraso grave|Resultados caindo|Anúncios pausados|Risco declarado/);
      // E a régua se declara como régua.
      expect(texto).toMatch(/régua declarada/i);
    });
  });
});
