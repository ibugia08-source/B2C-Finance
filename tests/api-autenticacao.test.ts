import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, type TestOwner,
} from "./support/db";
import type { DomainContext } from "@/lib/engines/domain";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * API /api/v1 — AUTENTICAÇÃO POR CONTA DE SERVIÇO (28/09/2026).
 * docs/API_AUTHENTICATION.md. O que se prova aqui:
 *  · token válido entra; inválido, revogado e expirado não (401);
 *  · scope ausente = 403, e a conta não passa do scope nem dentro do domínio;
 *  · o dono é o da conta — nunca atravessa para outro workspace;
 *  · o banco nunca guarda o token; lastUsedAt não vira escrita por requisição;
 *  · só quem tem integracoes.gerenciar (ADMIN) cria, revoga e rotaciona.
 */

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { authenticateApiToken, requireApiScope, LAST_USED_JANELA_MS } from "@/lib/api/auth";
import { defineEndpoint } from "@/lib/api/http";
import { API_SCOPES, FORBIDDEN_SCOPES, parseApiScopes, scopePermite, PERMISSION_TO_SCOPE } from "@/lib/api/scopes";
import { hashToken } from "@/lib/api/tokens";
import {
  criarIntegracao, revogarIntegracao, rotacionarIntegracao, listarIntegracoes,
} from "@/lib/services/service-accounts";
import { domainCan } from "@/lib/engines/domain";
import { guardPermission } from "@/lib/engines/guards";
import { runWithPrincipal } from "@/lib/auth/owner-scope";
import { ADMIN_ONLY_PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions";

let donoA: TestOwner;
let donoB: TestOwner;

const pessoa = (role: string, permissions: string[] = []): Principal => ({
  kind: "user",
  origin: "UI",
  user: {
    id: `u-${role}`, name: role, email: `${role.toLowerCase()}@b2c.local`, role,
    permissions: permissions.map((permission) => ({ permission, enabled: true })),
    workspaceOwnerId: null,
  },
});
const ctx = (o: TestOwner, principal: Principal = pessoa("ADMIN")): DomainContext => ({ ownerId: o.id, principal });

async function novaChave(o: TestOwner, scopes: string[], extra: { expiresInDays?: number | null; name?: string } = {}) {
  const r = await criarIntegracao(ctx(o), {
    name: extra.name ?? "B2C Finance AI Agent",
    description: "teste",
    scopes,
    expiresInDays: extra.expiresInDays ?? null,
  });
  if (!r.ok) throw new Error(r.error);
  return r;
}

const bearer = (t: string) => `Bearer ${t}`;
const req = (token?: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/teste", {
    headers: { ...(token ? { authorization: bearer(token) } : {}), ...headers },
  });

beforeAll(async () => {
  donoA = await createOwner();
  donoB = await createOwner();
});
afterAll(async () => {
  await destroyOwner(donoA);
  await destroyOwner(donoB);
});

describe("token", () => {
  it("token válido autentica e devolve a conta, o dono e os scopes", async () => {
    const k = await novaChave(donoA, ["clients.read", "dashboard.read"]);
    expect(k.token).toMatch(/^b2c_live_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const r = await authenticateApiToken(bearer(k.token));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.auth.ownerId).toBe(donoA.id);
    expect(r.auth.serviceAccountId).toBe(k.id);
    expect(r.auth.scopes).toEqual(["clients.read", "dashboard.read"]);
    expect(r.auth.principal).toMatchObject({ kind: "system", origin: "API" });
  });

  it("GET protegido com token válido responde 200", async () => {
    const k = await novaChave(donoA, ["clients.read"]);
    const GET = defineEndpoint({ action: "teste", scope: null }, async ({ auth }) => ({ data: { id: auth.serviceAccountId } }));
    const res = await GET(req(k.token, { "x-request-id": "corr-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, data: { id: k.id }, meta: { requestId: "corr-1" } });
    expect(typeof body.meta.generatedAt).toBe("string");
    expect(res.headers.get("x-request-id")).toBe("corr-1");
  });

  it("token inválido: ausente, malformado, segredo errado e prefixo inexistente → 401", async () => {
    const k = await novaChave(donoA, ["clients.read"]);
    const semToken = await authenticateApiToken(null);
    expect(!semToken.ok && semToken.error.code).toBe("missing_token");
    for (const t of [
      "qualquer-coisa",
      k.token.slice(0, -1) + (k.token.endsWith("A") ? "B" : "A"), // segredo errado
      "b2c_live_zzzzzzzz_" + "x".repeat(43), // prefixo que não existe
    ]) {
      const r = await authenticateApiToken(bearer(t));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.status).toBe(401);
        expect(r.error.code).toBe("invalid_token");
      }
    }
    const GET = defineEndpoint({ action: "teste", scope: null }, async () => ({ data: {} }));
    const res = await GET(req("b2c_live_zzzzzzzz_" + "x".repeat(43)));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("cookie de sessão não autentica a API", async () => {
    const GET = defineEndpoint({ action: "teste", scope: null }, async () => ({ data: {} }));
    const res = await GET(req(undefined, { cookie: "b2c_session=qualquer.coisa" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: { code: "missing_token" } });
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("token revogado → 401 revoked_token, na hora", async () => {
    const k = await novaChave(donoA, ["clients.read"]);
    expect((await authenticateApiToken(bearer(k.token))).ok).toBe(true);
    expect((await revogarIntegracao(ctx(donoA), k.id)).ok).toBe(true);
    const r = await authenticateApiToken(bearer(k.token));
    expect(!r.ok && r.error.code).toBe("revoked_token");
    // Revogada não rotaciona (não "ressuscita").
    const rot = await rotacionarIntegracao(ctx(donoA), k.id);
    expect(rot.ok).toBe(false);
  });

  it("token expirado → 401 expired_token", async () => {
    const k = await novaChave(donoA, ["clients.read"], { expiresInDays: 30 });
    const ainda = await authenticateApiToken(bearer(k.token), new Date(Date.now() + 29 * 86_400_000));
    expect(ainda.ok).toBe(true);
    const depois = await authenticateApiToken(bearer(k.token), new Date(Date.now() + 31 * 86_400_000));
    expect(!depois.ok && depois.error.code).toBe("expired_token");
  });

  it("dono inativo → 401 inactive_owner", async () => {
    const dono = await createOwner();
    try {
      const k = await novaChave(dono, ["clients.read"]);
      await runWithoutScope(async () => await prisma.user.update({ where: { id: dono.id }, data: { active: false } }));
      const r = await authenticateApiToken(bearer(k.token));
      expect(!r.ok && r.error.code).toBe("inactive_owner");
    } finally {
      await destroyOwner(dono);
    }
  });

  it("rotacionar: o token antigo para na hora e o novo entra", async () => {
    const k = await novaChave(donoA, ["clients.read"], { expiresInDays: 90 });
    const rot = await rotacionarIntegracao(ctx(donoA), k.id);
    expect(rot.ok).toBe(true);
    if (!rot.ok) return;
    expect(rot.token).not.toBe(k.token);
    expect(rot.tokenPrefix).not.toBe(k.tokenPrefix);
    const velho = await authenticateApiToken(bearer(k.token));
    expect(!velho.ok && velho.error.code).toBe("invalid_token");
    expect((await authenticateApiToken(bearer(rot.token))).ok).toBe(true);
  });
});

describe("armazenamento", () => {
  it("o banco guarda só o hash e o prefixo — nunca o token", async () => {
    const k = await novaChave(donoA, ["clients.read"]);
    const row = await runWithoutScope(async () => await prisma.serviceAccount.findUnique({ where: { id: k.id } }));
    expect(row!.tokenHash).toBe(hashToken(k.token));
    expect(JSON.stringify(row)).not.toContain(k.token.split("_").pop()!);
    expect(row!.tokenPrefix).toBe(k.tokenPrefix);
    // A trilha registra a criação sem o segredo.
    const trilha = await runWithoutScope(async () =>
      await prisma.auditLog.findMany({ where: { entity: "ServiceAccount", entityId: k.id } })
    );
    expect(trilha.length).toBeGreaterThan(0);
    expect(JSON.stringify(trilha)).not.toContain(k.token.split("_").pop()!);
  });

  it("o banco recusa gravar algo que não seja um SHA-256 no lugar do hash", async () => {
    await expect(
      runWithoutScope(async () =>
        await prisma.serviceAccount.create({
          data: {
            ownerId: donoA.id, name: "x", tokenHash: "b2c_live_token_puro", tokenPrefix: "b2c_live_puro0000",
            scopes: [], createdById: donoA.id,
          },
        })
      )
    ).rejects.toThrow();
  });

  it("lastUsedAt: grava no primeiro uso e não regrava dentro de um minuto", async () => {
    const k = await novaChave(donoA, ["clients.read"]);
    const ler = async () =>
      (await runWithoutScope(async () => await prisma.serviceAccount.findUnique({ where: { id: k.id } })))!.lastUsedAt;
    expect(await ler()).toBeNull();
    const t0 = new Date();
    await authenticateApiToken(bearer(k.token), t0);
    expect((await ler())?.getTime()).toBe(t0.getTime());
    await authenticateApiToken(bearer(k.token), new Date(t0.getTime() + 10_000));
    expect((await ler())?.getTime()).toBe(t0.getTime());
    const t2 = new Date(t0.getTime() + LAST_USED_JANELA_MS + 1);
    await authenticateApiToken(bearer(k.token), t2);
    expect((await ler())?.getTime()).toBe(t2.getTime());
  });
});

describe("scope", () => {
  it("scope ausente → 403 insufficient_scope, sem executar o handler", async () => {
    const k = await novaChave(donoA, ["dashboard.read"]);
    let executou = false;
    const GET = defineEndpoint({ action: "teste", scope: "clients.read" }, async () => {
      executou = true;
      return { data: {} };
    });
    const res = await GET(req(k.token));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "insufficient_scope", scope: "clients.read" });
    expect(res.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(executou).toBe(false);
  });

  it("requireApiScope com o scope presente passa", async () => {
    const k = await novaChave(donoA, ["clients.read"]);
    const r = await authenticateApiToken(bearer(k.token));
    if (!r.ok) throw r.error;
    expect(() => requireApiScope(r.auth, "clients.read")).not.toThrow();
    expect(() => requireApiScope(r.auth, "expenses.pay")).toThrow(/expenses.pay/);
  });

  it("dentro do domínio a conta também esbarra no scope (defesa em profundidade)", async () => {
    const k = await novaChave(donoA, ["receivables.read"]);
    const r = await authenticateApiToken(bearer(k.token));
    if (!r.ok) throw r.error;
    const c: DomainContext = { ownerId: donoA.id, principal: r.auth.principal };
    expect(domainCan(c, "recebimentos.visualizar")).toBe(true);
    expect(domainCan(c, "recebimentos.registrar_pagamento")).toBe(false);
    expect(domainCan(c, "recebimentos.excluir")).toBe(false);
    expect(domainCan(c, "usuarios.criar")).toBe(false);
    const guarda = await runWithPrincipal(donoA.id, r.auth.principal, async () => ({
      ler: await guardPermission("recebimentos.visualizar"),
      pagar: await guardPermission("recebimentos.registrar_pagamento"),
    }));
    expect(guarda.ler.ok).toBe(true);
    expect(guarda.pagar.ok).toBe(false);
    // Job/webhook (sistema sem conta de serviço) segue como antes.
    expect(domainCan({ ownerId: donoA.id, principal: { kind: "system", name: "cron", origin: "JOB" } }, "recebimentos.excluir")).toBe(true);
  });

  it("catálogo: sem curinga e sem os scopes proibidos", () => {
    for (const s of FORBIDDEN_SCOPES) expect(API_SCOPES).not.toContain(s);
    expect(API_SCOPES.some((s) => s.includes("*"))).toBe(false);
    expect(Object.values(PERMISSION_TO_SCOPE).every((s) => API_SCOPES.includes(s))).toBe(true);
    expect(parseApiScopes(["*"]).ok).toBe(false);
    expect(parseApiScopes(["clients.delete"])).toMatchObject({ ok: false });
    expect(parseApiScopes(["users.manage", "clients.read"]).ok).toBe(false);
    expect(parseApiScopes([]).ok).toBe(false);
    expect(parseApiScopes(["dashboard.read", "clients.read", "clients.read"])).toEqual({
      ok: true, scopes: ["clients.read", "dashboard.read"],
    });
    expect(scopePermite(["clients.read"], "clientes.excluir")).toBe(false);
  });

  it("criar integração com scope proibido é recusado", async () => {
    const r = await criarIntegracao(ctx(donoA), {
      name: "Tentativa", scopes: ["clients.read", "competences.reopen"], expiresInDays: null,
    });
    expect(r.ok).toBe(false);
  });
});

describe("isolamento por dono", () => {
  it("a chamada roda no dono da conta: lê os clientes de A, nunca os de B", async () => {
    const deA = await createMrrClient(donoA, { name: "Cliente só do A" });
    const deB = await createMrrClient(donoB, { name: "Cliente só do B" });
    const k = await novaChave(donoA, ["clients.read"]);
    const GET = defineEndpoint({ action: "teste", scope: "clients.read" }, async () => ({
      data: { ids: (await prisma.client.findMany({ select: { id: true } })).map((c) => c.id) },
    }));
    const res = await GET(req(k.token));
    const { ids } = (await res.json()).data;
    expect(ids).toContain(deA.id);
    expect(ids).not.toContain(deB.id);
  });

  it("B não vê, não revoga e não rotaciona a integração de A", async () => {
    const k = await novaChave(donoA, ["clients.read"], { name: "Integração do A" });
    const listaB = await listarIntegracoes(ctx(donoB));
    expect(listaB.map((i) => i.id)).not.toContain(k.id);
    expect(await revogarIntegracao(ctx(donoB), k.id)).toMatchObject({ ok: false, code: "NAO_ENCONTRADO" });
    expect(await rotacionarIntegracao(ctx(donoB), k.id)).toMatchObject({ ok: false, code: "NAO_ENCONTRADO" });
    expect((await authenticateApiToken(bearer(k.token))).ok).toBe(true);
  });
});

describe("quem gerencia integrações", () => {
  it("usuário sem permissão administrativa não cria, não revoga, não rotaciona", async () => {
    const k = await novaChave(donoA, ["clients.read"]);
    for (const p of [pessoa("GESTOR"), pessoa("FINANCEIRO"), pessoa("LEITURA", ["integracoes.visualizar"])]) {
      const c = ctx(donoA, p);
      expect(await criarIntegracao(c, { name: "Não deveria", scopes: ["clients.read"], expiresInDays: null }))
        .toMatchObject({ ok: false, code: "SEM_PERMISSAO" });
      expect(await revogarIntegracao(c, k.id)).toMatchObject({ ok: false, code: "SEM_PERMISSAO" });
      expect(await rotacionarIntegracao(c, k.id)).toMatchObject({ ok: false, code: "SEM_PERMISSAO" });
    }
    expect((await authenticateApiToken(bearer(k.token))).ok).toBe(true);
  });

  it("uma conta de serviço (ou job) nunca cria outra chave", async () => {
    const k = await novaChave(donoA, API_SCOPES);
    const r = await authenticateApiToken(bearer(k.token));
    if (!r.ok) throw r.error;
    const viaApi = await criarIntegracao({ ownerId: donoA.id, principal: r.auth.principal }, {
      name: "Filha", scopes: ["clients.read"], expiresInDays: null,
    });
    expect(viaApi).toMatchObject({ ok: false, code: "SEM_PERMISSAO" });
    const viaJob = await criarIntegracao({ ownerId: donoA.id, principal: { kind: "system", name: "cron", origin: "JOB" } }, {
      name: "Filha", scopes: ["clients.read"], expiresInDays: null,
    });
    expect(viaJob).toMatchObject({ ok: false, code: "SEM_PERMISSAO" });
  });

  it("integracoes.gerenciar é só do ADMIN: nenhum papel nasce com ela e a matriz a trava", () => {
    expect(ADMIN_ONLY_PERMISSIONS.has("integracoes.gerenciar")).toBe(true);
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === "ADMIN") continue;
      expect(perms).not.toContain("integracoes.gerenciar");
    }
  });
});
