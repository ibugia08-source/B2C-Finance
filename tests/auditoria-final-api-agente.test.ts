import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling, type TestOwner,
} from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * AUDITORIA FINAL API + n8n + AGENTE (28/09/2026) — docs/AI_AGENT_RELEASE_CHECKLIST.md.
 *
 * Fecha as lacunas que a matriz da auditoria encontrou nas suítes existentes:
 *  · RBAC pela delegação para ADMIN e COMERCIAL (LEITURA e FINANCEIRO já
 *    tinham teste);
 *  · replay de despesa e de upsell (pagamento, cliente e status já tinham);
 *  · token de OUTRO dono em detalhe, escrita e confirmação de ação do agente;
 *  · trilha: leitura sensível e as quatro escritas numa só verificação;
 *  · cliente ambíguo: a busca devolve os dois para o agente perguntar.
 */

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { criarIntegracao } from "@/lib/services/service-accounts";
import { vincularWhatsApp } from "@/lib/services/messaging-identities";
import { API_SCOPES } from "@/lib/api/scopes";
import { chaveDaConfirmacao } from "@/lib/api/agent/catalog";
import { todayKey } from "@/lib/competence";
import * as resolve from "@/app/api/v1/integrations/resolve-identity/route";
import * as clientsRoute from "@/app/api/v1/clients/route";
import * as clientRoute from "@/app/api/v1/clients/[id]/route";
import * as statusChanges from "@/app/api/v1/clients/[id]/status-changes/route";
import * as receivables from "@/app/api/v1/receivables/route";
import * as receivable from "@/app/api/v1/receivables/[id]/route";
import * as payments from "@/app/api/v1/receivables/[id]/payments/route";
import * as expensesRoute from "@/app/api/v1/expenses/route";
import * as upsellsRoute from "@/app/api/v1/upsells/route";
import * as search from "@/app/api/v1/search/route";
import * as acoes from "@/app/api/v1/agent/pending-actions/route";
import * as confirmar from "@/app/api/v1/agent/pending-actions/[id]/confirm/route";

const TAG = randomUUID().slice(0, 6);
const HOJE = todayKey();
const [ANO, MES] = HOJE.slice(0, 7).split("-").map(Number);

let A: TestOwner;
let B: TestOwner;
let tokenA: string;
let tokenB: string;
const u: Record<string, string> = {};
const idt: Record<string, string> = {};

const admin = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: o.id, name: "Admin", email: o.email, role: "ADMIN", permissions: [], workspaceOwnerId: null },
});

type H = (req: Request, r?: any) => Promise<Response>;
async function chamar(
  h: H, method: string, path: string,
  o: { token?: string; identidade?: string; body?: unknown; key?: string; params?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = { authorization: `Bearer ${o.token ?? tokenA}`, "content-type": "application/json" };
  if (o.identidade) headers["x-b2c-identity"] = o.identidade;
  if (o.key) headers["idempotency-key"] = o.key;
  const res = await h(
    new Request(`http://localhost/api/v1${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }),
    o.params ? { params: o.params } : undefined
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function membro(nome: string, role: string) {
  return (
    await runWithoutScope(async () =>
      await prisma.user.create({
        data: { name: `${nome} ${TAG}`, email: `${nome.toLowerCase()}-${randomUUID()}@b2c.local`, passwordHash: "x", role, workspaceOwnerId: A.id },
        select: { id: true },
      })
    )
  ).id;
}

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  const t = async (o: TestOwner) => {
    const r = await criarIntegracao({ ownerId: o.id, principal: admin(o) }, { name: `aud-${TAG}`, scopes: API_SCOPES, expiresInDays: null });
    if (!r.ok) throw new Error(r.error);
    return r.token;
  };
  tokenA = await t(A);
  tokenB = await t(B);
  u.admin = await membro("Admin2", "ADMIN");
  u.financeiro = await membro("Fin", "FINANCEIRO");
  u.comercial = await membro("Comercial", "COMERCIAL");
  const tel: Record<string, string> = { admin: "5571944440001", financeiro: "5571944440002", comercial: "5571944440003" };
  for (const k of Object.keys(tel)) {
    const v = await vincularWhatsApp({ ownerId: A.id, principal: admin(A) }, { userId: u[k], telefone: tel[k] });
    if (!v.ok) throw new Error(v.error);
    const r = await chamar(resolve.POST, "POST", "/integrations/resolve-identity", { body: { channel: "WHATSAPP", externalIdentifier: `+${tel[k]}` } });
    idt[k] = r.body.data.identityId;
  }
});
afterAll(async () => {
  await runWithoutScope(async () => {
    for (const o of [A, B]) {
      await prisma.upsellService.deleteMany({ where: { ownerId: o.id } });
      await prisma.upsell.deleteMany({ where: { ownerId: o.id } });
      await prisma.transaction.deleteMany({ where: { ownerId: o.id } });
      await prisma.pendingAction.deleteMany({ where: { ownerId: o.id } });
      await prisma.messagingIdentity.deleteMany({ where: { ownerId: o.id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
  });
  await destroyOwner(A);
  await destroyOwner(B);
});

describe("RBAC pela delegação (WhatsApp)", () => {
  it("ADMIN: todos os scopes delegáveis da conta; lê recebimentos e propõe qualquer escrita", async () => {
    const r = await chamar(resolve.POST, "POST", "/integrations/resolve-identity", { body: { channel: "WHATSAPP", externalIdentifier: "+5571944440001" } });
    expect(r.body.data.allowedScopes).toEqual(
      expect.arrayContaining(["receivables.register_payment", "clients.create", "expenses.pay", "upsells.update", "agent_actions.manage"])
    );
    // Da máquina, nunca da pessoa.
    expect(r.body.data.allowedScopes).not.toContain("identities.resolve");
    expect(r.body.data.allowedScopes).not.toContain("knowledge.read");
    expect((await chamar(receivables.GET, "GET", "/receivables", { identidade: idt.admin })).status).toBe(200);
  });

  it("COMERCIAL: clientes e upsell sim; recebimentos e pagamento não (user_forbidden)", async () => {
    expect((await chamar(clientsRoute.GET, "GET", "/clients", { identidade: idt.comercial })).status).toBe(200);
    expect((await chamar(upsellsRoute.GET, "GET", "/upsells", { identidade: idt.comercial })).status).toBe(200);
    const rec = await chamar(receivables.GET, "GET", "/receivables", { identidade: idt.comercial });
    expect(rec.status).toBe(403);
    expect(rec.body.error.code).toBe("user_forbidden");
    const c = await createMrrClient(A, { name: `Comercial Alvo ${TAG}` });
    const up = await chamar(acoes.POST, "POST", "/agent/pending-actions", {
      identidade: idt.comercial, body: { operation: "criar_upsell", input: { clientId: c.id, description: "Tráfego", amount: 500 } },
    });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const b = await createBilling(A, c.id, { month: MES, year: ANO, amount: 100, revenueType: "ONE_TIME" });
    const pg = await chamar(acoes.POST, "POST", "/agent/pending-actions", {
      identidade: idt.comercial, body: { operation: "registrar_pagamento", targetId: b.id, input: { amount: 100 } },
    });
    expect(pg.status).toBe(403);
    expect(pg.body.error.code).toBe("user_forbidden");
  });

  it("FINANCEIRO: paga, mas não cadastra cliente nem edita upsell", async () => {
    const r = await chamar(resolve.POST, "POST", "/integrations/resolve-identity", { body: { channel: "WHATSAPP", externalIdentifier: "+5571944440002" } });
    expect(r.body.data.allowedScopes).toContain("receivables.register_payment");
    expect(r.body.data.allowedScopes).not.toContain("clients.create");
    expect(r.body.data.allowedScopes).not.toContain("upsells.update");
    const cli = await chamar(clientsRoute.POST, "POST", "/clients", { identidade: idt.financeiro, key: `k-${randomUUID()}`, body: { name: "X" } });
    expect(cli.status).toBe(403);
    expect(cli.body.error.code).toBe("user_forbidden");
  });
});

describe("dono (ownerId): token de outro dono nunca alcança os dados", () => {
  it("detalhe, histórico, escrita, pagamento e ação do agente de A com o token de B = 404", async () => {
    const c = await createMrrClient(A, { name: `Isolado ${TAG}` });
    const b = await createBilling(A, c.id, { month: MES, year: ANO, amount: 300, revenueType: "ONE_TIME" });
    const p = { token: tokenB, params: { id: c.id } };
    expect((await chamar(clientRoute.GET, "GET", `/clients/${c.id}`, p)).status).toBe(404);
    expect((await chamar(clientRoute.PATCH, "PATCH", `/clients/${c.id}`, { ...p, key: `k-${randomUUID()}`, body: { city: "X" } })).status).toBe(404);
    expect((await chamar(statusChanges.POST, "POST", `/clients/${c.id}/status-changes`, {
      ...p, key: `k-${randomUUID()}`, body: { status: "INACTIVE", effectiveFrom: HOJE },
    })).status).toBe(404);
    expect((await chamar(receivable.GET, "GET", `/receivables/${b.id}`, { token: tokenB, params: { id: b.id } })).status).toBe(404);
    expect((await chamar(payments.POST, "POST", `/receivables/${b.id}/payments`, {
      token: tokenB, params: { id: b.id }, key: `k-${randomUUID()}`, body: { amount: 300 },
    })).status).toBe(404);
    // A lista de B não traz o cliente de A.
    const lista = await chamar(clientsRoute.GET, "GET", `/clients?search=${encodeURIComponent(`Isolado ${TAG}`)}`, { token: tokenB });
    expect(lista.body.data).toEqual([]);
    // Ação pendente de A: B não confirma nem com o código certo.
    const pa = await chamar(acoes.POST, "POST", "/agent/pending-actions", {
      identidade: idt.financeiro, body: { operation: "registrar_pagamento", targetId: b.id, input: { amount: 300 } },
    });
    const id = pa.body.data.actionId;
    const msg = `wamid.${randomUUID()}`;
    const conf = await chamar(confirmar.POST, "POST", `/agent/pending-actions/${id}/confirm`, {
      token: tokenB, identidade: idt.financeiro, params: { id }, key: chaveDaConfirmacao(msg, id),
      body: { messageId: msg, confirmationCode: pa.body.data.confirmationCode },
    });
    expect(conf.status).toBe(403); // o vínculo é de A: inválido para a integração de B
    expect(conf.body.error.code).toBe("invalid_identity");
    const pags = await runWithoutScope(async () => await prisma.payment.count({ where: { billingId: b.id } }));
    expect(pags).toBe(0);
  });
});

describe("idempotência por replay: despesa e upsell", () => {
  it("despesa: mesma chave = mesma despesa, uma vez; replay marcado", async () => {
    const key = `desp-${randomUUID()}`;
    const corpo = { description: `Replay ${TAG}`, amount: 99.9, dueDate: HOJE };
    const r1 = await chamar(expensesRoute.POST, "POST", "/expenses", { key, body: corpo });
    const r2 = await chamar(expensesRoute.POST, "POST", "/expenses", { key, body: corpo });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    expect(r2.body.data.id).toBe(r1.body.data.id);
    const n = await runWithoutScope(async () => await prisma.transaction.count({ where: { ownerId: A.id, description: `Replay ${TAG}` } }));
    expect(n).toBe(1);
  });

  it("upsell: mesma chave = uma oportunidade; mesma chave com outro valor = 422", async () => {
    const c = await createMrrClient(A, { name: `Upsell Replay ${TAG}` });
    const key = `up-${randomUUID()}`;
    const corpo = { clientId: c.id, description: "Gestão de tráfego", amount: 900 };
    const r1 = await chamar(upsellsRoute.POST, "POST", "/upsells", { key, body: corpo });
    const r2 = await chamar(upsellsRoute.POST, "POST", "/upsells", { key, body: corpo });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    expect(r2.body.data.id).toBe(r1.body.data.id);
    const outro = await chamar(upsellsRoute.POST, "POST", "/upsells", { key, body: { ...corpo, amount: 1000 } });
    expect(outro.status).toBe(422);
    expect(outro.body.error.code).toBe("idempotency_key_reused");
    const n = await runWithoutScope(async () => await prisma.upsell.count({ where: { clientId: c.id } }));
    expect(n).toBe(1);
  });
});

describe("trilha de auditoria: leitura sensível e as escritas", () => {
  it("leitura de detalhe (documento completo) e pagamento, status, despesa e upsell ficam registrados com ator e entidade", async () => {
    const c = await createMrrClient(A, { name: `Trilha ${TAG}` });
    const b = await createBilling(A, c.id, { month: MES, year: ANO, amount: 200, revenueType: "ONE_TIME" });
    const leitura = await chamar(clientRoute.GET, "GET", `/clients/${c.id}`, { identidade: idt.admin, params: { id: c.id } });
    const pag = await chamar(payments.POST, "POST", `/receivables/${b.id}/payments`, { identidade: idt.admin, params: { id: b.id }, key: `k-${randomUUID()}`, body: { amount: 200 } });
    const st = await chamar(statusChanges.POST, "POST", `/clients/${c.id}/status-changes`, {
      identidade: idt.admin, params: { id: c.id }, key: `k-${randomUUID()}`, body: { status: "PAUSED", effectiveFrom: HOJE },
    });
    const desp = await chamar(expensesRoute.POST, "POST", "/expenses", { identidade: idt.admin, key: `k-${randomUUID()}`, body: { description: `Trilha ${TAG}`, amount: 10, dueDate: HOJE } });
    const up = await chamar(upsellsRoute.POST, "POST", "/upsells", { identidade: idt.admin, key: `k-${randomUUID()}`, body: { clientId: c.id, description: "Site", amount: 50 } });
    for (const r of [pag, st, desp, up]) expect(r.status, JSON.stringify(r.body)).toBe(201);

    const trilha = async (requestId: string) =>
      runWithoutScope(async () => await prisma.apiActivity.findFirst({ where: { requestId } }));
    const esperado: [any, string, string, string][] = [
      [leitura, "clients.get", "READ", "Client"],
      [pag, "payments.register", "WRITE", "Billing"],
      [st, "client_status.change", "WRITE", "Client"],
      [desp, "expenses.create", "WRITE", "Transaction"],
      [up, "upsells.create", "WRITE", "Upsell"],
    ];
    for (const [r, action, kind, entityType] of esperado) {
      const a = await trilha(r.body.meta.requestId);
      expect(a, action).toMatchObject({ action, kind, entityType, result: "SUCCESS", actorUserId: u.admin, ownerId: A.id });
      expect(JSON.stringify(a!.metadata)).not.toMatch(/b2c_live_|authorization/i);
    }
    // AuditLog (campo a campo) das escritas de domínio.
    const logs = await runWithoutScope(async () =>
      await prisma.auditLog.findMany({ where: { entityId: { in: [c.id, desp.body.data.id, up.body.data.id] } }, select: { entity: true } })
    );
    expect(logs.map((l) => l.entity)).toEqual(expect.arrayContaining(["Transaction", "Upsell"]));
    const pagLog = await runWithoutScope(async () => await prisma.auditLog.count({ where: { entityId: pag.body.data.payment.id } }));
    expect(pagLog).toBeGreaterThan(0);
  });
});

describe("agente: dados para perguntar em caso de ambiguidade", () => {
  it("busca por 'Alpha' devolve os dois clientes (o agente pergunta; não escolhe)", async () => {
    await createMrrClient(A, { name: `Alpha Odontologia ${TAG}` });
    await createMrrClient(A, { name: `Alpha Estética ${TAG}` });
    const r = await chamar(search.GET, "GET", `/search?q=${encodeURIComponent(`alpha ${TAG}`)}&type=client`, { identidade: idt.admin });
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: any) => x.name).sort()).toEqual([`Alpha Estética ${TAG}`, `Alpha Odontologia ${TAG}`]);
  });
});
