import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling, type TestOwner,
} from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * TELEGRAM · BLOCO 3 — HARDENING da API usada pelo canal.
 *  · callback sem IDOR: a ação de A não é confirmável por B, por outro
 *    workspace, por id inexistente ou adulterado;
 *  · concorrência: dois toques quase juntos, o mesmo update duas vezes e dois
 *    pagamentos simultâneos na mesma cobrança → UMA escrita;
 *  · limite por usuário nas rotas do agente (429 + Retry-After);
 *  · permissão efetiva = RBAC do usuário ∩ scopes da integração, por perfil;
 *  · a trilha não guarda token nem segredo.
 */

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { criarIntegracao } from "@/lib/services/service-accounts";
import { vincularIdentidade } from "@/lib/services/messaging-identities";
import { API_SCOPES, scopesDoUsuario } from "@/lib/api/scopes";
import { hasPermission } from "@/lib/permissions";
import { LIMITE_POR_USUARIO, chaveDaConfirmacao } from "@/lib/api/agent/catalog";
import { todayKey } from "@/lib/competence";
import * as resolve from "@/app/api/v1/integrations/resolve-identity/route";
import * as acoes from "@/app/api/v1/agent/pending-actions/route";
import * as umaAcao from "@/app/api/v1/agent/pending-actions/[id]/route";
import * as confirmar from "@/app/api/v1/agent/pending-actions/[id]/confirm/route";
import * as cancelar from "@/app/api/v1/agent/pending-actions/[id]/cancel/route";
import * as caixa from "@/app/api/v1/cash/summary/route";
import * as pagamentos from "@/app/api/v1/receivables/[id]/payments/route";

const TAG = randomUUID().slice(0, 6);
const HOJE = todayKey();
const [ANO, MES] = HOJE.slice(0, 7).split("-").map(Number);
const tgId = () => String(710000000 + Math.floor(Math.random() * 89_999_999));

let A: TestOwner;
let B: TestOwner;
const tok: Record<string, string> = {};
const u: Record<string, string> = {};
const idt: Record<string, string> = {};

const admin = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: o.id, name: "Admin", email: o.email, role: "ADMIN", permissions: [], workspaceOwnerId: null },
});

async function membro(o: TestOwner, nome: string, role: string) {
  return (
    await runWithoutScope(async () =>
      await prisma.user.create({
        data: { name: `${nome} ${TAG}`, email: `${nome.toLowerCase()}-${randomUUID()}@b2c.local`, passwordHash: "x", role, workspaceOwnerId: o.id },
        select: { id: true },
      })
    )
  ).id;
}

type Resp = { status: number; body: any; headers: Headers };
async function chamar(
  h: (req: Request, r?: any) => Promise<Response>, method: string, path: string,
  o: { token: string; identidade?: string; body?: unknown; key?: string; params?: Record<string, string>; msg?: string }
): Promise<Resp> {
  const headers: Record<string, string> = { authorization: `Bearer ${o.token}`, "content-type": "application/json", "x-b2c-source": "telegram" };
  if (o.identidade) headers["x-b2c-identity"] = o.identidade;
  if (o.key) headers["idempotency-key"] = o.key;
  if (o.msg) headers["x-b2c-message-id"] = o.msg;
  const res = await h(
    new Request(`http://localhost/api/v1${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }),
    o.params ? { params: o.params } : undefined
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const propor = (token: string, identidade: string, body: unknown) =>
  chamar(acoes.POST, "POST", "/agent/pending-actions", { token, identidade, body, msg: `tg:${tgId()}:${Math.floor(Math.random() * 1e6)}` });
const tocar = (token: string, identidade: string, id: string, upd = String(Math.floor(Math.random() * 1e9))) =>
  chamar(confirmar.POST, "POST", `/agent/pending-actions/${id}/confirm`, {
    token, identidade, params: { id }, body: { messageId: upd, via: "button" }, key: chaveDaConfirmacao(upd, id, "TELEGRAM"),
  });
const pagamentosDa = (billingId: string) => runWithoutScope(async () => await prisma.payment.count({ where: { billingId } }));

async function cobranca(o: TestOwner, nome: string, valor = 1500) {
  const c = await createMrrClient(o, { name: `${nome} ${TAG}`, monthlyValue: valor });
  return (await createBilling(o, c.id, { month: MES, year: ANO, amount: valor, revenueType: "ONE_TIME", description: `Avulso ${randomUUID()}` })).id;
}

async function vincular(o: TestOwner, chave: string, userId: string) {
  const id = tgId();
  const v = await vincularIdentidade({ ownerId: o.id, principal: admin(o) }, { userId, channel: "TELEGRAM", externalIdentifier: id });
  if (!v.ok) throw new Error(v.error);
  idt[chave] = v.id;
}

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  for (const [o, k] of [[A, "A"], [B, "B"]] as const) {
    const r = await criarIntegracao({ ownerId: o.id, principal: admin(o) }, { name: `seg-${k}-${TAG}`, scopes: API_SCOPES, expiresInDays: null });
    if (!r.ok) throw new Error(r.error);
    tok[k] = r.token;
  }
  u.fin1 = await membro(A, "FinUm", "FINANCEIRO");
  u.fin2 = await membro(A, "FinDois", "FINANCEIRO");
  u.flood = await membro(A, "Flood", "FINANCEIRO");
  u.comercial = await membro(A, "Comercial", "COMERCIAL");
  u.cobranca = await membro(A, "Cobranca", "COBRANCA");
  u.deB = await membro(B, "DeB", "FINANCEIRO");
  for (const k of ["fin1", "fin2", "flood", "comercial", "cobranca"]) await vincular(A, k, u[k]);
  await vincular(B, "deB", u.deB);
});
afterAll(async () => {
  await runWithoutScope(async () => {
    for (const o of [A, B]) {
      await prisma.transaction.deleteMany({ where: { ownerId: o.id } });
      await prisma.pendingAction.deleteMany({ where: { ownerId: o.id } });
      await prisma.messagingIdentity.deleteMany({ where: { ownerId: o.id } });
    }
    await prisma.userPermission.deleteMany({ where: { userId: { in: Object.values(u) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
  });
  await destroyOwner(A);
  await destroyOwner(B);
});

// ---------------------------------------------------------------------------

describe("callback sem IDOR", () => {
  it("B (mesmo workspace) não consulta, não confirma e não cancela a ação de A", async () => {
    const bil = await cobranca(A, "IDOR");
    const p = await propor(tok.A, idt.fin1, { operation: "registrar_pagamento", targetId: bil, input: { amount: 1500 } });
    const id = p.body.data.actionId;
    // 404 (e não 403) de propósito: a ação de outra pessoa "não existe" para B — nem confirma que o id é válido.
    expect((await chamar(umaAcao.GET, "GET", `/agent/pending-actions/${id}`, { token: tok.A, identidade: idt.fin2, params: { id } })).status).toBe(404);
    const r = await tocar(tok.A, idt.fin2, id);
    expect(r.status).toBe(404);
    expect((await chamar(cancelar.POST, "POST", `/agent/pending-actions/${id}/cancel`, { token: tok.A, identidade: idt.fin2, params: { id }, body: {} })).status).toBe(404);
    expect(await pagamentosDa(bil)).toBe(0);
    expect((await runWithoutScope(async () => await prisma.pendingAction.findUnique({ where: { id } })))!.status).toBe("PENDING");
  });

  it("outro workspace: nem com a integração de B, nem usando o vínculo de A na integração de B", async () => {
    const bil = await cobranca(A, "Owner");
    const p = await propor(tok.A, idt.fin1, { operation: "registrar_pagamento", targetId: bil, input: { amount: 1500 } });
    const id = p.body.data.actionId;
    expect((await tocar(tok.B, idt.deB, id)).status).toBe(404);
    const cruzado = await tocar(tok.B, idt.fin1, id);
    expect(cruzado.status).toBe(403);
    expect(cruzado.body.error.code).toBe("invalid_identity");
    expect(await pagamentosDa(bil)).toBe(0);
  });

  it("id inexistente = 404; id adulterado (fora do formato) = 400; nada executa", async () => {
    expect((await tocar(tok.A, idt.fin1, "cmnaoexiste000000000000000")).status).toBe(404);
    for (const ruim of ["..%2F..%2Fx", "a b", "x".repeat(65), "confirm:abc"]) {
      const r = await chamar(confirmar.POST, "POST", `/agent/pending-actions/${ruim}/confirm`, {
        token: tok.A, identidade: idt.fin1, params: { id: ruim }, body: { messageId: "1", via: "button" }, key: "telegram:1:x",
      });
      expect(r.status, ruim).toBe(400);
    }
  });
});

describe("concorrência — uma escrita só", () => {
  it("dois toques em Confirmar quase simultâneos (updates diferentes)", async () => {
    const bil = await cobranca(A, "Dois toques");
    const p = await propor(tok.A, idt.fin1, { operation: "registrar_pagamento", targetId: bil, input: { amount: 1500 } });
    const [r1, r2] = await Promise.all([tocar(tok.A, idt.fin1, p.body.data.actionId), tocar(tok.A, idt.fin1, p.body.data.actionId)]);
    const status = [r1.status, r2.status].sort();
    expect(status).toEqual([200, 409]);
    expect(await pagamentosDa(bil)).toBe(1);
  });

  it("o mesmo update duas vezes ao mesmo tempo (mesma Idempotency-Key)", async () => {
    const bil = await cobranca(A, "Mesmo update");
    const p = await propor(tok.A, idt.fin1, { operation: "registrar_pagamento", targetId: bil, input: { amount: 1500 } });
    const rs = await Promise.all([1, 2, 3].map(() => tocar(tok.A, idt.fin1, p.body.data.actionId, "88001")));
    expect(rs.some((r) => r.status === 200 && r.body.data.status === "EXECUTED")).toBe(true);
    for (const r of rs) expect([200, 409]).toContain(r.status);
    expect(await pagamentosDa(bil)).toBe(1);
  });

  it("duas requisições iguais de pagamento (mesma chave) e dois pagamentos simultâneos do saldo inteiro", async () => {
    const bil = await cobranca(A, "Pagamento duplo");
    const pagar = (key: string) =>
      chamar(pagamentos.POST, "POST", `/receivables/${bil}/payments`, { token: tok.A, params: { id: bil }, body: { amount: 1500 }, key });
    const iguais = await Promise.all([pagar("dup-1"), pagar("dup-1")]);
    expect(iguais.map((r) => r.status).sort()).toEqual(expect.arrayContaining([201]));
    expect(await pagamentosDa(bil)).toBe(1);

    const bil2 = await cobranca(A, "Pagamento simultaneo");
    const pagar2 = (key: string) =>
      chamar(pagamentos.POST, "POST", `/receivables/${bil2}/payments`, { token: tok.A, params: { id: bil2 }, body: { amount: 1500, allowDuplicate: true }, key });
    const dois = await Promise.all([pagar2(`a-${TAG}`), pagar2(`b-${TAG}`)]);
    expect(dois.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await pagamentosDa(bil2)).toBe(1);
  });
});

describe("limite por usuário (anti-abuso)", () => {
  it(`propor: ${LIMITE_POR_USUARIO.propor.max}/min por pessoa; depois 429 com Retry-After; outra pessoa segue normal`, async () => {
    const corpo = { operation: "criar_despesa", input: { description: `Flood ${TAG}`, amount: 10, dueDate: HOJE, type: "TOOL" } };
    for (let i = 0; i < LIMITE_POR_USUARIO.propor.max; i++) {
      expect((await propor(tok.A, idt.flood, corpo)).status).toBe(201);
    }
    const passou = await propor(tok.A, idt.flood, corpo);
    expect(passou.status).toBe(429);
    expect(passou.body.error.code).toBe("rate_limited");
    expect(passou.headers.get("retry-after")).toBe("60");
    expect((await propor(tok.A, idt.fin2, corpo)).status).toBe(201);
  });
});

describe("permissão efetiva = RBAC do usuário ∩ scopes da integração", () => {
  const efetivos = (role: string, conta: readonly string[] = API_SCOPES) =>
    scopesDoUsuario(conta, (p) => hasPermission({ role, permissions: [] }, p));

  it("matriz dos perfis reais", () => {
    expect(efetivos("COMERCIAL")).not.toContain("cash.read");
    expect(efetivos("COBRANCA")).not.toContain("expenses.update");
    expect(efetivos("COBRANCA")).not.toContain("expenses.create");
    expect(efetivos("FINANCEIRO")).toEqual(expect.arrayContaining(["receivables.read", "receivables.register_payment", "cash.read"]));
    expect(efetivos("ADMINISTRATIVO")).not.toContain("cash.read");
    expect(efetivos("LEITURA")).not.toContain("agent_actions.manage");
    for (const s of ["cash.read", "receivables.register_payment", "expenses.update", "clients.create", "client_status.write", "upsells.create", "agent_actions.manage"]) {
      expect(efetivos("ADMIN"), s).toContain(s);
      expect(efetivos("GESTOR"), s).toContain(s);
    }
    // A integração limita até o ADMIN.
    expect(efetivos("ADMIN", ["clients.read"])).toEqual(["clients.read"]);
  });

  it("na API: COMERCIAL não vê caixa; COBRANÇA não altera despesa; FINANCEIRO vê recebimentos", async () => {
    const caixaComercial = await chamar(caixa.GET, "GET", "/cash/summary", { token: tok.A, identidade: idt.comercial });
    expect(caixaComercial.status).toBe(403);
    expect(caixaComercial.body.error.code).toBe("user_forbidden");
    const despesa = await propor(tok.A, idt.cobranca, { operation: "criar_despesa", input: { description: "x", amount: 1, dueDate: HOJE, type: "TOOL" } });
    expect(despesa.status).toBe(403);
    const r = await chamar(resolve.POST, "POST", "/integrations/resolve-identity", {
      token: tok.A, body: { channel: "TELEGRAM", externalIdentifier: (await runWithoutScope(async () => await prisma.messagingIdentity.findUnique({ where: { id: idt.fin1 } })))!.externalIdentifier },
    });
    expect(r.body.data.allowedScopes).toEqual(expect.arrayContaining(["receivables.read", "receivables.register_payment"]));
  });
});

describe("logs e trilha sem segredo", () => {
  it("nenhuma atividade guarda token, Bearer, chave ou o Telegram User ID inteiro", async () => {
    const linhas = await runWithoutScope(async () => await prisma.apiActivity.findMany({ where: { ownerId: A.id } }));
    expect(linhas.length).toBeGreaterThan(10);
    const tudo = JSON.stringify(linhas);
    expect(tudo).not.toMatch(/b2c_(live|test)_|Bearer|sk-|AAH|password|senha/i);
    expect(tudo).not.toContain(tok.A);
    const ids = await runWithoutScope(async () => await prisma.messagingIdentity.findMany({ where: { ownerId: A.id }, select: { externalIdentifier: true } }));
    for (const i of ids) expect(tudo).not.toContain(i.externalIdentifier);
  });
});
