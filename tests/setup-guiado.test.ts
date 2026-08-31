import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTestDatabase, prisma, runWithoutScope } from "./support/db";
import { MINUTOS_TOTAIS, PASSOS, passoPorId } from "@/lib/setup-meta";
import {
  adiarPasso, encerrarSetup, estadoDoSetup, mostrarSetup, reabrirSetup, retomarPasso,
} from "@/lib/services/setup";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * F1.20 — setup guiado de primeiro uso (02 §3).
 *
 * O que estes testes protegem é a promessa central da tela: "feito" é
 * deduzido do BANCO, e "nada bloqueia". Uma lista que se marca pronta por
 * clique afirma que o sistema está configurado quando não está, e isso só
 * aparece no fim do mês, quando o resultado não bate.
 */
describe("F1.20 — setup guiado", () => {
  let original: any;

  beforeAll(async () => {
    assertTestDatabase();
    const id = await currentWorkspaceId();
    original = await runWithoutScope(async () =>
      prisma.workspace.findUnique({ where: { id }, select: { setupState: true } })
    );
    await runWithoutScope(async () =>
      prisma.workspace.update({ where: { id }, data: { setupState: {} } })
    );
  });

  afterAll(async () => {
    const id = await currentWorkspaceId();
    await runWithoutScope(async () =>
      prisma.workspace.update({ where: { id }, data: { setupState: original?.setupState ?? {} } })
    );
  });

  it("cabe nos ~30 minutos que a spec promete", () => {
    expect(MINUTOS_TOTAIS).toBeLessThanOrEqual(30);
    expect(PASSOS).toHaveLength(5);
    for (const p of PASSOS) {
      expect(p.minutos).toBeGreaterThan(0);
      expect(p.href.startsWith("/")).toBe(true);
      expect(p.cta.length).toBeGreaterThan(0);
    }
  });

  it("os números dos passos são 1..5, sem buraco nem repetição", () => {
    expect(PASSOS.map((p) => p.numero)).toEqual([1, 2, 3, 4, 5]);
  });

  it('"feito" vem do banco, não de clique', async () => {
    const e = await estadoDoSetup();
    const agencia = e.passos.find((p) => p.id === "agencia")!;
    // O banco de teste tem agência semeada — logo o passo 1 já nasce feito, e
    // nenhum clique participou disso.
    expect(agencia.quantidade).toBeGreaterThan(0);
    expect(agencia.feito).toBe(true);

    // E adiar um passo JÁ FEITO não o desmarca: o dado manda.
    await adiarPasso("agencia");
    const depois = await estadoDoSetup();
    const ag2 = depois.passos.find((p) => p.id === "agencia")!;
    expect(ag2.feito).toBe(true);
    expect(ag2.adiado).toBe(false);
    await retomarPasso("agencia");
  });

  it("adiar tira o passo da conta de minutos e retomar devolve", async () => {
    const antes = await estadoDoSetup();
    const alvo = antes.passos.find((p) => !p.feito);
    if (!alvo) return; // banco de teste já completo — nada a provar aqui

    await adiarPasso(alvo.id);
    const meio = await estadoDoSetup();
    expect(meio.passos.find((p) => p.id === alvo.id)!.adiado).toBe(true);
    expect(meio.minutosRestantes).toBe(antes.minutosRestantes - alvo.minutos);

    await retomarPasso(alvo.id);
    const fim = await estadoDoSetup();
    expect(fim.passos.find((p) => p.id === alvo.id)!.adiado).toBe(false);
    expect(fim.minutosRestantes).toBe(antes.minutosRestantes);
  });

  it("esconder tira o card da home, e reabrir traz de volta", async () => {
    await encerrarSetup();
    expect(await mostrarSetup()).toBeNull();
    expect((await estadoDoSetup()).encerrado).toBe(true);

    await reabrirSetup();
    expect((await estadoDoSetup()).encerrado).toBe(false);
  });

  it("todo passo do catálogo tem frase de tela vazia", () => {
    // O EmptyState de cada tela puxa daqui (T4): sem a frase, a tela vazia
    // volta a ser um beco.
    for (const p of PASSOS) {
      expect(passoPorId(p.id).vazio.length).toBeGreaterThan(0);
    }
  });

  it("passo desconhecido estoura em vez de devolver silêncio", () => {
    expect(() => passoPorId("inexistente" as any)).toThrow();
  });
});
