import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { prisma, runWithoutScope, createOwner, destroyOwner, defaultAgency, type TestOwner } from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * NÚMERO DE WHATSAPP → USUÁRIO (28/09/2026).
 *  · só o administrador vincula; usuário do workspace, ativo; um número ativo
 *    por workspace (inclusive nas variantes do nono dígito);
 *  · a integração resolve SÓ pelo número (userId no corpo = 400) e recebe o
 *    usuário, as permissões relevantes e os scopes que pode usar por ele;
 *  · com X-B2C-Identity, a API recorta os scopes pelo RBAC do usuário e o
 *    registra como ator — outro workspace, desativado ou inativo = recusado.
 */

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { criarIntegracao } from "@/lib/services/service-accounts";
import {
  vincularWhatsApp, desvincularWhatsApp, reativarWhatsApp, listarIdentidades,
} from "@/lib/services/messaging-identities";
import { normalizarWhatsApp, variantesDoNumero, mascararTelefone } from "@/lib/messaging/phone";
import { API_SCOPES } from "@/lib/api/scopes";
import * as resolve from "@/app/api/v1/integrations/resolve-identity/route";
import * as clients from "@/app/api/v1/clients/route";
import * as receivables from "@/app/api/v1/receivables/route";
import * as reportsDaily from "@/app/api/v1/reports/daily/route";

const TAG = randomUUID().slice(0, 6);
const num = (sufixo: string) => `55719${sufixo}`; // 5571 9XXXX-XXXX (celular BA)

let A: TestOwner;
let B: TestOwner;
let token: string;
let tokenSemIdentidade: string;
let tokenB: string;
const u: Record<string, string> = {};

const admin = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: o.id, name: "Admin", email: o.email, role: "ADMIN", permissions: [], workspaceOwnerId: null },
});
const gestor = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: "g", name: "Gestor", email: "g@b2c.local", role: "GESTOR", permissions: [], workspaceOwnerId: o.id },
});
const ctxA = () => ({ ownerId: A.id, principal: admin(A) });

async function membro(o: TestOwner, nome: string, role: string, extra: Record<string, unknown> = {}) {
  return (
    await runWithoutScope(async () =>
      await prisma.user.create({
        data: { name: `${nome} ${TAG}`, email: `${nome.toLowerCase()}-${randomUUID()}@b2c.local`, passwordHash: "x", role, workspaceOwnerId: o.id, ...extra },
        select: { id: true },
      })
    )
  ).id;
}
async function chave(o: TestOwner, scopes: string[]) {
  const r = await criarIntegracao({ ownerId: o.id, principal: admin(o) }, { name: `wa-${TAG}`, scopes, expiresInDays: null });
  if (!r.ok) throw new Error(r.error);
  return r.token;
}
async function resolver(externalIdentifier: string, tk = token, extra: Record<string, unknown> = {}) {
  const res = await resolve.POST(
    new Request("http://localhost/api/v1/integrations/resolve-identity", {
      method: "POST",
      headers: { authorization: `Bearer ${tk}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: "WHATSAPP", externalIdentifier, ...extra }),
    })
  );
  return { status: res.status, body: await res.json() };
}
async function get(rota: { GET: (r: Request) => Promise<Response> }, path: string, identidade?: string, tk = token) {
  const headers: Record<string, string> = { authorization: `Bearer ${tk}` };
  if (identidade !== undefined) headers["x-b2c-identity"] = identidade;
  const res = await rota.GET(new Request(`http://localhost/api/v1${path}`, { headers }));
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  u.leitura = await membro(A, "Leitura", "LEITURA");
  u.financeiro = await membro(A, "Financeiro", "FINANCEIRO");
  u.inativo = await membro(A, "Inativo", "FINANCEIRO", { active: false });
  u.agencia = await membro(A, "Agencia", "COMERCIAL", { dataScope: "AGENCY", scopeAgencyId: (await defaultAgency()).id });
  u.deB = await membro(B, "DeB", "FINANCEIRO");
  token = await chave(A, API_SCOPES);
  tokenSemIdentidade = await chave(A, API_SCOPES.filter((s) => s !== "identities.resolve"));
  tokenB = await chave(B, API_SCOPES);
});
afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.messagingIdentity.deleteMany({ where: { ownerId: { in: [A.id, B.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
  });
  await destroyOwner(A);
  await destroyOwner(B);
});

describe("telefone", () => {
  it("normaliza formatos e gera a variante do nono dígito", () => {
    expect(normalizarWhatsApp("+55 (71) 99999-0000")).toBe("5571999990000");
    expect(normalizarWhatsApp("(71) 99999-0000")).toBe("5571999990000");
    expect(normalizarWhatsApp("0055 71 99999 0000")).toBe("5571999990000");
    expect(normalizarWhatsApp("+1 415 555 0100")).toBe("14155550100");
    expect(normalizarWhatsApp("123")).toBeNull();
    expect(variantesDoNumero("5571999990000").sort()).toEqual(["557199990000", "5571999990000"].sort());
    expect(variantesDoNumero("557199990000").sort()).toEqual(["557199990000", "5571999990000"].sort());
    expect(mascararTelefone("5571999990000")).toBe("5571•••••0000");
  });
});

describe("vínculo (administração)", () => {
  it("só o administrador vincula; usuário precisa ser do workspace e ativo", async () => {
    expect(await vincularWhatsApp({ ownerId: A.id, principal: gestor(A) }, { userId: u.leitura, telefone: num("88880001") }))
      .toMatchObject({ ok: false, code: "SEM_PERMISSAO" });
    expect(await vincularWhatsApp(ctxA(), { userId: u.deB, telefone: num("88880001") })).toMatchObject({ ok: false, code: "NAO_ENCONTRADO" });
    expect(await vincularWhatsApp(ctxA(), { userId: u.inativo, telefone: num("88880001") })).toMatchObject({ ok: false, code: "INVALIDO" });
    expect(await vincularWhatsApp(ctxA(), { userId: u.leitura, telefone: "12" })).toMatchObject({ ok: false, code: "INVALIDO" });
  });

  it("vincula normalizado, audita e recusa o mesmo número (em qualquer formato) para outro usuário", async () => {
    const r = await vincularWhatsApp(ctxA(), { userId: u.leitura, telefone: "(71) 98888-0001" });
    expect(r).toMatchObject({ ok: true, externalIdentifier: num("88880001") });
    const aud = await runWithoutScope(async () => await prisma.auditLog.findMany({ where: { entity: "MessagingIdentity", entityId: (r as any).id } }));
    expect(aud.some((a) => a.action === "CREATE")).toBe(true);
    // Mesmo número sem o nono dígito, para outro usuário: recusado.
    expect(await vincularWhatsApp(ctxA(), { userId: u.financeiro, telefone: "557188880001" })).toMatchObject({ ok: false, code: "DUPLICADO" });
    expect((await vincularWhatsApp(ctxA(), { userId: u.financeiro, telefone: num("88880002") })).ok).toBe(true);
    expect((await vincularWhatsApp(ctxA(), { userId: u.agencia, telefone: num("88880003") })).ok).toBe(true);
    const lista = await listarIdentidades(ctxA());
    expect(lista.map((x) => x.user.id)).toEqual(expect.arrayContaining([u.leitura, u.financeiro, u.agencia]));
  });
});

describe("POST /integrations/resolve-identity", () => {
  it("resolve pelo número: usuário, papel, permissões relevantes e scopes efetivos", async () => {
    const r = await resolver("+55 71 98888-0001");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.user).toEqual({ id: u.leitura, name: `Leitura ${TAG}`, role: "LEITURA", roleLabel: "Leitura" });
    // LEITURA vê clientes e dashboard, mas não os números financeiros.
    expect(r.body.data.allowedScopes.sort()).toEqual(["client_status.read", "clients.read"]);
    expect(r.body.data.permissions).toEqual(expect.arrayContaining(["clientes.visualizar", "dashboard.visualizar"]));
    expect(r.body.data.permissions).not.toContain("recebimentos.visualizar");
    expect(r.body.data.delegation).toEqual({ header: "X-B2C-Identity", value: r.body.data.identityId });
    expect(r.body.data).not.toHaveProperty("user.email");
  });

  it("a variante sem o nono dígito (como a Meta às vezes envia) resolve o mesmo vínculo", async () => {
    const r = await resolver("557188880001");
    expect(r.body.data.user.id).toBe(u.leitura);
  });

  it("não vinculado = 404; userId no corpo = 400; sem scope = 403; outro workspace = 404", async () => {
    expect((await resolver(num("77770000"))).body.error.code).toBe("identity_not_found");
    const comUserId = await resolver(num("88880001"), token, { userId: u.financeiro });
    expect(comUserId.status).toBe(400);
    expect((await resolver(num("88880001"), tokenSemIdentidade)).status).toBe(403);
    expect((await resolver(num("88880001"), tokenB)).status).toBe(404);
  });

  it("desvincular corta na hora; reativar volta; usuário inativado deixa de resolver", async () => {
    const id = (await resolver(num("88880002"))).body.data.identityId;
    expect((await desvincularWhatsApp(ctxA(), id)).ok).toBe(true);
    expect((await resolver(num("88880002"))).status).toBe(404);
    expect((await reativarWhatsApp(ctxA(), id)).ok).toBe(true);
    expect((await resolver(num("88880002"))).status).toBe(200);
    await runWithoutScope(async () => await prisma.user.update({ where: { id: u.financeiro }, data: { active: false } }));
    expect((await resolver(num("88880002"))).status).toBe(404);
    await runWithoutScope(async () => await prisma.user.update({ where: { id: u.financeiro }, data: { active: true } }));
  });

  it("usuário restrito a uma agência é recusado (a integração ainda não aplica esse recorte)", async () => {
    const r = await resolver(num("88880003"));
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("agency_scope_not_supported");
  });
});

describe("delegação X-B2C-Identity", () => {
  it("recorta pelo RBAC do usuário: LEITURA lê clientes, não recebimentos; ator vai para a trilha", async () => {
    const id = (await resolver(num("88880001"))).body.data.identityId;
    const ok = await get(clients, "/clients?pageSize=1", id);
    expect(ok.status).toBe(200);
    const atividade = await runWithoutScope(async () => await prisma.apiActivity.findFirst({ where: { requestId: ok.body.meta.requestId } }));
    expect(atividade?.actorUserId).toBe(u.leitura);
    const negado = await get(receivables, "/receivables", id);
    expect(negado.status).toBe(403);
    expect(negado.body.error.code).toBe("user_forbidden");
  });

  it("FINANCEIRO lê recebimentos; relatório omite o que ele não vê (upsell)", async () => {
    const id = (await resolver(num("88880002"))).body.data.identityId;
    expect((await get(receivables, "/receivables", id)).status).toBe(200);
    const rel = await get(reportsDaily, "/reports/daily", id);
    expect(rel.status).toBe(200);
    expect(rel.body.meta.omittedSections).toContain("upsells");
    expect(rel.body.meta.omittedSections).not.toContain("receivables");
  });

  it("identidade inválida, de outro workspace ou sem scope identities.resolve = recusada", async () => {
    expect((await get(clients, "/clients", "nao-existe")).body.error.code).toBe("invalid_identity");
    const deB = await vincularWhatsApp({ ownerId: B.id, principal: admin(B) }, { userId: u.deB, telefone: num("66660001") });
    expect(deB.ok).toBe(true);
    expect((await get(clients, "/clients", (deB as any).id)).body.error.code).toBe("invalid_identity");
    const id = (await resolver(num("88880001"))).body.data.identityId;
    const semScope = await get(clients, "/clients", id, tokenSemIdentidade);
    expect(semScope.status).toBe(403);
    expect(semScope.body.error.scope).toBe("identities.resolve");
  });
});
