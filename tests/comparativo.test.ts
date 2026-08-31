import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { compararPeriodos } from "@/lib/services/period-compare";
import { fecharPeriodo } from "@/lib/services/closing-period";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * F2.5 — comparativo de períodos (02 §5.3, §7.8).
 *
 * O teste que importa é o da FONTE: mês fechado tem de vir da FOTOGRAFIA.
 * Recalcular um mês fechado com o código de hoje responde "quanto agosto
 * valeria pelas regras de agora" — pergunta diferente de "quanto agosto
 * valeu", e a errada para comparar.
 */
describe("F2.5 — comparativo", () => {
  let dono: TestOwner;

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    const ws = await currentWorkspaceId();
    await runWithoutScope(async () => {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" DISABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.snapshot.deleteMany({ where: { workspaceId: ws } });
      await prisma.$executeRawUnsafe(`ALTER TABLE "Snapshot" ENABLE TRIGGER b2c_snapshot_imutavel`);
      await prisma.closingPeriod.deleteMany({ where: { workspaceId: ws } });
    });
    await destroyOwner(dono);
  });

  it("mês aberto vem do cálculo; mês fechado vem da fotografia", async () => {
    const cliente = await createMrrClient(dono, { name: "Comparativo" });
    await createBilling(dono, cliente.id, { month: 9, year: 2026, amount: 1000 });

    await asOwner(dono, async () => fecharPeriodo("2026-09", "Israel"));

    const c = await asOwner(dono, async () => compararPeriodos("2026-09", "2026-10"));
    expect(c.a.fonte).toBe("fotografia");
    expect(c.b.fonte).toBe("cálculo");
  });

  it("o delta é B menos A, e a direção do 'bom' depende da linha", async () => {
    const c = await asOwner(dono, async () => compararPeriodos("2026-09", "2026-10"));
    for (const l of c.linhas) {
      if (l.a != null && l.b != null) expect(l.delta).toBeCloseTo(l.b - l.a, 6);
    }
    // Vencido e churn subirem NÃO é boa notícia — a tela pinta pela linha,
    // não pelo sinal do número.
    expect(c.linhas.find((l) => l.chave === "vencido")!.subirEhBom).toBe(false);
    expect(c.linhas.find((l) => l.chave === "churn_quantidade")!.subirEhBom).toBe(false);
    expect(c.linhas.find((l) => l.chave === "mrr_oficial")!.subirEhBom).toBe(true);
  });

  it("avisa quando os dois lados foram medidos com réguas diferentes", async () => {
    const c = await asOwner(dono, async () => compararPeriodos("2026-09", "2026-10"));
    // Hoje só existe a versão 1 do dicionário; o campo tem de dizer isso em
    // vez de simplesmente não existir.
    expect(typeof c.mesmaRegua).toBe("boolean");
    expect(c.a.versaoMetricas).toBeGreaterThan(0);
    expect(c.b.versaoMetricas).toBeGreaterThan(0);
  });

  it("divisão por zero não vira Infinity na variação", async () => {
    const c = await asOwner(dono, async () => compararPeriodos("2026-11", "2026-12"));
    for (const l of c.linhas) {
      if (l.variacao != null) expect(Number.isFinite(l.variacao)).toBe(true);
    }
  });
});
