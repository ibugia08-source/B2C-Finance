import { describe, it, expect } from "vitest";
import { METRIC_REGISTRY, getMetricSpec, METRIC_REGISTRY_VERSION } from "@/lib/metrics/registry";
import { div } from "@/lib/metrics/engine";

/**
 * REGISTRY E MOTOR DE MÉTRICAS — ref. 01 §7; 03 §4.1.
 * Trava o CONTRATO das métricas: chave única, base temporal declarada e
 * política de nulo. A paridade numérica com o Dashboard é verificada em
 * scripts/verify-metric-parity.mjs, contra dados reais.
 */

describe("registry de métricas", () => {
  it("não tem chave repetida", () => {
    const chaves = METRIC_REGISTRY.map((m) => m.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("toda métrica declara fórmula, grão, base temporal e origem", () => {
    for (const m of METRIC_REGISTRY) {
      expect(m.formulaDescription.length, m.key).toBeGreaterThan(10);
      expect(["COMPETENCE", "PERIOD", "POINT_IN_TIME", "CLIENT"]).toContain(m.grain);
      expect(["COMPETENCE", "CASH", "CURRENT_STATE", "SNAPSHOT"]).toContain(m.dateBasis);
      expect(m.sourceEntities.length, m.key).toBeGreaterThan(0);
      expect(m.spec, m.key).toMatch(/§/); // rastreia a seção da especificação
    }
  });

  it("separa explicitamente competência de caixa nas métricas homônimas", () => {
    // A confusão que o dicionário existe para evitar (01 §7.1).
    expect(getMetricSpec("recebido_competencia")!.dateBasis).toBe("COMPETENCE");
    expect(getMetricSpec("recebido_caixa")!.dateBasis).toBe("CASH");
    expect(getMetricSpec("recuperacao")!.dateBasis).toBe("CASH");
    expect(getMetricSpec("faturamento_total")!.dateBasis).toBe("COMPETENCE");
  });

  it("toda métrica de razão declara o que fazer com denominador zero", () => {
    const razoes = ["margem_gerencial", "percentual_recorrencia", "percentual_realizacao",
      "churn_rate", "revenue_churn", "nrr", "ticket_medio", "custo_por_cliente",
      "percentual_folha", "cac", "roas", "conversao_upsell"];
    for (const k of razoes) {
      const m = getMetricSpec(k);
      expect(m, k).toBeDefined();
      expect(m!.nullPolicy, k).toMatch(/zero|null|estimativa|suficiente/i);
    }
  });

  it("liquidez disponível é a métrica do card de caixa, não o saldo bruto", () => {
    const liq = getMetricSpec("liquidez_disponivel")!;
    expect(liq.formulaDescription).toMatch(/reservado/i);
    expect(liq.description).toMatch(/nunca o saldo bruto/i);
  });

  it("o ROAS exige base de valoração explícita", () => {
    expect(getMetricSpec("roas")!.filters).toMatch(/base de valoração/i);
  });

  it("a versão do registry é 1", () => {
    expect(METRIC_REGISTRY_VERSION).toBe(1);
  });
});

describe("política de nulo do motor", () => {
  it("denominador zero devolve null, nunca Infinity nem NaN", () => {
    expect(div(10, 0)).toBeNull();
    expect(div(0, 0)).toBeNull();
    expect(div(10, 2)).toBe(5);
    expect(div(1, 3)).toBeCloseTo(0.3333, 4);
  });

  it("valores não finitos viram null", () => {
    expect(div(Infinity, 2)).toBeNull();
    expect(div(NaN, 2)).toBeNull();
    expect(div(2, NaN)).toBeNull();
  });
});
