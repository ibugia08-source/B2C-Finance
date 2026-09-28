import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  prisma, runWithoutScope, asOwner, createOwner, destroyOwner, createMrrClient, createBilling, defaultAgency, type TestOwner,
} from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * TELEGRAM · BLOCO 2 — escrita com confirmação por BOTÃO, na API.
 *  · a ação proposta pelo vínculo Telegram nasce no canal TELEGRAM, sem
 *    código na resposta (a confirmação é o toque em Confirmar);
 *  · GET /agent/pending-actions/:id só mostra a ação ao usuário DELA;
 *  · confirmar por botão: Idempotency-Key telegram:<update_id>:<id>; o mesmo
 *    update repetido é replay; outro toque é 409 — nunca duplica;
 *  · cancelar = CANCELLED sem escrita; vencida = EXPIRED (410);
 *  · botão não vale para ação do WhatsApp; operações bloqueadas nem viram ação;
 *  · status com vigência preserva o mês atual; trilha com origem TELEGRAM;
 *  · destinatários de relatório/aviso: só com a preferência ligada.
 */

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { criarIntegracao } from "@/lib/services/service-accounts";
import { atualizarPreferencias, vincularIdentidade } from "@/lib/services/messaging-identities";
import { API_SCOPES } from "@/lib/api/scopes";
import { chaveDaConfirmacao } from "@/lib/api/agent/catalog";
import { addMonths, getStartOfCompetence, todayKey } from "@/lib/competence";
import * as resolve from "@/app/api/v1/integrations/resolve-identity/route";
import * as destinatarios from "@/app/api/v1/integrations/recipients/route";
import * as acoes from "@/app/api/v1/agent/pending-actions/route";
import * as umaAcao from "@/app/api/v1/agent/pending-actions/[id]/route";
import * as confirmar from "@/app/api/v1/agent/pending-actions/[id]/confirm/route";
import * as cancelar from "@/app/api/v1/agent/pending-actions/[id]/cancel/route";
import * as caixa from "@/app/api/v1/cash/summary/route";
import * as rotina from "@/app/api/v1/routine/daily/route";
import * as clienteRoute from "@/app/api/v1/clients/[id]/route";

const TAG = randomUUID().slice(0, 6);
const HOJE = todayKey();
const COMP = HOJE.slice(0, 7);
const [ANO, MES] = COMP.split("-").map(Number);
const tgId = () => String(700000000 + Math.floor(Math.random() * 99_999_999));

let A: TestOwner;
let B: TestOwner;
let token: string;
let tokenSemIdentidade: string;
const u: Record<string, string> = {};
const idt: Record<string, string> = {};
const tg: Record<string, string> = {};

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

type Resp = { status: number; body: any };
async function chamar(
  h: (req: Request, r?: any) => Promise<Response>, method: string, path: string,
  o: { identidade?: string | null; body?: unknown; key?: string; msg?: string; params?: Record<string, string>; token?: string } = {}
): Promise<Resp> {
  const headers: Record<string, string> = { authorization: `Bearer ${o.token ?? token}`, "content-type": "application/json", "x-b2c-source": "telegram" };
  if (o.identidade) headers["x-b2c-identity"] = o.identidade;
  if (o.key) headers["idempotency-key"] = o.key;
  if (o.msg) headers["x-b2c-message-id"] = o.msg;
  const res = await h(
    new Request(`http://localhost/api/v1${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }),
    o.params ? { params: o.params } : undefined
  );
  return { status: res.status, body: await res.json() };
}

const propor = (identidade: string, body: unknown, msg = `tg:${tgId()}:${Math.floor(Math.random() * 1e6)}`) =>
  chamar(acoes.POST, "POST", "/agent/pending-actions", { identidade, body, msg });
const ver = (identidade: string, id: string) => chamar(umaAcao.GET, "GET", `/agent/pending-actions/${id}`, { identidade, params: { id } });
/** Toque em Confirmar: update_id novo a cada toque (como o Telegram faz). */
const tocarConfirmar = (identidade: string, id: string, updateId = String(Math.floor(Math.random() * 1e9)), key?: string) =>
  chamar(confirmar.POST, "POST", `/agent/pending-actions/${id}/confirm`, {
    identidade, params: { id }, body: { messageId: updateId, via: "button" }, key: key ?? chaveDaConfirmacao(updateId, id, "TELEGRAM"),
  });
const tocarCancelar = (identidade: string, id: string, updateId = String(Math.floor(Math.random() * 1e9))) =>
  chamar(cancelar.POST, "POST", `/agent/pending-actions/${id}/cancel`, { identidade, params: { id }, body: { messageId: updateId } });

const acao = (id: string) => runWithoutScope(async () => (await prisma.pendingAction.findUnique({ where: { id } }))!);
const pagamentosDa = (billingId: string) => runWithoutScope(async () => await prisma.payment.findMany({ where: { billingId } }));

async function resolverTelegram(id: string) {
  return chamar(resolve.POST, "POST", "/integrations/resolve-identity", { body: { channel: "TELEGRAM", externalIdentifier: id } });
}

async function cobrancaAberta(nome: string, valor = 1500) {
  const c = await createMrrClient(A, { name: `${nome} ${TAG}`, monthlyValue: valor });
  const b = await createBilling(A, c.id, { month: MES, year: ANO, amount: valor, revenueType: "ONE_TIME", description: `Avulso ${randomUUID()}` });
  return { clientId: c.id, billingId: b.id };
}

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  u.admin = await membro(A, "Israel", "ADMIN");
  u.financeiro = await membro(A, "Financeiro", "FINANCEIRO");
  u.leitura = await membro(A, "Leitura", "LEITURA");
  u.agencia = await membro(A, "Agencia", "FINANCEIRO", { dataScope: "AGENCY", scopeAgencyId: (await defaultAgency()).id });
  u.deB = await membro(B, "DeB", "ADMIN");
  const r = await criarIntegracao({ ownerId: A.id, principal: admin(A) }, { name: `tg-${TAG}`, scopes: API_SCOPES, expiresInDays: null });
  if (!r.ok) throw new Error(r.error);
  token = r.token;
  const r2 = await criarIntegracao({ ownerId: A.id, principal: admin(A) }, { name: `tg-leitura-${TAG}`, scopes: ["reports.read"], expiresInDays: null });
  if (!r2.ok) throw new Error(r2.error);
  tokenSemIdentidade = r2.token;
  for (const k of ["admin", "financeiro", "leitura", "agencia"]) {
    tg[k] = tgId();
    const v = await vincularIdentidade(ctxA(), { userId: u[k], channel: "TELEGRAM", externalIdentifier: tg[k] });
    if (!v.ok) throw new Error(v.error);
    if (k !== "agencia") idt[k] = (await resolverTelegram(tg[k])).body.data.identityId;
    else idt[k] = v.id;
  }
  // Um vínculo WhatsApp do mesmo admin: botão não vale para ação dele.
  const wa = await vincularIdentidade(ctxA(), { userId: u.admin, channel: "WHATSAPP", externalIdentifier: `5571${Math.floor(10000000 + Math.random() * 89999999)}` });
  if (!wa.ok) throw new Error(wa.error);
  idt.adminWa = wa.id;
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
    await prisma.userPermission.deleteMany({ where: { userId: { in: Object.values(u) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
  });
  await destroyOwner(A);
  await destroyOwner(B);
});

// ---------------------------------------------------------------------------

describe("Cenário A — pagamento confirmado pelo botão", () => {
  it("prévia no canal TELEGRAM, sem código; nada gravado antes do toque", async () => {
    const { billingId } = await cobrancaAberta("Face Love Distribuidora");
    const p = await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body.data).toMatchObject({ channel: "TELEGRAM", status: "PENDING", operation: "payments.register" });
    expect(p.body.data).not.toHaveProperty("confirmationCode");
    expect(p.body.data.message).toContain("Toque em *Confirmar* ou *Cancelar*");
    expect(p.body.data.message).not.toMatch(/SIM \d{4}/);
    expect(p.body.data.preview).toContain("Recebimento em aberto: R$ 1.500,00");
    expect(await pagamentosDa(billingId)).toHaveLength(0);
  });

  it("confirma UMA vez: replay do mesmo update não duplica; novo toque = 'já processada'", async () => {
    const { billingId } = await cobrancaAberta("Face Love Tocar");
    const p = await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } });
    const id = p.body.data.actionId;

    const upd = "815000123";
    const r1 = await tocarConfirmar(idt.financeiro, id, upd);
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.data).toMatchObject({ status: "EXECUTED", replayed: false });
    expect(r1.body.data.message).toContain("Pagamento registrado");
    expect(await pagamentosDa(billingId)).toHaveLength(1);
    expect((await acao(id)).idempotencyKey).toBe(`telegram:${upd}:${id}`);

    // O Telegram reenviou o MESMO update: mesmo resultado, nada novo.
    const r2 = await tocarConfirmar(idt.financeiro, id, upd);
    expect(r2.status).toBe(200);
    expect(r2.body.data).toMatchObject({ status: "EXECUTED", replayed: true });

    // O usuário tocou de novo (outro update): recusado, não executa.
    const r3 = await tocarConfirmar(idt.financeiro, id);
    expect(r3.status).toBe(409);
    expect(r3.body.error.code).toBe("action_not_pending");
    expect((await ver(idt.financeiro, id)).body.data.status).toBe("EXECUTED");
    expect(await pagamentosDa(billingId)).toHaveLength(1);
  });

  it("trilha: proposta, confirmação e o pagamento com origem TELEGRAM e o usuário como ator", async () => {
    const { billingId } = await cobrancaAberta("Face Love Trilha");
    const p = await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } });
    const r = await tocarConfirmar(idt.financeiro, p.body.data.actionId);
    expect(r.body.data.status).toBe("EXECUTED");
    const trilha = await runWithoutScope(async () =>
      await prisma.apiActivity.findMany({ where: { ownerId: A.id, correlationId: `pa:${p.body.data.actionId}` } })
    );
    expect(trilha.length).toBeGreaterThan(0);
    for (const t of trilha) expect(t).toMatchObject({ source: "TELEGRAM", actorUserId: u.financeiro, result: "SUCCESS" });
    const conf = await runWithoutScope(async () =>
      await prisma.apiActivity.findFirst({ where: { ownerId: A.id, action: "agent_actions.confirm", entityId: p.body.data.actionId } })
    );
    expect(conf).toMatchObject({ source: "TELEGRAM", actorUserId: u.financeiro });
    expect(JSON.stringify(conf!.metadata)).not.toMatch(/Bearer|token/i);
  });
});

describe("Cenário B e estados", () => {
  it("cancelar = CANCELLED, nada escrito; tocar Confirmar depois não executa", async () => {
    const { billingId } = await cobrancaAberta("Cancelar");
    const p = await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } });
    const c = await tocarCancelar(idt.financeiro, p.body.data.actionId);
    expect(c.status).toBe(200);
    expect(c.body.data.status).toBe("CANCELLED");
    const depois = await tocarConfirmar(idt.financeiro, p.body.data.actionId);
    expect(depois.status).toBe(409);
    expect(await pagamentosDa(billingId)).toHaveLength(0);
  });

  it("vencida: GET mostra EXPIRED e o botão devolve 410, sem executar", async () => {
    const { billingId } = await cobrancaAberta("Vencida");
    const p = await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } });
    await runWithoutScope(async () =>
      await prisma.pendingAction.update({ where: { id: p.body.data.actionId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    );
    expect((await ver(idt.financeiro, p.body.data.actionId)).body.data.status).toBe("EXPIRED");
    const r = await tocarConfirmar(idt.financeiro, p.body.data.actionId);
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe("action_expired");
    expect(await pagamentosDa(billingId)).toHaveLength(0);
  });

  it("botão de outro usuário (ou de outro workspace) não enxerga a ação", async () => {
    const { billingId } = await cobrancaAberta("Outro usuario");
    const p = await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } });
    expect((await ver(idt.admin, p.body.data.actionId)).status).toBe(404);
    expect((await tocarConfirmar(idt.admin, p.body.data.actionId)).status).toBe(404);
    expect((await tocarCancelar(idt.admin, p.body.data.actionId)).status).toBe(404);
    expect((await acao(p.body.data.actionId)).status).toBe("PENDING");
    expect(await pagamentosDa(billingId)).toHaveLength(0);
  });

  it("callback inválido: chave de outro canal, botão em ação do WhatsApp, código em botão", async () => {
    const { billingId } = await cobrancaAberta("Invalido");
    const p = await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } });
    const id = p.body.data.actionId;
    const upd = "900";
    const chaveWa = await tocarConfirmar(idt.financeiro, id, upd, chaveDaConfirmacao(upd, id, "WHATSAPP"));
    expect(chaveWa.status).toBe(400);
    const semChave = await chamar(confirmar.POST, "POST", `/agent/pending-actions/${id}/confirm`, {
      identidade: idt.financeiro, params: { id }, body: { messageId: upd, via: "button" },
    });
    expect(semChave.body.error.code).toBe("idempotency_key_required");
    const comCodigo = await chamar(confirmar.POST, "POST", `/agent/pending-actions/${id}/confirm`, {
      identidade: idt.financeiro, params: { id }, body: { messageId: upd, via: "button", confirmationCode: "1234" }, key: chaveDaConfirmacao(upd, id, "TELEGRAM"),
    });
    expect(comCodigo.status).toBe(400);
    expect((await acao(id)).status).toBe("PENDING");

    // Ação nascida no WhatsApp: confirmação por botão é recusada.
    const { billingId: b2 } = await cobrancaAberta("Via WhatsApp");
    const pw = await propor(idt.adminWa, { operation: "registrar_pagamento", targetId: b2, input: { amount: 1500 } });
    expect(pw.body.data.channel).toBe("WHATSAPP");
    const r = await chamar(confirmar.POST, "POST", `/agent/pending-actions/${pw.body.data.actionId}/confirm`, {
      identidade: idt.adminWa, params: { id: pw.body.data.actionId }, body: { messageId: "wamid.X", via: "button" },
      key: chaveDaConfirmacao("wamid.X", pw.body.data.actionId, "WHATSAPP"),
    });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain("só vale para ações do Telegram");
    expect(await pagamentosDa(b2)).toHaveLength(0);
  });
});

describe("Cenários C–E — status futuro, bloqueio, upsell, cadastro, despesa, rotina", () => {
  const executar = async (identidade: string, body: unknown) => {
    const p = await propor(identidade, body);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const r = await tocarConfirmar(identidade, p.body.data.actionId);
    expect(r.body.data?.status, JSON.stringify(r.body)).toBe("EXECUTED");
    return { preview: p.body.data.preview as string, acao: await acao(p.body.data.actionId) };
  };

  it("C: inativa a partir do mês que vem — programado; o mês atual continua Ativo", async () => {
    const c = await createMrrClient(A, { name: `Otica Alpha ${TAG}`, startedAt: new Date(2025, 0, 1) });
    const prox = getStartOfCompetence(addMonths(COMP, 1));
    const st = await executar(idt.admin, { operation: "alterar_status_cliente", targetId: c.id, input: { status: "INACTIVE", effectiveFrom: prox } });
    expect(st.preview).toContain("Novo status: Inativo");
    const agora = await chamar(clienteRoute.GET, "GET", `/clients/${c.id}?competence=${COMP}`, { identidade: idt.admin, params: { id: c.id } });
    expect(agora.status, JSON.stringify(agora.body)).toBe(200);
    expect(JSON.stringify(agora.body.data)).toContain("ACTIVE");
    const hist = await runWithoutScope(async () => await prisma.clientStatusHistory.findMany({ where: { clientId: c.id }, orderBy: { effectiveFrom: "asc" } }));
    expect(hist.map((h) => h.status)).toEqual(["ACTIVE", "INACTIVE"]);
    expect(hist[1].effectiveFrom.toISOString().slice(0, 10)).toBe(prox);
    expect((await runWithoutScope(async () => await prisma.client.findUnique({ where: { id: c.id } })))!.status).toBe("ACTIVE");
  });

  it("D: excluir é BLOCKED — nem vira ação pendente", async () => {
    const c = await createMrrClient(A, { name: `Alpha Excluir ${TAG}` });
    const antes = await runWithoutScope(async () => await prisma.pendingAction.count({ where: { ownerId: A.id } }));
    for (const op of ["clients.delete", "payments.delete", "competences.reopen"]) {
      const r = await propor(idt.admin, { operation: op, targetId: c.id, input: {} });
      expect(r.status, op).toBe(403);
      expect(r.body.error.code).toBe("operation_blocked");
    }
    expect(await runWithoutScope(async () => await prisma.pendingAction.count({ where: { ownerId: A.id } }))).toBe(antes);
    expect(await runWithoutScope(async () => await prisma.client.findUnique({ where: { id: c.id } }))).not.toBeNull();
  });

  it("E: upsell de Google Ads R$ 800 — criação única mesmo com o botão tocado duas vezes", async () => {
    const c = await createMrrClient(A, { name: `Cliente X ${TAG}` });
    const p = await propor(idt.admin, { operation: "criar_upsell", input: { clientId: c.id, description: "Google Ads", amount: 800 } });
    expect(p.body.data.preview).toContain("Oportunidade: Google Ads");
    expect(p.body.data.preview).toContain("Valor: R$ 800,00");
    const upd = "7001";
    expect((await tocarConfirmar(idt.admin, p.body.data.actionId, upd)).body.data.status).toBe("EXECUTED");
    await tocarConfirmar(idt.admin, p.body.data.actionId, upd);
    await tocarConfirmar(idt.admin, p.body.data.actionId);
    expect(await runWithoutScope(async () => await prisma.upsell.count({ where: { clientId: c.id } }))).toBe(1);
  });

  it("cadastro de cliente e despesa pelo botão (uma vez cada)", async () => {
    const nome = `Empresa XYZ ${TAG}`;
    // Faltou dado essencial (MRR sem dia de pagamento): recusado JÁ na prévia, com o motivo — o agente pergunta.
    const falta = await propor(idt.admin, { operation: "cadastrar_cliente", input: { name: nome, modality: "MRR", monthlyValue: 1500 } });
    expect(falta.status).toBe(400);
    expect(falta.body.error.code).toBe("validation_error");
    expect(falta.body.error.message).toMatch(/^Falta dado para cadastrar: .+/);
    expect(falta.body.error.message).toContain("dia recorrente de pagamento");
    expect(falta.body.error.details[0].field).toBe("input.paymentDay");
    const cad = await executar(idt.admin, { operation: "cadastrar_cliente", input: { name: nome, modality: "MRR", monthlyValue: 1500, paymentDay: 10 } });
    expect(cad.preview).toContain("Valor mensal: R$ 1.500,00");
    expect(await runWithoutScope(async () => await prisma.client.count({ where: { ownerId: A.id, name: nome } }))).toBe(1);
    const desc = `Canva ${TAG}`;
    const d = await executar(idt.financeiro, { operation: "criar_despesa", input: { description: desc, amount: 350, dueDate: HOJE, type: "TOOL" } });
    expect(d.preview).toContain("Valor: R$ 350,00");
    expect(await runWithoutScope(async () => await prisma.transaction.count({ where: { ownerId: A.id, description: desc } }))).toBe(1);
  });

  it("ação da rotina de hoje concluída pelo botão", async () => {
    await asOwner(A, async () =>
      await prisma.transaction.create({
        data: { type: "despesa", description: `Vencida ${TAG}`, amount: 50, date: new Date("2026-01-05T12:00:00Z"), dueDate: new Date("2026-01-05T00:00:00Z"), status: "pendente", belongsTo: "empresa" },
      })
    );
    const r = await chamar(rotina.GET, "GET", "/routine/daily", { identidade: idt.admin });
    const item = r.body.data.actions.find((a: any) => a.key === "despesas-vencidas");
    expect(item, JSON.stringify(r.body.data.actions?.map((a: any) => a.key))).toBeTruthy();
    await executar(idt.admin, { operation: "concluir_acao_rotina", targetId: "despesas-vencidas", input: {} });
    const depois = await chamar(rotina.GET, "GET", "/routine/daily", { identidade: idt.admin });
    expect(depois.body.data.actions.find((a: any) => a.key === "despesas-vencidas").done).toBe(true);
  });
});

describe("Cenário F — permissão", () => {
  it("resposta delegada diz em nome de quem respondeu (meta.onBehalfOf); sem delegação, não", async () => {
    const com = await chamar(rotina.GET, "GET", "/routine/daily", { identidade: idt.admin });
    expect(com.body.meta.onBehalfOf).toEqual({ identityId: idt.admin });
    const sem = await chamar(rotina.GET, "GET", "/routine/daily");
    expect(sem.body.meta).not.toHaveProperty("onBehalfOf");
  });

  it("usuário sem cash.read: a API não libera o caixa (nem a ferramenta, nem a rota)", async () => {
    const r = await resolverTelegram(tg.leitura);
    expect(r.body.data.allowedScopes).not.toContain("cash.read");
    const c = await chamar(caixa.GET, "GET", "/cash/summary", { identidade: idt.leitura });
    expect(c.status).toBe(403);
    expect(["user_forbidden", "insufficient_scope"]).toContain(c.body.error.code);
  });
});

describe("destinatários de relatórios e avisos (preferência explícita)", () => {
  const listar = (purpose: string, o: { token?: string } = {}) =>
    chamar(destinatarios.GET, "GET", `/integrations/recipients?channel=TELEGRAM&purpose=${purpose}`, { token: o.token });

  it("padrão: ninguém recebe — só estar vinculado não basta", async () => {
    const r = await listar("morning_report");
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ channel: "TELEGRAM", purpose: "morning_report", timezone: "America/Bahia", today: HOJE, recipients: [] });
  });

  it("liga a manhã para o admin: só ele aparece, com o vínculo e o chat; agência e desvinculado ficam de fora", async () => {
    for (const k of ["admin", "agencia"]) {
      const p = await atualizarPreferencias(ctxA(), idt[k], { receiveMorningReport: true, receiveEveningReport: false, notificationEvents: ["receivable.overdue"] });
      expect(p.ok).toBe(true);
    }
    const r = await listar("morning_report");
    expect(r.body.data.recipients).toEqual([{ identityId: idt.admin, externalIdentifier: tg.admin, userName: `Israel ${TAG}` }]);
    expect((await listar("evening_report")).body.data.recipients).toEqual([]);
    expect((await listar("receivable.overdue")).body.data.recipients.map((x: any) => x.identityId)).toEqual([idt.admin]);
    expect((await listar("payment.received")).body.data.recipients).toEqual([]);
    const auditado = await runWithoutScope(async () =>
      await prisma.auditLog.findFirst({ where: { entity: "MessagingIdentity", entityId: idt.admin }, orderBy: { createdAt: "desc" } })
    );
    expect(auditado).not.toBeNull();
  });

  it("marcado mas sem permissão de ver relatórios (perfil Leitura): não entra na lista", async () => {
    const p = await atualizarPreferencias(ctxA(), idt.leitura, { receiveMorningReport: true, receiveEveningReport: true, notificationEvents: ["expense.due_soon"] });
    expect(p.ok).toBe(true);
    const ids = (await listar("morning_report")).body.data.recipients.map((x: any) => x.identityId);
    expect(ids).toContain(idt.admin);
    expect(ids).not.toContain(idt.leitura);
    expect((await listar("expense.due_soon")).body.data.recipients.map((x: any) => x.identityId)).not.toContain(idt.leitura);
  });

  it("só administrador muda; aviso desconhecido é recusado; finalidade inválida = 400; sem identities.resolve = 403", async () => {
    const fin: Principal = { kind: "user", origin: "UI", user: { id: u.financeiro, name: "Fin", email: "f@x", role: "FINANCEIRO", permissions: [], workspaceOwnerId: A.id } };
    const semPermissao = await atualizarPreferencias({ ownerId: A.id, principal: fin }, idt.financeiro, { receiveMorningReport: true, receiveEveningReport: false, notificationEvents: [] });
    expect(semPermissao.ok).toBe(false);
    const invalido = await atualizarPreferencias(ctxA(), idt.financeiro, { receiveMorningReport: true, receiveEveningReport: false, notificationEvents: ["spam.total"] });
    expect(invalido.ok).toBe(false);
    expect((await listar("tudo")).status).toBe(400);
    expect((await listar("morning_report", { token: tokenSemIdentidade })).status).toBe(403);
  });
});
