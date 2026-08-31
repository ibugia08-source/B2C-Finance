import { describe, expect, it } from "vitest";
import { splitTcv } from "@/lib/services/tcv-installments";

/**
 * F1.7 — parcelamento de TCV (01 §3.7).
 *
 * O exemplo da spec, ao pé da letra: R$ 1.000 em 3x = 333,33 + 333,33 +
 * 333,34. E o invariante que vale para QUALQUER combinação: a soma das
 * parcelas é EXATAMENTE o total. Centavo que some no arredondamento é o
 * erro clássico deste cálculo, e ele só aparece meses depois, na
 * conciliação.
 */
describe("F1.7 — divisão de TCV em parcelas", () => {
  it("R$ 1.000 em 3x fica 333,33 + 333,33 + 333,34 (exemplo da spec)", () => {
    const p = splitTcv(1000, 3, new Date(2026, 0, 10), { year: 2026, month: 1 });
    expect(p.map((x) => x.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(p.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(1000, 10);
  });

  it("a soma bate EXATAMENTE, para qualquer valor e qualquer número de parcelas", () => {
    const valores = [100, 999.99, 1, 0.03, 12345.67, 7, 2500, 33.33];
    const nParcelas = [1, 2, 3, 4, 6, 7, 12, 18, 24];
    for (const v of valores) {
      for (const n of nParcelas) {
        const p = splitTcv(v, n, new Date(2026, 0, 5), { year: 2026, month: 1 });
        const soma = Math.round(p.reduce((s, x) => s + x.amount, 0) * 100);
        expect(soma).toBe(Math.round(v * 100));
        expect(p).toHaveLength(n);
      }
    }
  });

  it("o residual vai na ÚLTIMA parcela, nunca na primeira", () => {
    const p = splitTcv(100, 3, new Date(2026, 0, 10), { year: 2026, month: 1 });
    expect(p[0].amount).toBe(33.33);
    expect(p[1].amount).toBe(33.33);
    expect(p[2].amount).toBe(33.34);
    // O cliente confere a PRIMEIRA contra o combinado; centavo a mais ali
    // gera ligação. Na última, meses depois, passa como o acerto que é.
    expect(p[0].amount).toBeLessThanOrEqual(p[2].amount);
  });

  it("competências e vencimentos avançam mês a mês, com clamp de dia", () => {
    // Dia 31 em janeiro: fevereiro não tem 31, tem de cair no último dia.
    const p = splitTcv(300, 3, new Date(2026, 0, 31), { year: 2026, month: 1 });
    expect(p.map((x) => `${x.competenceYear}-${String(x.competenceMonth).padStart(2, "0")}`))
      .toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(p[0].dueDate.getDate()).toBe(31);
    expect(p[1].dueDate.getMonth()).toBe(1);
    expect(p[1].dueDate.getDate()).toBe(28); // 2026 não é bissexto
    expect(p[2].dueDate.getDate()).toBe(31);
  });

  it("vira o ano corretamente", () => {
    const p = splitTcv(600, 3, new Date(2026, 10, 15), { year: 2026, month: 11 });
    expect(p.map((x) => `${x.competenceYear}-${String(x.competenceMonth).padStart(2, "0")}`))
      .toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("à vista é uma parcela com o total", () => {
    const p = splitTcv(4500, 1, new Date(2026, 3, 20), { year: 2026, month: 4 });
    expect(p).toHaveLength(1);
    expect(p[0].amount).toBe(4500);
  });

  it("recusa parcelamento inválido em vez de improvisar", () => {
    expect(() => splitTcv(1000, 0, new Date(), { year: 2026, month: 1 })).toThrow();
    expect(() => splitTcv(1000, 2.5, new Date(), { year: 2026, month: 1 })).toThrow();
    expect(() => splitTcv(0, 3, new Date(), { year: 2026, month: 1 })).toThrow();
    expect(() => splitTcv(-100, 3, new Date(), { year: 2026, month: 1 })).toThrow();
  });
});
