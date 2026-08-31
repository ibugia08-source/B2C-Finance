import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import {
  asOwner, createMrrClient, createOwner, createRelationship, defaultAgency,
  destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  ADMIN_ONLY_PERMISSIONS, ALL_PERMISSION_IDS, ASSIGNABLE_ROLES, CAMPO_OCULTO,
  PERMISSOES_DO_DONO, ROLE_PERMISSIONS, canSeeField, effectivePermissions,
  hasPermission, maskField, type Role,
} from "@/lib/permissions";
import { parseDataScope, scopeFingerprint } from "@/lib/scope";
import { carregarGrade } from "@/lib/services/avaliacao-mensal";
import { whereDaRelacao } from "@/lib/services/data-scope";

/**
 * F1.10 — RBAC estendido, recorte de dados e permissão de campo.
 *
 * Estes testes existem para provar as DECISÕES da direção de 31/08, não a
 * mecânica do RBAC (essa já era do v1). Cada bloco corresponde a uma frase
 * que a direção escreveu.
 */

describe("F1.10 — folha é do dono (decisão 19.11)", () => {
  it("NENHUM papel recebe folha por padrão", () => {
    for (const papel of ASSIGNABLE_ROLES) {
      if (papel === "ADMIN") continue;
      for (const p of PERMISSOES_DO_DONO) {
        expect(
          hasPermission({ role: papel, permissions: [] }, p),
          `o papel ${papel} não pode nascer com ${p}`
        ).toBe(false);
      }
    }
  });

  it("o dono concede um usuário por vez, e só para aquele usuário", () => {
    const semFolha = { role: "FINANCEIRO", permissions: [] };
    const comFolha = {
      role: "FINANCEIRO",
      permissions: [{ permission: "folha.visualizar", enabled: true }],
    };
    expect(hasPermission(semFolha, "folha.visualizar")).toBe(false);
    expect(hasPermission(comFolha, "folha.visualizar")).toBe(true);
    // Conceder ver NÃO concede editar.
    expect(hasPermission(comFolha, "folha.editar")).toBe(false);
  });

  it("o salário não vaza pela porta dos fundos: a permissão é de CAMPO", () => {
    // O ponto inteiro do campo sensível: quem não vê a tela da Folha também
    // não vê o número quando ele aparece no Dashboard ou no relatório.
    const gestor = { role: "GESTOR", permissions: [] };
    expect(canSeeField(gestor, "salario")).toBe(false);
    expect(maskField(gestor, "salario", 8500)).toBe(CAMPO_OCULTO);
    // E oculto é oculto — nunca zero, que seria informação errada.
    expect(maskField(gestor, "salario", 8500)).not.toBe(0);

    const dono = { role: "ADMIN", permissions: [] };
    expect(maskField(dono, "salario", 8500)).toBe(8500);
  });
});

describe("F1.10 — regra do motor é só do Admin (03 §1.2)", () => {
  it("as permissões de motor não estão em papel nenhum", () => {
    for (const papel of Object.keys(ROLE_PERMISSIONS) as Role[]) {
      if (papel === "ADMIN") continue;
      const lista = ROLE_PERMISSIONS[papel];
      for (const p of ADMIN_ONLY_PERMISSIONS) {
        expect(lista.includes(p), `${papel} não pode ter ${p}`).toBe(false);
      }
    }
  });

  it("o catálogo não tem id repetido nem id fora do padrão modulo.acao", () => {
    expect(new Set(ALL_PERMISSION_IDS).size).toBe(ALL_PERMISSION_IDS.length);
    for (const id of ALL_PERMISSION_IDS) expect(id).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it("todo papel só referencia permissão que existe no catálogo", () => {
    for (const papel of Object.keys(ROLE_PERMISSIONS) as Role[]) {
      for (const p of ROLE_PERMISSIONS[papel]) {
        if (p === "*") continue;
        expect(ALL_PERMISSION_IDS, `${papel} referencia ${p}`).toContain(p);
      }
    }
  });

  it("CONTADOR não escreve nada — é read-only por construção", () => {
    const escrita = /\.(criar|editar|excluir|registrar_pagamento|lancar|conciliar|ajustar|operar|gerenciar|marcar|alterar|importar|fechar|reabrir|gerar)/;
    for (const p of effectivePermissions({ role: "CONTADOR", permissions: [] })) {
      expect(p, `CONTADOR não pode ter ${p}`).not.toMatch(escrita);
    }
  });
});

describe("F1.10 — recorte de dados (decisão 19.11)", () => {
  it("ADMIN é sempre total, mesmo com agência gravada", () => {
    const s = parseDataScope({ role: "ADMIN", dataScope: "AGENCY", scopeAgencyId: "ag1" });
    expect(s.kind).toBe("WORKSPACE");
  });

  it("AGENCY sem agência cai para total em vez de esconder tudo", () => {
    // Falha para o lado seguro do USUÁRIO: um recorte quebrado que escondesse
    // a carteira inteira pareceria "o sistema perdeu os dados".
    const s = parseDataScope({ role: "GESTOR", dataScope: "AGENCY", scopeAgencyId: null });
    expect(s.kind).toBe("WORKSPACE");
  });

  it("recortes diferentes nunca compartilham chave de cache", () => {
    const a = scopeFingerprint({ kind: "AGENCY", agencyId: "x" });
    const b = scopeFingerprint({ kind: "AGENCY", agencyId: "y" });
    const t = scopeFingerprint({ kind: "WORKSPACE" });
    expect(new Set([a, b, t]).size).toBe(3);
  });

  it("o filtro é POSITIVO: diz o que entra, nunca o que sai", () => {
    expect(whereDaRelacao({ kind: "WORKSPACE" })).toEqual({});
    expect(whereDaRelacao({ kind: "AGENCY", agencyId: "ag1" })).toEqual({ agencyId: "ag1" });
  });
});

describe("F1.10 — o recorte chega ao dado, não só ao tipo", () => {
  let dono: TestOwner;
  let outraAgencia: { id: string };

  beforeAll(async () => {
    dono = await createOwner();
    const base = await defaultAgency();
    outraAgencia = await runWithoutScope(async () => {
      const ag = await prisma.agency.findFirst({ where: { id: base.id }, select: { workspaceId: true, legalEntityId: true } });
      return prisma.agency.create({
        data: {
          workspaceId: ag!.workspaceId,
          legalEntityId: ag!.legalEntityId,
          name: `Agência de teste ${randomUUID().slice(0, 6)}`,
          slug: `teste-${randomUUID().slice(0, 8)}`,
        },
        select: { id: true },
      });
    });
  });
  afterAll(async () => {
    await destroyOwner(dono);
    await runWithoutScope(async () => prisma.agency.delete({ where: { id: outraAgencia.id } }));
  });

  it("a grade de avaliação de quem tem recorte só traz a agência dele", async () => {
    const base = await defaultAgency();
    const daCasa = await createMrrClient(dono, { name: "Cliente da agência base" });
    const daOutra = await createMrrClient(dono, { name: "Cliente da outra agência" });
    await createRelationship(dono, daCasa.id, { agencyId: base.id });
    await createRelationship(dono, daOutra.id, { agencyId: outraAgencia.id });

    const tudo = await asOwner(dono, async () =>
      carregarGrade("2026-09" as any, { kind: "WORKSPACE" })
    );
    const nomesTudo = tudo.map((l) => l.clientName);
    expect(nomesTudo).toContain("Cliente da agência base");
    expect(nomesTudo).toContain("Cliente da outra agência");

    const recortado = await asOwner(dono, async () =>
      carregarGrade("2026-09" as any, { kind: "AGENCY", agencyId: outraAgencia.id })
    );
    const nomes = recortado.map((l) => l.clientName);
    expect(nomes).toContain("Cliente da outra agência");
    expect(nomes).not.toContain("Cliente da agência base");
  });

  it("o banco recusa recorte incoerente — não só a tela", async () => {
    // AGENCY sem agência seria um usuário cego por acidente; WORKSPACE com
    // agência seria um recorte que a tela mostra e a consulta ignora.
    await expect(
      runWithoutScope(async () =>
        prisma.$executeRawUnsafe(
          `UPDATE "User" SET "dataScope"='AGENCY', "scopeAgencyId"=NULL WHERE id=$1`,
          dono.id
        )
      )
    ).rejects.toThrow();
  });
});
