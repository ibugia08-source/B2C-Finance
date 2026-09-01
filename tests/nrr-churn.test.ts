import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, createRelationship,
  destroyOwner, prisma, type TestOwner,
} from "./support/db";
import { nrrDoMes } from "@/lib/services/nrr";
import {
  NIVEL_ALTO, PESO_DO_SINAL, previsaoDeChurn,
} from "@/lib/services/churn-signals";

/**
 * F5.4 — NRR pelas vigências e previsão de churn por sinais.
 *
 * O NRR é o cenário S12 virado métrica: o reajuste de julho aparece como
 * expansão EM julho, lendo a linha do tempo de termos — nunca o valor de
 * cadastro. E a previsão é RÉGUA DECLARADA: cada ponto tem um sinal com
 * nome, e cliente sem avaliação não ganha ponto pelo que ninguém leu.
 */

async function termo(
  dono: TestOwner,
  relationshipId: string,
  valor: number,
  de: Date,
  ate: Date | null
) {
  return asOwner(dono, async () =>
    prisma.commercialTerm.create({
      data: {
        relationshipId, modality: "MRR", monthlyValue: valor,
        validFrom: de, validTo: ate,
      },
      select: { id: true },
    })
  );
}

describe("F5.4 — NRR", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("S12: reajuste 1.000 → 1.500 em julho = expansão de 500 EM julho", async () => {
    await asOwner(dono, async () => {
      const c = await createMrrClient(dono, { name: "Cliente do S12" });
      const r = await createRelationship(dono, c.id, { startedAt: new Date(2027, 0, 1) });
      await termo(dono, r.id, 1000, new Date(2027, 0, 1), new Date(2027, 6, 1));
      await termo(dono, r.id, 1500, new Date(2027, 6, 1), null);

      const julho = await nrrDoMes("2027-07");
      expect(julho.inicial).toBe(1000);
      expect(julho.expansao).toBe(500);
      expect(julho.contracao).toBe(0);
      expect(julho.churn).toBe(0);
      expect(julho.nrr).toBe(1.5);

      // Maio segue 1.000 para sempre: sem expansão retroativa.
      const maio = await nrrDoMes("2027-05");
      expect(maio.inicial).toBe(1000);
      expect(maio.expansao).toBe(0);
      expect(maio.nrr).toBe(1);
    });
  });

  it("saída no mês vira churn MRR pelo valor da base; contração é o reajuste para baixo", async () => {
    await asOwner(dono, async () => {
      const que_sai = await createMrrClient(dono, { name: "Cliente que sai" });
      const rs = await createRelationship(dono, que_sai.id, { startedAt: new Date(2027, 0, 1) });
      await termo(dono, rs.id, 800, new Date(2027, 0, 1), null);
      await prisma.clientAgencyRelationship.update({
        where: { id: rs.id },
        data: { lifecycleStatus: "CHURNED", churnedAt: new Date(2027, 8, 10) },
      });

      const que_encolhe = await createMrrClient(dono, { name: "Cliente que encolhe" });
      const re = await createRelationship(dono, que_encolhe.id, { startedAt: new Date(2027, 0, 1) });
      await termo(dono, re.id, 1000, new Date(2027, 0, 1), new Date(2027, 8, 15));
      await termo(dono, re.id, 700, new Date(2027, 8, 15), null);

      // Cliente NOVO no próprio mês: fora da conta — NRR mede a base que existia.
      const novo = await createMrrClient(dono, { name: "Cliente novo do mês" });
      const rn = await createRelationship(dono, novo.id, { startedAt: new Date(2027, 8, 5) });
      await termo(dono, rn.id, 5000, new Date(2027, 8, 5), null);

      const set = await nrrDoMes("2027-09");
      // Base: 800 (sai) + 1000 (encolhe) + 2500 dos clientes dos outros testes?
      // Não: cada teste usa competências distintas E o dono é o mesmo… o S12
      // também está na base de setembro (1500). Então: 800 + 1000 + 1500.
      expect(set.inicial).toBe(3300);
      expect(set.churn).toBe(800);
      expect(set.contracao).toBe(300);
      expect(set.expansao).toBe(0);
      // (3300 + 0 − 300 − 800) / 3300
      expect(set.nrr).toBeCloseTo(2200 / 3300, 3);
    });
  });

  it("sem base inicial o NRR é NULO com motivo — nunca 0% nem infinito", async () => {
    await asOwner(dono, async () => {
      const r = await nrrDoMes("2020-01");
      expect(r.nrr).toBeNull();
      expect(r.motivoDoNulo).toMatch(/sem base/i);
    });
  });
});

describe("F5.4 — previsão de churn por sinais", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  const HOJE = new Date(2027, 6, 20);

  it("os quatro sinais somam com nome e motivo; risco declarado pelo gestor pesa mais", async () => {
    await asOwner(dono, async () => {
      const c = await createMrrClient(dono, { name: "Cliente em perigo" });
      // 3 meses de casa: dentro da zona de risco.
      const r = await createRelationship(dono, c.id, { startedAt: new Date(2027, 3, 15) });
      await prisma.avaliacaoMensal.create({
        data: {
          relationshipId: r.id, competence: "2027-07",
          estabilidade: "caindo", ads: "pausado", risco: "alto",
        },
      });
      // Vencida há 40 dias.
      await createBilling(dono, c.id, {
        month: 6, year: 2027, amount: 900, dueDate: new Date(2027, 5, 10),
      });

      const lista = await previsaoDeChurn(HOJE);
      const alvo = lista.find((x) => x.cliente === "Cliente em perigo")!;
      expect(alvo.nivel).toBe("ALTO");
      expect(alvo.semLeitura).toBe(false);
      const nomes = alvo.sinais.map((s) => s.sinal).join(" | ");
      expect(nomes).toMatch(/Atraso grave/);
      expect(nomes).toMatch(/caindo/i);
      expect(nomes).toMatch(/pausados/i);
      expect(nomes).toMatch(/Risco declarado alto/);
      expect(nomes).toMatch(/Zona de risco/);
      expect(alvo.pontos).toBe(
        PESO_DO_SINAL.ATRASO_GRAVE + PESO_DO_SINAL.ESTABILIDADE_CAINDO +
        PESO_DO_SINAL.ADS_PAUSADO + PESO_DO_SINAL.RISCO_DECLARADO_ALTO +
        PESO_DO_SINAL.TENURE_ZONA_DE_RISCO
      );
      expect(alvo.pontos).toBeGreaterThanOrEqual(NIVEL_ALTO);
    });
  });

  it("cliente sem avaliação recente NÃO ganha ponto pelo que ninguém leu — ganha a marca", async () => {
    await asOwner(dono, async () => {
      const c = await createMrrClient(dono, { name: "Cliente sem leitura" });
      const r = await createRelationship(dono, c.id, { startedAt: new Date(2026, 0, 1) });
      // Avaliação VELHA (fevereiro) dizendo o pior — não vale mais como leitura.
      await prisma.avaliacaoMensal.create({
        data: {
          relationshipId: r.id, competence: "2027-02",
          estabilidade: "caindo", ads: "sem verba", risco: "alto",
        },
      });
      const lista = await previsaoDeChurn(HOJE);
      const alvo = lista.find((x) => x.cliente === "Cliente sem leitura")!;
      expect(alvo.semLeitura).toBe(true);
      expect(alvo.pontos).toBe(0);
      expect(alvo.nivel).toBe("BAIXO");
    });
  });

  it("cliente saudável e antigo fica BAIXO, sem sinal nenhum", async () => {
    await asOwner(dono, async () => {
      const c = await createMrrClient(dono, { name: "Cliente tranquilo" });
      const r = await createRelationship(dono, c.id, { startedAt: new Date(2025, 0, 1) });
      await prisma.avaliacaoMensal.create({
        data: {
          relationshipId: r.id, competence: "2027-07",
          estabilidade: "estavel", ads: "rodando", risco: "baixo",
        },
      });
      const lista = await previsaoDeChurn(HOJE);
      const alvo = lista.find((x) => x.cliente === "Cliente tranquilo")!;
      expect(alvo.pontos).toBe(0);
      expect(alvo.sinais).toHaveLength(0);
      expect(alvo.semLeitura).toBe(false);
    });
  });
});
