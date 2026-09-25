import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, asOwner, type TestOwner } from "./support/db";
import { civilCompetenceKey, civilParts, currentYearMonth, fromMonthIndex, monthIndex, toCompetenceKey } from "@/lib/renewal-expectation";

/**
 * Backfill da migração 20260925090000_expectativa_renovacao, executado de
 * verdade contra dados sintéticos. O SQL é lido do PRÓPRIO arquivo de
 * migração (o que vai para produção), restrito ao dono deste teste.
 */

const SQL = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20260925090000_expectativa_renovacao/migration.sql"),
  "utf8"
);

/** O UPDATE da expectativa (do WITH até o fim), só para o dono do teste. */
function backfillDaExpectativa(ownerId: string): string {
  const i = SQL.indexOf("WITH ultima_renovacao AS");
  const trecho = SQL.slice(i).trim().replace(/;\s*$/, "");
  return `${trecho} AND c."ownerId" = '${ownerId}'`;
}

let owner: TestOwner;
const HOJE = currentYearMonth();

beforeAll(async () => {
  owner = await createOwner();
});
afterAll(async () => {
  await destroyOwner(owner);
});

async function cliente(nome: string, data: Record<string, unknown>) {
  const c = await createMrrClient(owner, { name: nome });
  await asOwner(owner, async () => prisma.client.update({ where: { id: c.id }, data }));
  return c.id;
}

describe("backfill da expectativa de renovação", () => {
  it("entrada + prazo, com ciclos até o mês corrente e dia civil preservado", async () => {
    // Entrada à meia-noite UTC (como o servidor grava) em 01/<mês que vem> do ano passado.
    const prox = fromMonthIndex(monthIndex(HOJE) + 1);
    const futuro = await cliente("Base Futura", {
      startedAt: new Date(Date.UTC(prox.year - 1, prox.month - 1, 1)),
      contractMonths: 12,
    });
    // Entrada há 30 meses, prazo 12: dois ciclos passaram.
    const antigo = fromMonthIndex(monthIndex(HOJE) - 30);
    const passado = await cliente("Base Antiga", {
      startedAt: new Date(Date.UTC(antigo.year, antigo.month - 1, 15, 3)),
      contractMonths: 12,
    });
    const semBase = await cliente("Sem Base", { startedAt: null, contractMonths: null });
    const legado = await cliente("Mês Legado", { startedAt: null, contractMonths: null, renewalMonth: prox.month });

    await runWithoutScope(async () => prisma.$executeRawUnsafe(backfillDaExpectativa(owner.id)));
    const ler = (id: string) =>
      runWithoutScope(async () =>
        prisma.client.findUniqueOrThrow({ where: { id }, select: { expectedRenewalAt: true } })
      );

    const f = (await ler(futuro)).expectedRenewalAt!;
    expect(civilCompetenceKey(f)).toBe(toCompetenceKey(prox));
    expect(civilParts(f).day).toBe(1); // não "voltou" para o último dia do mês anterior
    expect(f.getUTCHours()).toBe(15); // meio-dia da Bahia

    const p = (await ler(passado)).expectedRenewalAt!;
    expect(civilCompetenceKey(p)).toBe(toCompetenceKey(fromMonthIndex(monthIndex(antigo) + 36)));
    expect(civilParts(p).day).toBe(15);

    expect((await ler(semBase)).expectedRenewalAt).toBeNull();

    const l = (await ler(legado)).expectedRenewalAt!;
    expect(civilCompetenceKey(l)).toBe(toCompetenceKey(prox));
  });

  it("última renovação registrada manda sobre entrada + prazo", async () => {
    const prox = fromMonthIndex(monthIndex(HOJE) + 2);
    const id = await cliente("Com Renovação", {
      startedAt: new Date(Date.UTC(2020, 0, 10)),
      contractMonths: 12,
    });
    await asOwner(owner, async () =>
      prisma.clientRenewal.create({
        data: {
          clientId: id, months: 6, totalValue: 6000,
          renewedAt: new Date(), newEndDate: new Date(Date.UTC(prox.year, prox.month - 1, 20)),
        },
      })
    );
    await runWithoutScope(async () => prisma.$executeRawUnsafe(backfillDaExpectativa(owner.id)));
    const c = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id }, select: { expectedRenewalAt: true } })
    );
    expect(civilCompetenceKey(c.expectedRenewalAt!)).toBe(toCompetenceKey(prox));
    expect(civilParts(c.expectedRenewalAt!).day).toBe(20);
  });
});
