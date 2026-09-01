import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  definirBaseDeValoracao, metricasComerciais, PESO_DA_ETAPA,
} from "@/lib/metrics/commercial";
import { criarLead } from "@/lib/services/leads";
import { criarOportunidade, moverEtapa } from "@/lib/services/pipeline";
import { registrarAtividade } from "@/lib/services/sdr-activity";
import { getMetricSpec, METRIC_REGISTRY } from "@/lib/metrics/registry";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * F4.6 — métricas comerciais (01 §7.5).
 *
 * A regra que carrega o módulo: métrica que não dá para calcular é NULA COM
 * MOTIVO, nunca zero. Um CPL de R$ 0,00 porque ninguém lançou o gasto em
 * anúncios parece resultado excelente — é a leitura mais cara possível.
 *
 * E o ROAS não existe sem a base de valoração: valorizar uma mensalidade de
 * R$ 2.000 pelo primeiro mês ou pelo contrato de doze meses dá dois números
 * que diferem por DOZE VEZES, e os dois se chamariam "ROAS".
 */
describe("F4.6 — métricas comerciais", () => {
  let dono: TestOwner;
  let settingsAntes: any;
  let ws: string;
  const COMP = "2027-07";
  const DIA = new Date(2027, 6, 10);

  beforeAll(async () => {
    dono = await createOwner();
    ws = await currentWorkspaceId();
    const w = await runWithoutScope(async () =>
      prisma.workspace.findUniqueOrThrow({ where: { id: ws }, select: { commercialSettings: true } })
    );
    settingsAntes = w.commercialSettings;
  });

  beforeEach(async () => {
    await runWithoutScope(async () =>
      prisma.workspace.update({ where: { id: ws }, data: { commercialSettings: {} } })
    );
    await asOwner(dono, async () => {
      await prisma.gastoAdsDiario.deleteMany({});
      await prisma.atividadeDiaria.deleteMany({});
      await prisma.pipelineEvent.deleteMany({});
      await prisma.opportunity.deleteMany({});
      await prisma.lead.deleteMany({});
      await prisma.commercialGoal.deleteMany({});
    });
  });

  afterAll(async () => {
    await runWithoutScope(async () =>
      prisma.workspace.update({
        where: { id: ws },
        data: { commercialSettings: settingsAntes ?? {} },
      })
    );
    await destroyOwner(dono);
  });

  it("as onze métricas de 01 §7.5 estão no registry, com fórmula escrita", () => {
    for (const key of [
      "cpl", "cpmql", "custo_por_agendamento", "custo_por_reuniao",
      "comparecimento", "conversao_reuniao", "cac", "roas",
      "tcv_comercial", "novo_mrr", "pipeline_coverage", "tempo_por_etapa",
    ]) {
      const spec = getMetricSpec(key);
      expect(spec, key).toBeDefined();
      expect(spec!.formulaDescription.length, key).toBeGreaterThan(15);
      expect(spec!.spec, key).toContain("7.5");
    }
  });

  it("nenhuma chave do registry se repete", () => {
    const chaves = METRIC_REGISTRY.map((m) => m.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("SEM dados, tudo é nulo COM MOTIVO — nunca zero", async () => {
    await asOwner(dono, async () => {
      const m = await metricasComerciais(COMP);
      for (const key of ["cpl", "cpmql", "custo_por_agendamento", "custo_por_reuniao", "comparecimento", "cac", "roas"]) {
        expect(m.metricas[key].valor, key).toBeNull();
        expect(m.metricas[key].motivoDoNulo, key).toBeTruthy();
      }
    });
  });

  it("CPL = gasto ÷ leads", async () => {
    await asOwner(dono, async () => {
      await prisma.gastoAdsDiario.create({
        data: { date: DIA, platform: "meta", amount: 3000, agencyId: "" },
      });
      for (let i = 0; i < 20; i++) await criarLead({ name: `Lead ${i}` });
      // Os leads nascem com a data de hoje; o período medido é julho de 2027.
      await prisma.lead.updateMany({ data: { createdAt: DIA } });
      const m = await metricasComerciais(COMP);
      expect(m.metricas.cpl.valor).toBe(150);
    });
  });

  it("CPMQL conta só quem passou da triagem", async () => {
    await asOwner(dono, async () => {
      await prisma.gastoAdsDiario.create({
        data: { date: DIA, platform: "meta", amount: 1000, agencyId: "" },
      });
      for (let i = 0; i < 10; i++) await criarLead({ name: `Lead ${i}` });
      await prisma.lead.updateMany({ data: { createdAt: DIA } });
      const ids = (await prisma.lead.findMany({ select: { id: true } })).slice(0, 4);
      await prisma.lead.updateMany({
        where: { id: { in: ids.map((x) => x.id) } },
        data: { status: "QUALIFIED" },
      });
      const m = await metricasComerciais(COMP);
      expect(m.metricas.cpl.valor).toBe(100);
      expect(m.metricas.cpmql.valor).toBe(250);
    });
  });

  it("custo por AGENDAMENTO e por REUNIÃO diferem pelo no-show", async () => {
    await asOwner(dono, async () => {
      await prisma.gastoAdsDiario.create({
        data: { date: DIA, platform: "google", amount: 2000, agencyId: "" },
      });
      await registrarAtividade("Bianca", "agendamentos", 10, { hoje: DIA });
      await registrarAtividade("Bianca", "reunioesRealizadas", 8, { hoje: DIA });
      await registrarAtividade("Bianca", "noShows", 2, { hoje: DIA });

      const m = await metricasComerciais(COMP);
      expect(m.metricas.custo_por_agendamento.valor).toBe(200);
      expect(m.metricas.custo_por_reuniao.valor).toBe(250);
      expect(m.metricas.comparecimento.valor).toBe(80);
    });
  });

  it("ROAS NÃO É CALCULADO sem a base de valoração", async () => {
    await asOwner(dono, async () => {
      await prisma.gastoAdsDiario.create({
        data: { date: DIA, platform: "meta", amount: 1000, agencyId: "" },
      });
      const o = await criarOportunidade({ title: "Venda", amount: 2000, modality: "MRR", months: 12 });
      if (o.ok) await moverEtapa(o.id, "GANHA", { quando: DIA });

      const m = await metricasComerciais(COMP);
      expect(m.metricas.roas.valor).toBeNull();
      expect(m.metricas.roas.motivoDoNulo).toMatch(/valorizado|primeiro mês|contrato/i);
    });
  });

  it("a base MUDA o ROAS por doze vezes — e é por isso que ela é obrigatória", async () => {
    await asOwner(dono, async () => {
      await prisma.gastoAdsDiario.create({
        data: { date: DIA, platform: "meta", amount: 1000, agencyId: "" },
      });
      const o = await criarOportunidade({ title: "Venda", amount: 2000, modality: "MRR", months: 12 });
      if (o.ok) await moverEtapa(o.id, "GANHA", { quando: DIA });

      await definirBaseDeValoracao("PRIMEIRO_MES");
      const primeiro = await metricasComerciais(COMP);
      expect(primeiro.metricas.roas.valor).toBe(2);

      await definirBaseDeValoracao("CONTRATO");
      const contrato = await metricasComerciais(COMP);
      expect(contrato.metricas.roas.valor).toBe(24);
    });
  });

  it("TCV vendido e Novo MRR são números SEPARADOS", async () => {
    await asOwner(dono, async () => {
      const tcv = await criarOportunidade({ title: "Projeto", amount: 9000, modality: "TCV" });
      const mrr = await criarOportunidade({ title: "Mensal", amount: 1500, modality: "MRR", months: 12 });
      if (tcv.ok) await moverEtapa(tcv.id, "GANHA", { quando: DIA });
      if (mrr.ok) await moverEtapa(mrr.id, "GANHA", { quando: DIA });

      const m = await metricasComerciais(COMP);
      expect(m.metricas.tcv_comercial.valor).toBe(9000);
      expect(m.metricas.novo_mrr.valor).toBe(1500);
    });
  });

  it("pipeline coverage exige META — sem ela não existe cobertura", async () => {
    await asOwner(dono, async () => {
      const o = await criarOportunidade({ title: "Aberta", amount: 10_000, modality: "TCV" });
      if (o.ok) await moverEtapa(o.id, "PROPOSTA", { quando: DIA });

      const semMeta = await metricasComerciais(COMP);
      expect(semMeta.metricas.pipeline_coverage.valor).toBeNull();
      expect(semMeta.metricas.pipeline_coverage.motivoDoNulo).toMatch(/meta/i);

      await prisma.commercialGoal.create({
        data: { competence: COMP, scopeType: "AGENCY", scopeId: "", metric: "valor", target: 12_000 },
      });
      const comMeta = await metricasComerciais(COMP);
      // 10.000 × peso da proposta (0,6) = 6.000 ÷ 12.000 = 0,5
      expect(PESO_DA_ETAPA.PROPOSTA).toBe(0.6);
      expect(comMeta.metricas.pipeline_coverage.valor).toBe(0.5);
    });
  });

  it("os pesos do funil sobem etapa a etapa e são declarados", () => {
    expect(PESO_DA_ETAPA.NOVA).toBeLessThan(PESO_DA_ETAPA.QUALIFICACAO);
    expect(PESO_DA_ETAPA.NEGOCIACAO).toBeLessThan(PESO_DA_ETAPA.GANHA);
    expect(PESO_DA_ETAPA.PERDIDA).toBe(0);
    expect(getMetricSpec("pipeline_coverage")!.filters).toMatch(/não configurável/i);
  });
});
