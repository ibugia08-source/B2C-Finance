import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling, type TestOwner,
} from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * API — IDEMPOTÊNCIA E TRILHA DE ATIVIDADES (28/09/2026).
 *
 * As rotas públicas de escrita ainda não existem; aqui elas são montadas com
 * o MESMO `defineEndpoint` que as futuras vão usar, chamando as funções de
 * domínio REAIS (registrar pagamento, cadastrar cliente, alterar status).
 * O que se prova: a mesma conta + a mesma chave executa uma vez só; o replay
 * devolve a resposta original marcada; cada chamada deixa uma linha na
 * trilha, sem segredo; a retenção apaga só o que venceu.
 */

vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {}, revalidateFinance: () => {}, revalidateClients: () => {},
  revalidateCatalog: () => {}, revalidateClientStatus: () => {},
}));
vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { criarIntegracao, revogarIntegracao } from "@/lib/services/service-accounts";
import { defineEndpoint } from "@/lib/api/http";
import { ApiError } from "@/lib/api/auth";
import { aplicarRetencaoDaApi, higienizar } from "@/lib/api/activity";
import { hashDoPedido } from "@/lib/api/idempotency";
import { listarAtividades } from "@/lib/services/api-activities";
import { registerPayment } from "@/lib/engines/payment-engine";
import { salvarCliente } from "@/lib/services/client-service";
import { changeClientStatus } from "@/lib/clients/status-history";
import { statusCapabilities } from "@/lib/engines/domain";
import { getStartOfCompetence, todayKey } from "@/lib/competence";
import { API_SCOPES } from "@/lib/api/scopes";
import * as clientsRoute from "@/app/api/v1/clients/route";

let A: TestOwner;
let B: TestOwner;
let tokenA: string;
let tokenA2: string;
let saA: string;
let tokenB: string;

const admin = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: o.id, name: "Admin", email: o.email, role: "ADMIN", permissions: [], workspaceOwnerId: null },
});
async function chave(o: TestOwner, scopes: string[], name = "B2C Finance AI Agent") {
  const r = await criarIntegracao({ ownerId: o.id, principal: admin(o) }, { name, scopes, expiresInDays: null });
  if (!r.ok) throw new Error(r.error);
  return r;
}

type Handler = (req: Request, route?: any) => Promise<Response>;
async function post(h: Handler, token: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await h(
    new Request("http://localhost/api/v1/teste", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

// ---- Rotas de escrita de teste, com as funções de domínio reais ----

const registrarPagamento = defineEndpoint(
  {
    action: "payments.register",
    scope: "receivables.register_payment",
    write: { operation: "payments.register" },
    body: z.object({ billingId: z.string(), amount: z.number().positive() }).strict(),
  },
  async ({ ctx, body }) => {
    const r = await registerPayment(ctx, {
      billingId: body.billingId, amount: body.amount, paidAt: new Date(Date.UTC(2026, 8, 12)),
      method: "PIX", accountId: null, notes: null,
    });
    if (!r.ok) throw new ApiError(422, "unprocessable", r.error);
    const b = await prisma.billing.findFirst({ where: { id: body.billingId }, select: { client: { select: { name: true } } } });
    return {
      status: 201,
      data: { billingId: body.billingId, amount: body.amount },
      audit: { entityType: "Billing", entityId: body.billingId, label: b?.client.name, amount: body.amount },
    };
  }
);

const criarCliente = defineEndpoint(
  { action: "clients.create", scope: "clients.create", write: { operation: "clients.create" }, body: z.object({ name: z.string() }).strict() },
  async ({ ctx, body }) => {
    const r = await salvarCliente(ctx, {
      name: body.name, legalName: null, document: null, email: null, phone: null, nicheId: null,
      city: null, state: null, address: null, legalRepresentative: null, origin: null, salesOwnerId: null,
      opsOwner: null, paymentDay: 10, tags: [], status: "ACTIVE", modality: "MRR", monthlyValue: 900,
      totalContractValue: null, contractMonths: 12, contractIndefinite: false, startedAt: new Date(2026, 0, 5), notes: null,
      permitirDuplicado: true,
    });
    if (!r.ok) throw new ApiError(422, "unprocessable", r.error);
    return { status: 201, data: { id: r.id }, audit: { entityType: "Client", entityId: r.id, label: body.name } };
  }
);

const alterarStatus = defineEndpoint(
  {
    action: "client_status.change",
    scope: "client_status.write",
    write: { operation: "client_status.change" },
    body: z.object({ clientId: z.string(), status: z.enum(["INACTIVE", "ACTIVE"]) }).strict(),
  },
  async ({ ctx, body }) => {
    await changeClientStatus(
      { clientId: body.clientId, status: body.status, effectiveFrom: todayKey() },
      statusCapabilities(ctx)
    );
    return { data: { clientId: body.clientId, status: body.status }, audit: { entityType: "Client", entityId: body.clientId } };
  }
);

let execucoes = 0;
let comportamento: "ok" | "lento" | "falha" | "regra" = "ok";
const contador = defineEndpoint(
  { action: "expenses.create", scope: "expenses.create", write: { operation: "expenses.create" }, body: z.object({ n: z.number() }).strict() },
  async ({ body }) => {
    execucoes += 1;
    if (comportamento === "lento") await new Promise((r) => setTimeout(r, 150));
    if (comportamento === "falha") throw new Error("banco caiu — detalhe interno com token b2c_live_abcdefgh_" + "x".repeat(43));
    if (comportamento === "regra") throw new ApiError(422, "unprocessable", "Competência fechada.");
    return { status: 201, data: { n: body.n, execucao: execucoes } };
  }
);

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  const k = await chave(A, API_SCOPES);
  tokenA = k.token;
  saA = k.id;
  tokenA2 = (await chave(A, API_SCOPES, "Outra integração")).token;
  tokenB = (await chave(B, API_SCOPES)).token;
});
afterAll(async () => {
  await destroyOwner(A);
  await destroyOwner(B);
});

const pagamentosDa = (billingId: string) =>
  runWithoutScope(async () => await prisma.payment.count({ where: { billingId } }));

describe("Idempotency-Key", () => {
  it("registrar pagamento: a repetição NÃO cria outro pagamento e devolve a resposta original", async () => {
    const c = await createMrrClient(A, { name: "Face Love" });
    const b = await createBilling(A, c.id, { month: 9, year: 2026, amount: 1500 });
    const key = `wa_message_${randomUUID()}`;
    const um = await post(registrarPagamento, tokenA, { billingId: b.id, amount: 1500 }, { "idempotency-key": key, "x-b2c-source": "whatsapp" });
    expect(um.status).toBe(201);
    expect(um.body.meta.idempotency).toEqual({ key, replayed: false });
    expect(um.headers.get("idempotent-replayed")).toBe("false");

    const dois = await post(registrarPagamento, tokenA, { billingId: b.id, amount: 1500 }, { "idempotency-key": key, "x-b2c-source": "whatsapp" });
    expect(dois.status).toBe(201);
    expect(dois.headers.get("idempotent-replayed")).toBe("true");
    expect(dois.body.data).toEqual(um.body.data);
    expect(dois.body.meta.idempotency).toMatchObject({ key, replayed: true, originalRequestId: um.body.meta.requestId });
    expect(dois.body.meta.requestId).not.toBe(um.body.meta.requestId);
    expect(await pagamentosDa(b.id)).toBe(1);
  });

  it("criar cliente e alterar status: executam uma vez só", async () => {
    const key = `n8n-${randomUUID()}`;
    const nome = `Cliente idem ${randomUUID().slice(0, 6)}`;
    const r1 = await post(criarCliente, tokenA, { name: nome }, { "idempotency-key": key });
    const r2 = await post(criarCliente, tokenA, { name: nome }, { "idempotency-key": key });
    expect(r1.status).toBe(201);
    expect(r2.body.data.id).toBe(r1.body.data.id);
    const n = await runWithoutScope(async () => await prisma.client.count({ where: { ownerId: A.id, name: nome } }));
    expect(n).toBe(1);

    const c = await createMrrClient(A, { name: "Vai sair", startedAt: new Date(2025, 0, 1) });
    const k2 = `st-${randomUUID()}`;
    const s1 = await post(alterarStatus, tokenA, { clientId: c.id, status: "INACTIVE" }, { "idempotency-key": k2 });
    expect(s1.status, JSON.stringify(s1.body)).toBe(200);
    const s2 = await post(alterarStatus, tokenA, { clientId: c.id, status: "INACTIVE" }, { "idempotency-key": k2 });
    expect(s2.headers.get("idempotent-replayed")).toBe("true");
    const hist = await runWithoutScope(async () => await prisma.clientStatusHistory.count({ where: { clientId: c.id, status: "INACTIVE" } }));
    expect(hist).toBe(1);
  });

  it("escrita sem Idempotency-Key = 400; chave inválida = 400; nada executa", async () => {
    execucoes = 0;
    const sem = await post(contador, tokenA, { n: 1 });
    expect(sem.status).toBe(400);
    expect(sem.body.error.code).toBe("idempotency_key_required");
    const ruim = await post(contador, tokenA, { n: 1 }, { "idempotency-key": "tem espaço" });
    expect(ruim.status).toBe(400);
    expect(execucoes).toBe(0);
  });

  it("mesma chave com outro corpo = 422 idempotency_key_reused, sem executar", async () => {
    comportamento = "ok";
    execucoes = 0;
    const key = `k-${randomUUID()}`;
    expect((await post(contador, tokenA, { n: 1 }, { "idempotency-key": key })).status).toBe(201);
    const outro = await post(contador, tokenA, { n: 2 }, { "idempotency-key": key });
    expect(outro.status).toBe(422);
    expect(outro.body.error.code).toBe("idempotency_key_reused");
    expect(execucoes).toBe(1);
  });

  it("a chave é da CONTA: outra integração (ou outro dono) com a mesma chave executa", async () => {
    comportamento = "ok";
    execucoes = 0;
    const key = `k-${randomUUID()}`;
    await post(contador, tokenA, { n: 1 }, { "idempotency-key": key });
    await post(contador, tokenA2, { n: 1 }, { "idempotency-key": key });
    await post(contador, tokenB, { n: 1 }, { "idempotency-key": key });
    expect(execucoes).toBe(3);
  });

  it("concorrência: duas chamadas simultâneas com a mesma chave executam UMA vez", async () => {
    comportamento = "lento";
    execucoes = 0;
    const key = `k-${randomUUID()}`;
    const [x, y] = await Promise.all([
      post(contador, tokenA, { n: 7 }, { "idempotency-key": key }),
      post(contador, tokenA, { n: 7 }, { "idempotency-key": key }),
    ]);
    expect(execucoes).toBe(1);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const perdeu = x.status === 409 ? x : y;
    expect(perdeu.body.error.code).toBe("idempotency_in_progress");
    comportamento = "ok";
    const depois = await post(contador, tokenA, { n: 7 }, { "idempotency-key": key });
    expect(depois.headers.get("idempotent-replayed")).toBe("true");
    expect(execucoes).toBe(1);
  });

  it("erro de servidor LIBERA a chave (a nova tentativa executa); recusa de regra (422) é guardada", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    comportamento = "falha";
    execucoes = 0;
    const key = `k-${randomUUID()}`;
    const falhou = await post(contador, tokenA, { n: 3 }, { "idempotency-key": key });
    expect(falhou.status).toBe(500);
    comportamento = "ok";
    const denovo = await post(contador, tokenA, { n: 3 }, { "idempotency-key": key });
    expect(denovo.status).toBe(201);
    expect(denovo.headers.get("idempotent-replayed")).toBe("false");
    expect(execucoes).toBe(2);

    comportamento = "regra";
    const k2 = `k-${randomUUID()}`;
    const r1 = await post(contador, tokenA, { n: 4 }, { "idempotency-key": k2 });
    comportamento = "ok";
    const r2 = await post(contador, tokenA, { n: 4 }, { "idempotency-key": k2 });
    expect(r1.status).toBe(422);
    expect(r2.status).toBe(422);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    spy.mockRestore();
  });

  it("chave vencida vale como nova; o hash ignora a ordem das chaves do JSON", async () => {
    comportamento = "ok";
    execucoes = 0;
    const key = `k-${randomUUID()}`;
    await post(contador, tokenA, { n: 5 }, { "idempotency-key": key });
    await runWithoutScope(async () =>
      await prisma.apiIdempotencyKey.updateMany({ where: { key }, data: { expiresAt: new Date(Date.now() - 1000) } })
    );
    const nova = await post(contador, tokenA, { n: 5 }, { "idempotency-key": key });
    expect(nova.headers.get("idempotent-replayed")).toBe("false");
    expect(execucoes).toBe(2);
    expect(hashDoPedido({ a: 1, b: { c: 2, d: 3 } })).toBe(hashDoPedido({ b: { d: 3, c: 2 }, a: 1 }));
  });
});

describe("trilha de atividades", () => {
  const atividades = (requestId: string) =>
    runWithoutScope(async () => await prisma.apiActivity.findMany({ where: { requestId } }));

  it("escrita registra dono, conta, origem, ação, entidade, requestId e resultado — sem segredo", async () => {
    const c = await createMrrClient(A, { name: "Face Love Trilha" });
    const b = await createBilling(A, c.id, { month: 9, year: 2026, amount: 1500 });
    const key = `wa_message_${randomUUID()}`;
    const r = await post(registrarPagamento, tokenA, { billingId: b.id, amount: 1500 }, {
      "idempotency-key": key, "x-b2c-source": "whatsapp", "x-correlation-id": "exec-99",
    });
    const [a] = await atividades(r.body.meta.requestId);
    expect(a).toMatchObject({
      ownerId: A.id, serviceAccountId: saA, source: "WHATSAPP", kind: "WRITE", action: "payments.register",
      entityType: "Billing", entityId: b.id, result: "SUCCESS", httpStatus: 201, correlationId: "exec-99",
    });
    expect(a.metadata).toMatchObject({ label: "Face Love Trilha", amount: 1500, idempotencyKey: key });
    const txt = JSON.stringify(a);
    expect(txt).not.toContain(tokenA);
    expect(txt).not.toMatch(/authorization/i);

    const replay = await post(registrarPagamento, tokenA, { billingId: b.id, amount: 1500 }, { "idempotency-key": key });
    const [ra] = await atividades(replay.body.meta.requestId);
    expect(ra.result).toBe("REPLAYED");
  });

  it("leitura, scope negado e token revogado entram na trilha; origem padrão = API", async () => {
    const req = (token: string) =>
      new Request("http://localhost/api/v1/clients", { headers: { authorization: `Bearer ${token}` } });
    const ok = await (await clientsRoute.GET(req(tokenA))).json();
    expect((await atividades(ok.meta.requestId))[0]).toMatchObject({ kind: "READ", action: "clients.list", result: "SUCCESS", source: "API" });

    const semScope = await chave(A, ["dashboard.read"], "Sem clientes");
    const negado = await (await clientsRoute.GET(req(semScope.token))).json();
    expect((await atividades(negado.meta.requestId))[0]).toMatchObject({ result: "DENIED", httpStatus: 403, errorCode: "insufficient_scope" });

    await revogarIntegracao({ ownerId: A.id, principal: admin(A) }, semScope.id);
    const revogado = await (await clientsRoute.GET(req(semScope.token))).json();
    expect((await atividades(revogado.meta.requestId))[0]).toMatchObject({ result: "DENIED", errorCode: "revoked_token", serviceAccountId: semScope.id });
  });

  it("erro interno: a trilha guarda o código, nunca a mensagem interna nem token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    comportamento = "falha";
    const r = await post(contador, tokenA, { n: 9 }, { "idempotency-key": `k-${randomUUID()}` });
    comportamento = "ok";
    spy.mockRestore();
    const [a] = await atividades(r.body.meta.requestId);
    expect(a).toMatchObject({ result: "ERROR", httpStatus: 500, errorCode: "internal_error" });
    expect(JSON.stringify(a)).not.toMatch(/banco caiu|b2c_live_/);
  });

  it("higienizar remove chaves sensíveis e tokens no texto", () => {
    expect(
      higienizar({ ok: 1, token: "x", Authorization: "Bearer y", nested: { apiKey: "z", nota: "b2c_live_abcdefgh_" + "k".repeat(43) } })
    ).toEqual({ ok: 1, nested: { nota: "[token removido]" } });
  });

  it("a tela lista só o dono, com integração e rótulos; sem permissão, nada", async () => {
    const r = await listarAtividades({ ownerId: A.id, principal: admin(A) }, { page: 1, pageSize: 200, kind: "WRITE", source: "WHATSAPP" });
    expect(r.linhas.length).toBeGreaterThan(0);
    expect(r.linhas.every((l) => l.source === "WHATSAPP" && l.kind === "WRITE")).toBe(true);
    expect(r.linhas.some((l) => l.integracao === "B2C Finance AI Agent" && l.amount === 1500)).toBe(true);
    const deB = await listarAtividades({ ownerId: B.id, principal: admin(B) }, { page: 1, pageSize: 200 });
    expect(deB.linhas.every((l) => l.serviceAccountId !== saA)).toBe(true);
    const leitura: Principal = { kind: "user", origin: "UI", user: { id: "x", name: "L", email: "l@b2c.local", role: "LEITURA", permissions: [], workspaceOwnerId: null } };
    expect((await listarAtividades({ ownerId: A.id, principal: leitura }, { page: 1, pageSize: 10 })).linhas).toEqual([]);
  });

  it("retenção: consultas > 30 dias, ações > 400 dias e chaves vencidas saem; o resto fica", async () => {
    const agora = new Date();
    const dias = (n: number) => new Date(agora.getTime() - n * 86_400_000);
    const base = { ownerId: A.id, source: "API" as const, action: "t", requestId: `ret-${randomUUID()}`, result: "SUCCESS" as const, httpStatus: 200 };
    const ids = await runWithoutScope(async () => ({
      leituraVelha: (await prisma.apiActivity.create({ data: { ...base, kind: "READ", createdAt: dias(31) } })).id,
      leituraNova: (await prisma.apiActivity.create({ data: { ...base, kind: "READ", createdAt: dias(29) } })).id,
      escritaVelha: (await prisma.apiActivity.create({ data: { ...base, kind: "WRITE", createdAt: dias(401) } })).id,
      escritaNova: (await prisma.apiActivity.create({ data: { ...base, kind: "WRITE", createdAt: dias(300) } })).id,
    }));
    const r = await aplicarRetencaoDaApi(agora);
    expect(r.leituras).toBeGreaterThanOrEqual(1);
    const restantes = await runWithoutScope(async () =>
      (await prisma.apiActivity.findMany({ where: { id: { in: Object.values(ids) } }, select: { id: true } })).map((x) => x.id)
    );
    expect(restantes.sort()).toEqual([ids.leituraNova, ids.escritaNova].sort());
  });
});
