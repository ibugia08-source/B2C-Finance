import { describe, it, expect } from "vitest";
import { prisma, runWithoutScope, assertTestDatabase } from "./support/db";

/**
 * ORGANIZAÇÃO: Workspace → EntidadeLegal → Agência (ref. 01 §4.2).
 * Trava o padrão de setup (1 entidade = 1 agência espelhadas) e as regras
 * que impedem duplicidade — a base de tudo que a Fase 1 vai pendurar aqui.
 */

describe("estrutura organizacional", () => {
  it("o workspace nasce com fuso, locale e moeda do dono", async () => {
    assertTestDatabase();
    const ws = await runWithoutScope(async () =>
      prisma.workspace.findFirst({ select: { timezone: true, locale: true, currency: true } })
    );
    expect(ws).not.toBeNull();
    expect(ws!.timezone).toBe("America/Bahia");
    expect(ws!.locale).toBe("pt-BR");
    expect(ws!.currency).toBe("BRL");
  });

  it("existe 1 EntidadeLegal espelhada por 1 Agência", async () => {
    const [entidades, agencias] = await runWithoutScope(async () =>
      Promise.all([
        prisma.legalEntity.findMany({ select: { id: true, legalName: true, cnpj: true } }),
        prisma.agency.findMany({ select: { slug: true, legalEntityId: true, active: true } }),
      ])
    );
    expect(entidades).toHaveLength(1);
    expect(agencias).toHaveLength(1);
    expect(agencias[0].legalEntityId).toBe(entidades[0].id);
    expect(agencias[0].slug).toBe("b2c-gestao");
    // CNPJ segue nulo: depende da DECISÃO 19.15, ainda em aberto.
    expect(entidades[0].cnpj).toBeNull();
  });

  it("agências diferentes podem compartilhar a mesma EntidadeLegal", async () => {
    const le = await runWithoutScope(async () =>
      prisma.legalEntity.findFirstOrThrow({ select: { id: true, workspaceId: true } })
    );
    const criada = await runWithoutScope(async () =>
      prisma.agency.create({
        data: {
          workspaceId: le.workspaceId,
          legalEntityId: le.id,
          name: "Life Ads (teste)",
          slug: "life-ads-teste",
        },
        select: { id: true, legalEntityId: true },
      })
    );
    expect(criada.legalEntityId).toBe(le.id);
    await runWithoutScope(async () => prisma.agency.delete({ where: { id: criada.id } }));
  });

  it("o slug da agência é único dentro do workspace", async () => {
    const existente = await runWithoutScope(async () =>
      prisma.agency.findFirstOrThrow({ select: { workspaceId: true, legalEntityId: true, slug: true } })
    );
    await expect(
      runWithoutScope(async () =>
        prisma.agency.create({
          data: {
            workspaceId: existente.workspaceId,
            legalEntityId: existente.legalEntityId,
            name: "Cópia",
            slug: existente.slug,
          },
        })
      )
    ).rejects.toThrow();
  });
});
