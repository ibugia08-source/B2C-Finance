import { beforeEach, describe, expect, it } from "vitest";
import {
  medir, ORCAMENTOS_MS, registrarMedicao, resumoDeMedicoes, zerarMedicoes,
} from "@/lib/observability";

/**
 * T7 — observabilidade.
 *
 * O que vale proteger: o p95 é o da DEFINIÇÃO (95% das amostras abaixo
 * dele), o alerta só acende com amostra suficiente (p95 de 3 medições é
 * ruído, não sinal) e o cronômetro NUNCA engole o erro do que mediu.
 */

describe("T7 — medições e orçamentos", () => {
  beforeEach(() => zerarMedicoes());

  it("p50/p95 saem da definição, e o estouro respeita o orçamento declarado", () => {
    // 100 amostras: 1..100ms na chave da fila (orçamento 400ms).
    for (let i = 1; i <= 100; i++) registrarMedicao("page:fila", i);
    const fila = resumoDeMedicoes().find((r) => r.chave === "page:fila")!;
    expect(fila.p50).toBe(50);
    expect(fila.p95).toBe(95);
    expect(fila.max).toBe(100);
    expect(fila.orcamentoMs).toBe(ORCAMENTOS_MS["page:fila"]);
    expect(fila.estourado).toBe(false);

    // Agora 100 amostras LENTAS: estoura.
    zerarMedicoes();
    for (let i = 0; i < 100; i++) registrarMedicao("page:fila", 500 + i);
    const lenta = resumoDeMedicoes().find((r) => r.chave === "page:fila")!;
    expect(lenta.estourado).toBe(true);
  });

  it("com POUCA amostra o alerta fica calado — ruído não é sinal", () => {
    for (let i = 0; i < 5; i++) registrarMedicao("page:dashboard", 9999);
    const r = resumoDeMedicoes().find((x) => x.chave === "page:dashboard")!;
    expect(r.p95).toBe(9999);
    expect(r.estourado).toBe(false);
  });

  it("medir cronometra e NUNCA engole o erro", async () => {
    const ok = await medir("action:teste", async () => 42);
    expect(ok).toBe(42);

    await expect(
      medir("action:teste", async () => {
        throw new Error("quebrou");
      })
    ).rejects.toThrow("quebrou");

    // As DUAS chamadas foram medidas — inclusive a que falhou: lentidão de
    // erro também é lentidão.
    const r = resumoDeMedicoes().find((x) => x.chave === "action:teste")!;
    expect(r.amostras).toBe(2);
  });

  it("chave sem orçamento aparece sem alerta — medição sem teto não é verde nem vermelha", () => {
    for (let i = 0; i < 30; i++) registrarMedicao("page:qualquer", 10_000);
    const r = resumoDeMedicoes().find((x) => x.chave === "page:qualquer")!;
    expect(r.orcamentoMs).toBeNull();
    expect(r.estourado).toBe(false);
  });
});
