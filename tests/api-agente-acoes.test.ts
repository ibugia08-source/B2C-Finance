import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling, type TestOwner,
} from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * AÇÕES DE ESCRITA DO AGENTE COM CONFIRMAÇÃO (28/09/2026).
 *  · classificação READ / WRITE_CONFIRMATION / BLOCKED — bloqueadas nunca;
 *  · proposta: corpo validado pelo schema da rota, prévia do estado atual,
 *    PendingAction guardada, NADA gravado no negócio;
 *  · confirmação: só do mesmo usuário e vínculo, com o código, na validade e
 *    com o estado igual ao da prévia; executa o payload guardado pela rota
 *    oficial com Idempotency-Key = mensagem + ação; repetir não duplica;
 *  · RBAC: a API recorta pelo usuário; o agente não se dá permissão.
 */

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { criarIntegracao } from "@/lib/services/service-accounts";
import { vincularWhatsApp } from "@/lib/services/messaging-identities";
import { API_SCOPES, FORBIDDEN_SCOPES, SCOPE_REQUIRES_PERMISSIONS } from "@/lib/api/scopes";
import { API_WRITE_OPERATIONS } from "@/lib/api/activity-meta";
import {
  OPERACOES_BLOQUEADAS, OPERACOES_DE_ESCRITA, FERRAMENTAS_DE_LEITURA, classificarRisco, chaveDaConfirmacao,
} from "@/lib/api/agent/catalog";
import { todayKey } from "@/lib/competence";
import { MONTHS_PT } from "@/lib/format";
import * as resolve from "@/app/api/v1/integrations/resolve-identity/route";
import * as acoes from "@/app/api/v1/agent/pending-actions/route";
import * as confirmar from "@/app/api/v1/agent/pending-actions/[id]/confirm/route";
import * as cancelar from "@/app/api/v1/agent/pending-actions/[id]/cancel/route";
import * as pagamentos from "@/app/api/v1/receivables/[id]/payments/route";

const TAG = randomUUID().slice(0, 6);
const HOJE = todayKey();
const [ANO, MES] = HOJE.slice(0, 7).split("-").map(Number);
const num = (s: string) => `55719${s}`;

let A: TestOwner;
let B: TestOwner;
let token: string;
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

async function resolver(telefone: string) {
  const res = await resolve.POST(
    new Request("http://localhost/api/v1/integrations/resolve-identity", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: "WHATSAPP", externalIdentifier: telefone }),
    })
  );
  return (await res.json()).data;
}

type Resp = { status: number; body: any };
async function chamar(
  h: (req: Request, r?: any) => Promise<Response>, method: string, path: string,
  o: { identidade?: string | null; body?: unknown; key?: string; msg?: string; params?: Record<string, string> } = {}
): Promise<Resp> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-b2c-source": "whatsapp" };
  if (o.identidade) headers["x-b2c-identity"] = o.identidade;
  if (o.key) headers["idempotency-key"] = o.key;
  if (o.msg) headers["x-b2c-message-id"] = o.msg;
  const res = await h(
    new Request(`http://localhost/api/v1${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }),
    o.params ? { params: o.params } : undefined
  );
  return { status: res.status, body: await res.json() };
}

const propor = (identidade: string | null, body: unknown, msg = `wamid.${randomUUID()}=`) =>
  chamar(acoes.POST, "POST", "/agent/pending-actions", { identidade, body, msg });

const confirmarAcao = (identidade: string, id: string, code: string, messageId = `wamid.${randomUUID()}==`, key?: string) =>
  chamar(confirmar.POST, "POST", `/agent/pending-actions/${id}/confirm`, {
    identidade, params: { id }, body: { messageId, confirmationCode: code }, key: key ?? chaveDaConfirmacao(messageId, id),
  });

const acao = (id: string) => runWithoutScope(async () => (await prisma.pendingAction.findUnique({ where: { id } }))!);
const pagamentosDa = (billingId: string) => runWithoutScope(async () => await prisma.payment.findMany({ where: { billingId } }));

async function cobrancaAberta(nome: string, valor = 1500) {
  const c = await createMrrClient(A, { name: `${nome} ${TAG}`, monthlyValue: valor });
  const b = await createBilling(A, c.id, { month: MES, year: ANO, amount: valor, revenueType: "ONE_TIME", description: `Avulso ${randomUUID()}` });
  return { clientId: c.id, billingId: b.id };
}

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  u.admin = await membro(A, "Gestora", "ADMIN");
  u.financeiro = await membro(A, "Financeiro", "FINANCEIRO");
  u.leitura = await membro(A, "Leitura", "LEITURA");
  u.deB = await membro(B, "DeB", "FINANCEIRO");
  const r = await criarIntegracao({ ownerId: A.id, principal: admin(A) }, { name: `agente-${TAG}`, scopes: API_SCOPES, expiresInDays: null });
  if (!r.ok) throw new Error(r.error);
  token = r.token;
  const ctxA = { ownerId: A.id, principal: admin(A) };
  for (const [k, tel] of [["admin", "55550001"], ["financeiro", "55550002"], ["leitura", "55550003"]] as const) {
    const v = await vincularWhatsApp(ctxA, { userId: u[k], telefone: num(tel) });
    if (!v.ok) throw new Error(v.error);
    idt[k] = (await resolver(`+${num(tel)}`)).identityId;
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
    await prisma.userPermission.deleteMany({ where: { userId: { in: Object.values(u) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
  });
  await destroyOwner(A);
  await destroyOwner(B);
});

// ---------------------------------------------------------------------------

describe("classificação de risco", () => {
  it("10 escritas com confirmação, 8 bloqueadas, leituras diretas", () => {
    expect(Object.values(OPERACOES_DE_ESCRITA).map((o) => o.tool).sort()).toEqual([
      "alterar_status_cliente", "atualizar_upsell", "cadastrar_cliente", "concluir_acao_rotina", "criar_despesa",
      "criar_upsell", "editar_cliente", "editar_despesa", "marcar_despesa_paga", "registrar_pagamento",
    ]);
    for (const [op, o] of Object.entries(OPERACOES_DE_ESCRITA)) {
      expect(classificarRisco(op)).toBe("WRITE_CONFIRMATION");
      expect(classificarRisco(o.tool)).toBe("WRITE_CONFIRMATION");
      // A execução exige o MESMO scope da rota de escrita.
      expect(o.scope).toBe((API_WRITE_OPERATIONS as any)[op].scope);
    }
    expect(Object.values(OPERACOES_BLOQUEADAS)).toEqual([
      "excluir cliente", "excluir recebimento", "excluir pagamento", "excluir despesa",
      "reabrir competência", "alterar permissões", "gerenciar usuário", "alterar plano de contas",
    ]);
    for (const op of Object.keys(OPERACOES_BLOQUEADAS)) {
      expect(classificarRisco(op)).toBe("BLOCKED");
      // Nem concedível a uma integração.
      expect(FORBIDDEN_SCOPES.has(op)).toBe(true);
      expect(API_SCOPES).not.toContain(op);
    }
    for (const t of FERRAMENTAS_DE_LEITURA) expect(classificarRisco(t)).toBe("READ");
    expect(classificarRisco("apagar_tudo")).toBeNull();
  });

  it("Idempotency-Key da confirmação = mensagem do WhatsApp + id da ação (formato aceito pela API)", () => {
    const k = chaveDaConfirmacao("wamid.HBgMNTU3MTk5OTk5MDAwMBUCABIYFjNFQjA=", "cmpa01");
    expect(k).toBe("wa:wamid.HBgMNTU3MTk5OTk5MDAwMBUCABIYFjNFQjA_:cmpa01");
    expect(k).toMatch(/^[A-Za-z0-9._:-]{1,255}$/);
  });

  it("propor ações só é delegado a quem pode escrever algo", () => {
    expect(SCOPE_REQUIRES_PERMISSIONS["agent_actions.manage"]).toEqual([]);
  });
});

describe("proposta (prévia) — nada é gravado no negócio", () => {
  it("registrar_pagamento: prévia do estado atual, PendingAction completa, nenhum pagamento", async () => {
    const { billingId } = await cobrancaAberta("Face Love Distribuidora");
    const msg = `wamid.${randomUUID()}=`;
    const r = await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } }, msg);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const d = r.body.data;
    expect(d).toMatchObject({ operation: "payments.register", tool: "registrar_pagamento", risk: "WRITE_CONFIRMATION", status: "PENDING", targetId: billingId });
    for (const linha of [
      "Encontrei:", `*Face Love Distribuidora ${TAG}*`, "Recebimento em aberto: R$ 1.500,00",
      `Competência: ${MONTHS_PT[MES - 1]}/${ANO}`, "Data de pagamento: hoje", "Deseja registrar?",
    ]) expect(d.preview, linha).toContain(linha);
    expect(d.confirmationCode).toMatch(/^\d{4}$/);
    expect(d.message).toContain(`*SIM ${d.confirmationCode}*`);

    const pa = await acao(d.actionId);
    expect(pa).toMatchObject({
      ownerId: A.id, userId: u.financeiro, identityId: idt.financeiro, channel: "WHATSAPP", operation: "payments.register",
      status: "PENDING", sourceMessageId: msg,
    });
    // A data da prévia é a que será executada.
    expect(pa.payload).toMatchObject({ amount: 1500, paidAt: HOJE, method: "PIX" });
    const ttl = pa.expiresAt.getTime() - pa.createdAt.getTime();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 1000);
    expect(await pagamentosDa(billingId)).toHaveLength(0);

    // A integração encontra a ação desta mensagem (é o que o workflow usa).
    const lista = await chamar(acoes.GET, "GET", `/agent/pending-actions?sourceMessageId=${encodeURIComponent(msg)}`, { identidade: idt.financeiro });
    expect(lista.body.data.map((x: any) => x.actionId)).toEqual([d.actionId]);
    // Outro usuário não vê.
    const alheia = await chamar(acoes.GET, "GET", `/agent/pending-actions?sourceMessageId=${encodeURIComponent(msg)}`, { identidade: idt.admin });
    expect(alheia.body.data).toEqual([]);
  });

  it("operações BLOQUEADAS são recusadas pela API (403 operation_blocked)", async () => {
    for (const op of Object.keys(OPERACOES_BLOQUEADAS)) {
      const r = await propor(idt.admin, { operation: op, targetId: "x1", input: {} });
      expect(r.status, op).toBe(403);
      expect(r.body.error.code).toBe("operation_blocked");
    }
    expect((await propor(idt.admin, { operation: "consultar_cliente", input: {} })).status).toBe(400);
  });

  it("sem X-B2C-Identity = 400; LEITURA não propõe; FINANCEIRO não cadastra cliente (RBAC do usuário)", async () => {
    const sem = await propor(null, { operation: "criar_despesa", input: { description: "X", amount: 1, dueDate: HOJE } });
    expect(sem.body.error.code).toBe("identity_required");
    const leitura = await resolver(`+${num("55550003")}`);
    expect(leitura.allowedScopes).not.toContain("agent_actions.manage");
    const r1 = await propor(idt.leitura, { operation: "criar_despesa", input: { description: "X", amount: 1, dueDate: HOJE } });
    expect(r1.status).toBe(403);
    expect(r1.body.error.code).toBe("user_forbidden");
    const r2 = await propor(idt.financeiro, { operation: "cadastrar_cliente", input: { name: "Novo" } });
    expect(r2.status).toBe(403);
    expect(r2.body.error.code).toBe("user_forbidden");
  });

  it("o agente não escolhe usuário nem dono: campo fora do contrato = 400; dado inválido aponta o campo", async () => {
    const r1 = await propor(idt.admin, { operation: "criar_despesa", input: { description: "X", amount: 10, dueDate: HOJE, userId: u.leitura } });
    expect(r1.status).toBe(400);
    const r2 = await propor(idt.admin, { operation: "criar_despesa", input: { description: "X", amount: -5, dueDate: HOJE } });
    expect(r2.status).toBe(400);
    expect(r2.body.error.details.map((d: any) => d.field)).toContain("input.amount");
    const r3 = await propor(idt.admin, { operation: "criar_despesa", input: { description: "X", amount: 10, dueDate: HOJE }, userId: u.leitura });
    expect(r3.status).toBe(400);
    const r4 = await propor(idt.admin, { operation: "registrar_pagamento", input: { amount: 10 } });
    expect(r4.body.error.message).toContain("targetId");
  });

  it("cobrança já quitada ou de outro workspace: recusada já na prévia", async () => {
    const { billingId } = await cobrancaAberta("Quitada", 300);
    await runWithoutScope(async () => await prisma.billing.update({ where: { id: billingId }, data: { status: "PAID", paidTotal: 300 } }));
    const r = await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 300 } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("invalid_state");
    const cB = await createMrrClient(B, { name: `Cliente B ${TAG}` });
    const bB = await createBilling(B, cB.id, { month: MES, year: ANO, amount: 100, revenueType: "ONE_TIME" });
    expect((await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: bB.id, input: { amount: 100 } })).status).toBe(404);
  });
});

describe("confirmação e execução", () => {
  it("código errado não executa; o certo executa UMA vez pela rota oficial, com a chave mensagem+ação", async () => {
    const { billingId } = await cobrancaAberta("Confirma");
    const p = (await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } })).body.data;
    const errado = p.confirmationCode === "0000" ? "1111" : "0000";

    const e = await confirmarAcao(idt.financeiro, p.actionId, errado);
    expect(e.status).toBe(422);
    expect(e.body.error).toMatchObject({ code: "confirmation_mismatch", details: { attemptsLeft: 4 } });
    const semChave = await confirmarAcao(idt.financeiro, p.actionId, p.confirmationCode, "wamid.X", "outra-chave");
    expect(semChave.status).toBe(400);
    expect(await pagamentosDa(billingId)).toHaveLength(0);

    const msg = `wamid.${randomUUID()}==`;
    const ok = await confirmarAcao(idt.financeiro, p.actionId, p.confirmationCode, msg);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({ status: "EXECUTED", replayed: false });
    expect(ok.body.data.message).toContain("✅ Pagamento registrado");
    expect(ok.body.data.message).toContain("R$ 1.500,00");
    const pags = await pagamentosDa(billingId);
    expect(pags).toHaveLength(1);
    expect(Number(pags[0].amount)).toBe(1500);

    const chave = chaveDaConfirmacao(msg, p.actionId);
    const pa = await acao(p.actionId);
    expect(pa).toMatchObject({ status: "EXECUTED", confirmationMessageId: msg, idempotencyKey: chave, failedAttempts: 1 });
    expect((pa.result as any)).toMatchObject({ httpStatus: 201, success: true, entityId: pags[0].id });
    // A escrita ficou na trilha como qualquer escrita da API, com o usuário como ator.
    const escrita = await runWithoutScope(async () =>
      await prisma.apiActivity.findFirst({ where: { ownerId: A.id, action: "payments.register", correlationId: `pa:${p.actionId}` } })
    );
    expect(escrita).toMatchObject({ kind: "WRITE", result: "SUCCESS", actorUserId: u.financeiro, source: "WHATSAPP" });
    expect((escrita!.metadata as any).idempotencyKey).toBe(chave);

    // Reenvio da mesma confirmação: mesmo resultado, nada novo.
    const again = await confirmarAcao(idt.financeiro, p.actionId, p.confirmationCode, msg);
    expect(again.body.data).toMatchObject({ status: "EXECUTED", replayed: true });
    // Outro "SIM <código>" depois de executada: recusado.
    const outra = await confirmarAcao(idt.financeiro, p.actionId, p.confirmationCode);
    expect(outra.status).toBe(409);
    expect(outra.body.error.code).toBe("action_not_pending");
    expect(await pagamentosDa(billingId)).toHaveLength(1);
  });

  it("confirmação de outro usuário/vínculo não enxerga a ação", async () => {
    const { billingId } = await cobrancaAberta("Alheia");
    const p = (await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } })).body.data;
    const r = await confirmarAcao(idt.admin, p.actionId, p.confirmationCode);
    expect(r.status).toBe(404);
    expect(await pagamentosDa(billingId)).toHaveLength(0);
  });

  it("estado mudou desde a prévia (pago na tela): 409 state_changed, nada executado", async () => {
    const { billingId } = await cobrancaAberta("Mudou");
    const p = (await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } })).body.data;
    const direto = await chamar(pagamentos.POST, "POST", `/receivables/${billingId}/payments`, {
      params: { id: billingId }, body: { amount: 500 }, key: `tela-${randomUUID()}`,
    });
    expect(direto.status).toBe(201);
    const r = await confirmarAcao(idt.financeiro, p.actionId, p.confirmationCode);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("state_changed");
    expect(await pagamentosDa(billingId)).toHaveLength(1);
    expect((await acao(p.actionId)).status).toBe("FAILED");
  });

  it("vencida = 410; substituída por proposta nova = 409; cancelada = 409", async () => {
    const { billingId } = await cobrancaAberta("Prazo");
    const p1 = (await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 100 } })).body.data;
    const p2 = (await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 200 } })).body.data;
    expect((await acao(p1.actionId)).status).toBe("SUPERSEDED");
    expect((await confirmarAcao(idt.financeiro, p1.actionId, p1.confirmationCode)).body.error.code).toBe("action_not_pending");

    await runWithoutScope(async () => await prisma.pendingAction.update({ where: { id: p2.actionId }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const vencida = await confirmarAcao(idt.financeiro, p2.actionId, p2.confirmationCode);
    expect(vencida.status).toBe(410);
    expect((await acao(p2.actionId)).status).toBe("EXPIRED");

    const p3 = (await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 300 } })).body.data;
    const c = await chamar(cancelar.POST, "POST", `/agent/pending-actions/${p3.actionId}/cancel`, {
      identidade: idt.financeiro, params: { id: p3.actionId }, body: { messageId: "wamid.nao" },
    });
    expect(c.body.data.status).toBe("CANCELLED");
    expect((await confirmarAcao(idt.financeiro, p3.actionId, p3.confirmationCode)).status).toBe(409);
    expect(await pagamentosDa(billingId)).toHaveLength(0);
  });

  it("5 códigos errados cancelam a ação", async () => {
    const p = (await propor(idt.admin, { operation: "criar_despesa", input: { description: `Tentativas ${TAG}`, amount: 10, dueDate: HOJE } })).body.data;
    const errado = p.confirmationCode === "0000" ? "1111" : "0000";
    for (let i = 0; i < 5; i++) await confirmarAcao(idt.admin, p.actionId, errado);
    expect(await acao(p.actionId)).toMatchObject({ status: "CANCELLED", errorCode: "too_many_attempts" });
    expect((await confirmarAcao(idt.admin, p.actionId, p.confirmationCode)).status).toBe(409);
  });

  it("permissão revogada entre a prévia e o SIM: a execução é recusada", async () => {
    const { billingId } = await cobrancaAberta("Revogada");
    const p = (await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 1500 } })).body.data;
    await runWithoutScope(async () =>
      await prisma.userPermission.create({ data: { userId: u.financeiro, permission: "recebimentos.registrar_pagamento", enabled: false } })
    );
    try {
      const r = await confirmarAcao(idt.financeiro, p.actionId, p.confirmationCode);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("user_forbidden");
      expect(await pagamentosDa(billingId)).toHaveLength(0);
    } finally {
      await runWithoutScope(async () => await prisma.userPermission.deleteMany({ where: { userId: u.financeiro } }));
    }
  });

  it("recusa da regra de negócio na execução vira FAILED com a mensagem da API", async () => {
    const { billingId } = await cobrancaAberta("Excede", 100);
    const p = (await propor(idt.financeiro, { operation: "registrar_pagamento", targetId: billingId, input: { amount: 150 } })).body.data;
    expect(p.preview).toContain("a API vai recusar");
    const r = await confirmarAcao(idt.financeiro, p.actionId, p.confirmationCode);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("FAILED");
    expect(r.body.data.errorCode).toBe("unprocessable");
    expect(r.body.data.message).toContain("❌ Não executei");
    expect(await pagamentosDa(billingId)).toHaveLength(0);
  });
});

describe("as dez ferramentas de escrita, de ponta a ponta", () => {
  const executar = async (identidade: string, body: unknown) => {
    const p = await propor(identidade, body);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const r = await confirmarAcao(identidade, p.body.data.actionId, p.body.data.confirmationCode);
    expect(r.body.data?.status, JSON.stringify(r.body)).toBe("EXECUTED");
    return { preview: p.body.data.preview as string, acao: await acao(p.body.data.actionId) };
  };

  it("cliente: cadastrar, editar e alterar status (com vigência)", async () => {
    const nome = `Alpha Estética ${TAG}`;
    const cad = await executar(idt.admin, {
      operation: "cadastrar_cliente", input: { name: nome, modality: "MRR", monthlyValue: 2000, contractMonths: 12, paymentDay: 5 },
    });
    expect(cad.preview).toContain("Vou cadastrar:");
    expect(cad.preview).toContain("Valor mensal: R$ 2.000,00");
    const id = (cad.acao.result as any).entityId;
    const cliente = await runWithoutScope(async () => await prisma.client.findUnique({ where: { id } }));
    expect(cliente).toMatchObject({ name: nome, ownerId: A.id });

    const ed = await executar(idt.admin, { operation: "editar_cliente", targetId: id, input: { city: "Salvador", paymentDay: 12 } });
    expect(ed.preview).toContain("Cidade: (vazio) → Salvador");
    expect(ed.preview).toContain("Dia de pagamento: 5 → 12");
    expect(await runWithoutScope(async () => await prisma.client.findUnique({ where: { id }, select: { city: true, paymentDay: true } })))
      .toEqual({ city: "Salvador", paymentDay: 12 });

    const st = await executar(idt.admin, {
      operation: "alterar_status_cliente", targetId: id, input: { status: "PAUSED", effectiveFrom: HOJE, reason: "Pedido do cliente" },
    });
    expect(st.preview).toContain("Novo status: Pausado");
    expect(st.preview).toContain("A partir de: hoje");
    expect((await runWithoutScope(async () => await prisma.client.findUnique({ where: { id } })))!.status).toBe("PAUSED");
  });

  it("despesa: criar, editar e marcar como paga", async () => {
    const cr = await executar(idt.financeiro, {
      operation: "criar_despesa", input: { description: `CRM ${TAG}`, amount: 300, dueDate: HOJE, type: "TOOL" },
    });
    expect(cr.preview).toContain("Valor: R$ 300,00");
    const id = (cr.acao.result as any).entityId;
    const ed = await executar(idt.financeiro, { operation: "editar_despesa", targetId: id, input: { amount: 350 } });
    expect(ed.preview).toContain("Valor: R$ 300,00 → R$ 350,00");
    const pg = await executar(idt.financeiro, { operation: "marcar_despesa_paga", targetId: id, input: {} });
    expect(pg.preview).toContain("Deseja marcar como paga?");
    const t = await runWithoutScope(async () => await prisma.transaction.findUnique({ where: { id } }));
    expect(t).toMatchObject({ status: "pago" });
    expect(Number(t!.amount)).toBe(350);
    // Já paga: a próxima proposta nem gera prévia.
    expect((await propor(idt.financeiro, { operation: "marcar_despesa_paga", targetId: id, input: {} })).body.error.code).toBe("invalid_state");
  });

  it("upsell: criar e atualizar", async () => {
    const c = await createMrrClient(A, { name: `Upsell ${TAG}` });
    const cr = await executar(idt.admin, {
      operation: "criar_upsell", input: { clientId: c.id, description: "Gestão de tráfego", amount: 900, expectedCloseDate: HOJE },
    });
    expect(cr.preview).toContain("Oportunidade: Gestão de tráfego");
    const id = (cr.acao.result as any).entityId;
    const at = await executar(idt.admin, { operation: "atualizar_upsell", targetId: id, input: { amount: 1200, status: "NEGOTIATION" } });
    expect(at.preview).toContain("Valor: R$ 900,00 → R$ 1.200,00");
    expect(at.preview).toContain("Etapa: Oportunidade → Negociação");
    const up = await runWithoutScope(async () => await prisma.upsell.findUnique({ where: { id } }));
    expect(up).toMatchObject({ status: "NEGOTIATION" });
  });

  it("rotina: ação que não está na rotina de hoje é recusada já na prévia", async () => {
    const r = await propor(idt.admin, { operation: "concluir_acao_rotina", targetId: "cobrar:nao-existe", input: {} });
    expect(r.status).toBe(404);
  });
});
