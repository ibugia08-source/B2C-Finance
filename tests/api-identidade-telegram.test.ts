import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { prisma, runWithoutScope, createOwner, destroyOwner, type TestOwner } from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * TELEGRAM COMO CANAL (Fase 16 · bloco 1, 29/09/2026).
 *  · MessagingIdentity continua GENÉRICA: channel TELEGRAM ao lado de WHATSAPP;
 *  · identidade = Telegram User ID (só dígitos); o @username nunca identifica
 *    (vai só para metadata, e não resolve ninguém);
 *  · a mesma resolução/delegação/RBAC do WhatsApp, sem scope novo de canal;
 *  · ações do agente nascem com channel TELEGRAM (pronto para o bloco 2).
 */

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { criarIntegracao } from "@/lib/services/service-accounts";
import {
  vincularIdentidade, vincularWhatsApp, desvincularIdentidade, listarIdentidades,
} from "@/lib/services/messaging-identities";
import { normalizarIdentificador, mascararIdentificador, metadadosDoCanal } from "@/lib/messaging/channels";
import { API_SCOPES } from "@/lib/api/scopes";
import { todayKey } from "@/lib/competence";
import * as resolve from "@/app/api/v1/integrations/resolve-identity/route";
import * as receivables from "@/app/api/v1/receivables/route";
import * as clients from "@/app/api/v1/clients/route";
import * as acoes from "@/app/api/v1/agent/pending-actions/route";

const TAG = randomUUID().slice(0, 6);
// IDs únicos por execução (o índice único é por dono, mas evita confusão entre rodadas).
const base = String(Date.now()).slice(-8);
const tg = (n: number) => `9${base}${n}`;

let A: TestOwner;
let B: TestOwner;
let token: string;
let tokenB: string;
const u: Record<string, string> = {};

const admin = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: o.id, name: "Admin", email: o.email, role: "ADMIN", permissions: [], workspaceOwnerId: null },
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
async function chave(o: TestOwner) {
  const r = await criarIntegracao({ ownerId: o.id, principal: admin(o) }, { name: `tg-${TAG}`, scopes: API_SCOPES, expiresInDays: null });
  if (!r.ok) throw new Error(r.error);
  return r.token;
}
async function resolver(body: Record<string, unknown>, tk = token) {
  const res = await resolve.POST(
    new Request("http://localhost/api/v1/integrations/resolve-identity", {
      method: "POST",
      headers: { authorization: `Bearer ${tk}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: await res.json() };
}
async function chamar(h: (r: Request) => Promise<Response>, method: string, path: string, identidade: string, body?: unknown) {
  const res = await h(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-b2c-identity": identidade },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  u.financeiro = await membro(A, "Financeiro", "FINANCEIRO");
  u.leitura = await membro(A, "Leitura", "LEITURA");
  u.inativo = await membro(A, "Inativo", "FINANCEIRO", { active: false });
  u.deB = await membro(B, "DeB", "FINANCEIRO");
  token = await chave(A);
  tokenB = await chave(B);
});
afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.pendingAction.deleteMany({ where: { ownerId: { in: [A.id, B.id] } } });
    await prisma.messagingIdentity.deleteMany({ where: { ownerId: { in: [A.id, B.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
  });
  await destroyOwner(A);
  await destroyOwner(B);
});

describe("identificador do Telegram", () => {
  it("é o Telegram User ID (só dígitos); @username e texto não servem", () => {
    expect(normalizarIdentificador("TELEGRAM", "123456789")).toBe("123456789");
    expect(normalizarIdentificador("TELEGRAM", 123456789)).toBe("123456789");
    expect(normalizarIdentificador("TELEGRAM", " 42 ")).toBe("42");
    for (const x of ["@joao_silva", "joao_silva", "0123", "-100123456", "12a34", "", "12345678901234567"]) {
      expect(normalizarIdentificador("TELEGRAM", x), x).toBeNull();
    }
    expect(mascararIdentificador("TELEGRAM", "123456789")).toBe("12•••••89");
    // Metadados: só exibição, só campos conhecidos.
    expect(metadadosDoCanal("TELEGRAM", { username: "@Joao_Silva", firstName: "João", lastName: "" })).toEqual({ username: "Joao_Silva", firstName: "João" });
    expect(metadadosDoCanal("TELEGRAM", { username: "x" })).toBeNull();
    expect(metadadosDoCanal("WHATSAPP", { username: "joao_silva" })).toBeNull();
  });
});

describe("vínculo TELEGRAM", () => {
  it("vincula pelo ID com username em metadata; o banco recusa formato inválido", async () => {
    const r = await vincularIdentidade(ctxA(), {
      userId: u.financeiro, channel: "TELEGRAM", externalIdentifier: tg(1), metadata: { username: "@fin_b2c" },
    });
    expect(r).toMatchObject({ ok: true, externalIdentifier: tg(1) });
    const lista = await listarIdentidades(ctxA());
    const v = lista.find((x) => x.id === (r as any).id)!;
    expect(v).toMatchObject({ channel: "TELEGRAM", externalIdentifier: tg(1), metadata: { username: "fin_b2c" } });
    // Username como identificador: recusado pela regra…
    expect(await vincularIdentidade(ctxA(), { userId: u.leitura, channel: "TELEGRAM", externalIdentifier: "@fin_b2c" }))
      .toMatchObject({ ok: false, code: "INVALIDO" });
    // …e pelo banco (checagem de formato), mesmo por fora da regra.
    await expect(
      runWithoutScope(async () =>
        await prisma.messagingIdentity.create({
          data: { ownerId: A.id, userId: u.leitura, channel: "TELEGRAM", externalIdentifier: "fin_b2c", createdById: A.id },
        })
      )
    ).rejects.toThrow();
  });

  it("um Telegram ativo por usuário; o mesmo número de dígitos em WhatsApp é outro canal", async () => {
    expect(await vincularIdentidade(ctxA(), { userId: u.leitura, channel: "TELEGRAM", externalIdentifier: tg(1) }))
      .toMatchObject({ ok: false, code: "DUPLICADO" });
    expect((await vincularIdentidade(ctxA(), { userId: u.leitura, channel: "TELEGRAM", externalIdentifier: tg(2) })).ok).toBe(true);
    // WhatsApp segue funcionando pelo atalho antigo.
    expect((await vincularWhatsApp(ctxA(), { userId: u.leitura, telefone: "(71) 97777-3333" })).ok).toBe(true);
  });

  it("usuário inativo e usuário de outro workspace não são vinculados", async () => {
    expect(await vincularIdentidade(ctxA(), { userId: u.inativo, channel: "TELEGRAM", externalIdentifier: tg(3) })).toMatchObject({ ok: false, code: "INVALIDO" });
    expect(await vincularIdentidade(ctxA(), { userId: u.deB, channel: "TELEGRAM", externalIdentifier: tg(3) })).toMatchObject({ ok: false, code: "NAO_ENCONTRADO" });
  });
});

describe("POST /integrations/resolve-identity (TELEGRAM)", () => {
  it("vinculado: authorized, usuário, papel e scopes efetivos (sem scope de canal)", async () => {
    const r = await resolver({ channel: "TELEGRAM", externalIdentifier: tg(1) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ authorized: true, channel: "TELEGRAM", user: { id: u.financeiro, role: "FINANCEIRO", roleLabel: "Financeiro" } });
    expect(r.body.data.allowedScopes).toContain("receivables.read");
    expect(r.body.data.allowedScopes.some((s: string) => s.startsWith("telegram"))).toBe(false);
    // O ID pode vir como número (é assim que o Telegram manda).
    expect((await resolver({ channel: "TELEGRAM", externalIdentifier: Number(tg(1)) })).status).toBe(200);
  });

  it("username nunca resolve; não vinculado = 404; userId/ownerId no corpo = 400; outro workspace = 404", async () => {
    const porUsername = await resolver({ channel: "TELEGRAM", externalIdentifier: "@fin_b2c" });
    expect(porUsername.status).toBe(400);
    expect(porUsername.body.error.code).toBe("validation_error");
    expect((await resolver({ channel: "TELEGRAM", externalIdentifier: tg(9) })).body.error.code).toBe("identity_not_found");
    expect((await resolver({ channel: "TELEGRAM", externalIdentifier: tg(1), userId: u.financeiro })).status).toBe(400);
    expect((await resolver({ channel: "TELEGRAM", externalIdentifier: tg(1), ownerId: A.id })).status).toBe(400);
    expect((await resolver({ channel: "TELEGRAM", externalIdentifier: tg(1) }, tokenB)).status).toBe(404);
    expect((await resolver({ channel: "SMS", externalIdentifier: tg(1) })).status).toBe(400);
  });

  it("usuário inativado ou vínculo desativado deixam de resolver na hora", async () => {
    const r = await resolver({ channel: "TELEGRAM", externalIdentifier: tg(2) });
    expect(r.status).toBe(200);
    await runWithoutScope(async () => await prisma.user.update({ where: { id: u.leitura }, data: { active: false } }));
    expect((await resolver({ channel: "TELEGRAM", externalIdentifier: tg(2) })).status).toBe(404);
    await runWithoutScope(async () => await prisma.user.update({ where: { id: u.leitura }, data: { active: true } }));
    expect((await desvincularIdentidade(ctxA(), r.body.data.identityId)).ok).toBe(true);
    expect((await resolver({ channel: "TELEGRAM", externalIdentifier: tg(2) })).status).toBe(404);
  });

  it("WhatsApp continua resolvendo pelo número (compatibilidade)", async () => {
    const r = await resolver({ channel: "WHATSAPP", externalIdentifier: "+5571977773333" });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ authorized: true, channel: "WHATSAPP", user: { id: u.leitura } });
  });
});

describe("delegação e agente com identidade TELEGRAM", () => {
  it("o RBAC do usuário vale igual: FINANCEIRO lê recebimentos; LEITURA não; o ator vai para a trilha", async () => {
    const fin = (await resolver({ channel: "TELEGRAM", externalIdentifier: tg(1) })).body.data.identityId;
    const ok = await chamar(receivables.GET, "GET", "/receivables", fin);
    expect(ok.status).toBe(200);
    const atividade = await runWithoutScope(async () => await prisma.apiActivity.findFirst({ where: { requestId: ok.body.meta.requestId } }));
    expect(atividade?.actorUserId).toBe(u.financeiro);
    // LEITURA pelo WhatsApp (o vínculo do Telegram dele foi desativado acima): recebimentos negados.
    const leitura = (await resolver({ channel: "WHATSAPP", externalIdentifier: "+5571977773333" })).body.data.identityId;
    expect((await chamar(clients.GET, "GET", "/clients", leitura)).status).toBe(200);
    expect((await chamar(receivables.GET, "GET", "/receivables", leitura)).body.error.code).toBe("user_forbidden");
  });

  it("ação proposta por uma identidade TELEGRAM nasce no canal TELEGRAM (pronto para o bloco 2)", async () => {
    const fin = (await resolver({ channel: "TELEGRAM", externalIdentifier: tg(1) })).body.data.identityId;
    const r = await chamar(acoes.POST, "POST", "/agent/pending-actions", fin, {
      operation: "criar_despesa", input: { description: `Telegram ${TAG}`, amount: 10, dueDate: todayKey() },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.channel).toBe("TELEGRAM");
    const pa = await runWithoutScope(async () => await prisma.pendingAction.findUnique({ where: { id: r.body.data.actionId } }));
    expect(pa).toMatchObject({ channel: "TELEGRAM", userId: u.financeiro, status: "PENDING" });
  });
});
