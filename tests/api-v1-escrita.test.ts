import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling, asOwner, type TestOwner,
} from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * API V1 — ESCRITAS CONTROLADAS (28/09/2026). Integração: Route Handlers
 * reais, token real, banco de testes. Cada rota: scope, Idempotency-Key,
 * dono, função de domínio da tela, AuditLog + trilha, entidade devolvida e
 * cache invalidado. Status só com vigência; pagamento com as validações de
 * dono, valor, estado, duplicidade, competência e data.
 */

const invalidados: string[] = [];
vi.mock("next/cache", async (orig) => ({
  ...(await orig<any>()),
  revalidatePath: (p: string) => invalidados.push(`path:${p}`),
  revalidateTag: (t: string) => invalidados.push(`tag:${t}`),
}));

import { criarIntegracao } from "@/lib/services/service-accounts";
import { API_SCOPES } from "@/lib/api/scopes";
import { addMonths, getStartOfCompetence, todayKey } from "@/lib/competence";
import { currentWorkspaceId } from "@/lib/services/workspace";
import * as clientsRoute from "@/app/api/v1/clients/route";
import * as clientRoute from "@/app/api/v1/clients/[id]/route";
import * as statusChanges from "@/app/api/v1/clients/[id]/status-changes/route";
import * as payments from "@/app/api/v1/receivables/[id]/payments/route";
import * as expensesRoute from "@/app/api/v1/expenses/route";
import * as expenseRoute from "@/app/api/v1/expenses/[id]/route";
import * as expensePay from "@/app/api/v1/expenses/[id]/pay/route";
import * as upsellsRoute from "@/app/api/v1/upsells/route";
import * as upsellRoute from "@/app/api/v1/upsells/[id]/route";
import * as routineComplete from "@/app/api/v1/routine/actions/[id]/complete/route";
import * as routineDaily from "@/app/api/v1/routine/daily/route";

const HOJE = todayKey();
const COMP = HOJE.slice(0, 7);
const [ANO, MES] = COMP.split("-").map(Number);
const TAG = randomUUID().slice(0, 6);

let A: TestOwner;
let B: TestOwner;
let token: string;
let tokenLeitura: string;
let tokenB: string;
let ws: string;
let categoriaId: string;

const admin = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: o.id, name: "Admin", email: o.email, role: "ADMIN", permissions: [], workspaceOwnerId: null },
});
async function chave(o: TestOwner, scopes: string[]) {
  const r = await criarIntegracao({ ownerId: o.id, principal: admin(o) }, { name: `w-${TAG}`, scopes, expiresInDays: null });
  if (!r.ok) throw new Error(r.error);
  return r.token;
}

type H = (req: Request, route?: any) => Promise<Response>;
async function chamar(
  h: H, method: string, path: string, body?: unknown,
  opts: { token?: string; key?: string | null; params?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = { authorization: `Bearer ${opts.token ?? token}`, "content-type": "application/json" };
  if (opts.key !== null) headers["idempotency-key"] = opts.key ?? `t-${randomUUID()}`;
  const res = await h(
    new Request(`http://localhost/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    opts.params ? { params: opts.params } : undefined
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const auditoria = (entity: string, entityId: string) =>
  runWithoutScope(async () => await prisma.auditLog.findMany({ where: { entity, entityId }, orderBy: { createdAt: "asc" } }));

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  token = await chave(A, API_SCOPES);
  tokenLeitura = await chave(A, ["clients.read", "receivables.read", "expenses.read", "upsells.read", "routine.read"]);
  tokenB = await chave(B, API_SCOPES);
  ws = await currentWorkspaceId();
  categoriaId = (await runWithoutScope(async () => await prisma.category.create({ data: { name: `API Ferramentas ${TAG}`, kind: "despesa" } }))).id;
});
afterAll(async () => {
  await runWithoutScope(async () => {
    for (const o of [A, B]) {
      await prisma.routineItemState.deleteMany({ where: { ownerId: o.id } });
      await prisma.upsellService.deleteMany({ where: { ownerId: o.id } });
      await prisma.upsell.deleteMany({ where: { ownerId: o.id } });
      await prisma.transaction.deleteMany({ where: { ownerId: o.id } });
      await prisma.employee.deleteMany({ where: { ownerId: o.id } });
    }
    await prisma.category.deleteMany({ where: { id: categoriaId } });
    await prisma.closingPeriod.deleteMany({ where: { workspaceId: ws, competence: "2015-03" } });
  });
  await destroyOwner(A);
  await destroyOwner(B);
});
beforeEach(() => {
  invalidados.length = 0;
});

describe("regras comuns das escritas", () => {
  it("nenhuma rota DELETE existe na V1", () => {
    const raiz = join(process.cwd(), "src/app/api/v1");
    const arquivos = (function andar(d: string): string[] {
      return readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? andar(join(d, n)) : n === "route.ts" ? [join(d, n)] : []));
    })(raiz);
    for (const a of arquivos) expect(readFileSync(a, "utf8"), a).not.toMatch(/export const (DELETE|PUT)\b/);
  });

  it("ownerId no corpo é recusado (o dono vem só da integração)", async () => {
    const r = await chamar(clientsRoute.POST, "POST", "/clients", { name: "Intruso", ownerId: B.id });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("validation_error");
  });

  it("sem scope de escrita = 403; sem Idempotency-Key = 400", async () => {
    const r1 = await chamar(clientsRoute.POST, "POST", "/clients", { name: "X" }, { token: tokenLeitura });
    expect(r1.status).toBe(403);
    const r2 = await chamar(clientsRoute.POST, "POST", "/clients", { name: "X" }, { key: null });
    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe("idempotency_key_required");
  });
});

describe("clientes", () => {
  it("POST cria (201, entidade), audita, invalida cache e o replay não duplica", async () => {
    const key = `c-${randomUUID()}`;
    const corpo = { name: `Face Love ${TAG}`, modality: "MRR", monthlyValue: 1500, paymentDay: 10, contractMonths: 12, startedAt: `${COMP}-01` };
    const r = await chamar(clientsRoute.POST, "POST", "/clients", corpo, { key });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ name: `Face Love ${TAG}`, modality: "MRR", monthlyValue: 1500, status: { current: { code: "ACTIVE" } } });
    expect(invalidados).toContain("path:/clientes");
    const rep = await chamar(clientsRoute.POST, "POST", "/clients", corpo, { key });
    expect(rep.headers.get("idempotent-replayed")).toBe("true");
    const n = await runWithoutScope(async () => await prisma.client.count({ where: { ownerId: A.id, name: `Face Love ${TAG}` } }));
    expect(n).toBe(1);
    const aud = await auditoria("Client", r.body.data.id);
    expect(aud.some((a) => a.action === "CREATE" && a.origin === "API" && a.actorEmail?.startsWith("sistema:api:"))).toBe(true);
    // Contrato e cobranças nasceram pela mesma regra do formulário.
    const cobr = await runWithoutScope(async () => await prisma.billing.count({ where: { clientId: r.body.data.id } }));
    expect(cobr).toBeGreaterThan(0);
  });

  it("duplicado = 409 (salvo allowDuplicate)", async () => {
    const nome = `Duplo ${TAG}`;
    expect((await chamar(clientsRoute.POST, "POST", "/clients", { name: nome })).status).toBe(201);
    const dup = await chamar(clientsRoute.POST, "POST", "/clients", { name: nome });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("duplicate");
    expect((await chamar(clientsRoute.POST, "POST", "/clients", { name: nome, allowDuplicate: true })).status).toBe(201);
  });

  it("PATCH altera cadastro, audita a diferença e NUNCA aceita status", async () => {
    const c = await createMrrClient(A, { name: `Patch ${TAG}` });
    const r = await chamar(clientRoute.PATCH, "PATCH", `/clients/${c.id}`, { city: "Salvador", state: "ba" }, { params: { id: c.id } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ city: "Salvador", state: "BA", status: { current: { code: "ACTIVE" } } });
    const aud = await auditoria("Client", c.id);
    expect(aud.find((a) => a.field === "city")?.newValue).toBe("Salvador");

    const st = await chamar(clientRoute.PATCH, "PATCH", `/clients/${c.id}`, { status: "INACTIVE" }, { params: { id: c.id } });
    expect(st.status).toBe(400);
    expect(JSON.stringify(st.body)).toContain("status-changes");
    const cru = await runWithoutScope(async () => await prisma.client.findUnique({ where: { id: c.id } }));
    expect(cru!.status).toBe("ACTIVE");
  });

  it("PATCH em cliente de outro dono = 404", async () => {
    const deB = await createMrrClient(B, { name: `De B ${TAG}` });
    const r = await chamar(clientRoute.PATCH, "PATCH", `/clients/${deB.id}`, { city: "X" }, { params: { id: deB.id } });
    expect(r.status).toBe(404);
  });
});

describe("status com vigência", () => {
  it("futura fica programada sem mudar hoje; retroativa exige confirmação; o mês passado é preservado", async () => {
    const c = await createMrrClient(A, { name: `Vigencia ${TAG}`, startedAt: new Date(2025, 0, 1) });
    const prox = getStartOfCompetence(addMonths(COMP, 1));
    const fut = await chamar(statusChanges.POST, "POST", `/clients/${c.id}/status-changes`,
      { status: "INACTIVE", effectiveFrom: prox, reason: "Encerra no fim do mês" }, { params: { id: c.id } });
    expect(fut.status, JSON.stringify(fut.body)).toBe(201);
    expect(fut.body.data.change).toMatchObject({ scheduled: true, currentStatusChanged: false });
    expect(fut.body.data.statusHistory.currentStatus.code).toBe("ACTIVE");
    expect(fut.body.data.statusHistory.scheduled[0]).toMatchObject({ effectiveFrom: prox, status: { code: "INACTIVE" } });
    expect(invalidados).toContain("path:/clientes/historico-status");

    const passado = getStartOfCompetence(addMonths(COMP, -1));
    const sem = await chamar(statusChanges.POST, "POST", `/clients/${c.id}/status-changes`,
      { status: "PAUSED", effectiveFrom: passado }, { params: { id: c.id } });
    expect(sem.status).toBe(422);
    expect(sem.body.error.code).toBe("retroactive_requires_confirmation");

    const hoje = await chamar(statusChanges.POST, "POST", `/clients/${c.id}/status-changes`,
      { status: "PAUSED", effectiveFrom: HOJE }, { params: { id: c.id } });
    expect(hoje.status).toBe(201);
    expect(hoje.body.data.statusHistory.currentStatus.code).toBe("PAUSED");
    const hist = hoje.body.data.statusHistory.intervals;
    expect(hist.some((i: any) => i.status.code === "ACTIVE" && i.effectiveTo)).toBe(true); // o passado segue Ativo
  });

  it("cliente de outro dono = 404", async () => {
    const deB = await createMrrClient(B, { name: `St B ${TAG}` });
    const r = await chamar(statusChanges.POST, "POST", `/clients/${deB.id}/status-changes`,
      { status: "INACTIVE", effectiveFrom: HOJE }, { params: { id: deB.id } });
    expect(r.status).toBe(404);
  });
});

describe("pagamento", () => {
  const venc = () => new Date(Date.UTC(ANO, MES - 1, 1));
  const pagar = (id: string, body: unknown, key?: string, tk?: string) =>
    chamar(payments.POST, "POST", `/receivables/${id}/payments`, body, { params: { id }, key, token: tk });

  it("registra (201), devolve a cobrança atualizada, invalida cache e o replay não paga duas vezes", async () => {
    const c = await createMrrClient(A, { name: `Pagador ${TAG}` });
    const b = await createBilling(A, c.id, { month: MES, year: ANO, amount: 1500, dueDate: venc() });
    const key = `wa_message_${randomUUID()}`;
    const r = await pagar(b.id, { amount: 1000, paidAt: HOJE }, key);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.payment).toMatchObject({ amount: 1000, fullyPaid: false });
    expect(r.body.data.receivable).toMatchObject({ id: b.id, paidAmount: 1000, openAmount: 500 });
    expect(invalidados).toContain("path:/cobrancas");
    const rep = await pagar(b.id, { amount: 1000, paidAt: HOJE }, key);
    expect(rep.headers.get("idempotent-replayed")).toBe("true");
    expect(await runWithoutScope(async () => await prisma.payment.count({ where: { billingId: b.id } }))).toBe(1);
    const p = await runWithoutScope(async () => await prisma.payment.findFirst({ where: { billingId: b.id } }));
    expect(p!.externalSource).toBe("api");
  });

  it("valida valor (excedente só com allowOverpayment), data futura e duplicidade", async () => {
    const c = await createMrrClient(A, { name: `Valida ${TAG}` });
    const b = await createBilling(A, c.id, { month: MES, year: ANO, amount: 800, dueDate: venc() });
    const acima = await pagar(b.id, { amount: 900 });
    expect(acima.status).toBe(422);
    expect(acima.body.error.message).toContain("allowOverpayment");
    const amanha = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await pagar(b.id, { amount: 100, paidAt: amanha })).status).toBe(422);
    expect((await pagar(b.id, { amount: 0 })).status).toBe(400);
    expect((await pagar(b.id, { amount: 10.555 })).status).toBe(400);

    expect((await pagar(b.id, { amount: 300, paidAt: HOJE })).status).toBe(201);
    const dup = await pagar(b.id, { amount: 300, paidAt: HOJE });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("possible_duplicate");
    expect((await pagar(b.id, { amount: 300, paidAt: HOJE, allowDuplicate: true })).status).toBe(201);
  });

  it("estado: quitada, removida e renegociada não recebem; outro dono = 404", async () => {
    const c = await createMrrClient(A, { name: `Estado ${TAG}` });
    const paga = await createBilling(A, c.id, { month: MES, year: ANO, amount: 100, dueDate: venc() });
    expect((await pagar(paga.id, { amount: 100, paidAt: HOJE })).status).toBe(201);
    const quitada = await pagar(paga.id, { amount: 50 });
    expect(quitada.status).toBe(422);
    expect(quitada.body.error.code).toBe("invalid_state");
    const removida = await createBilling(A, c.id, { month: MES, year: ANO, amount: 100, dueDate: venc(), description: "removida", revenueType: "ONE_TIME" });
    await asOwner(A, async () => await prisma.billing.update({ where: { id: removida.id }, data: { status: "CANCELED", canceledAt: new Date() } }));
    expect((await pagar(removida.id, { amount: 50 })).body.error.code).toBe("invalid_state");
    const deB = await createMrrClient(B, { name: `Pag B ${TAG}` });
    const bB = await createBilling(B, deB.id, { month: MES, year: ANO, amount: 100, dueDate: venc() });
    expect((await pagar(bB.id, { amount: 50 })).status).toBe(404);
  });

  it("competência do caixa fechada = 422 competence_closed", async () => {
    await runWithoutScope(async () =>
      await prisma.closingPeriod.create({
        data: { workspaceId: ws, scopeType: "WORKSPACE", scopeId: "", competence: "2015-03", state: "CLOSED", closedAt: new Date(), closedBy: "teste" },
      })
    );
    const c = await createMrrClient(A, { name: `Fechado ${TAG}` });
    const b = await createBilling(A, c.id, { month: 3, year: 2015, amount: 100, dueDate: new Date(Date.UTC(2015, 2, 10)) });
    const r = await pagar(b.id, { amount: 100, paidAt: "2015-03-10" });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("competence_closed");
    expect(await runWithoutScope(async () => await prisma.payment.count({ where: { billingId: b.id } }))).toBe(0);
  });
});

describe("despesas", () => {
  it("POST cria pendente (categoria por nome), PATCH edita e /pay paga — com auditoria", async () => {
    const r = await chamar(expensesRoute.POST, "POST", "/expenses",
      { description: `Software ${TAG}`, amount: 300, dueDate: `${COMP}-20`, category: `api ferramentas ${TAG}`, type: "TOOL" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ rawStatus: "pendente", amount: 300, category: { id: categoriaId } });
    const id = r.body.data.id;
    expect(invalidados).toContain("path:/despesas");

    const p = await chamar(expenseRoute.PATCH, "PATCH", `/expenses/${id}`, { amount: 350 }, { params: { id } });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.data.amount).toBe(350);
    expect((await auditoria("Transaction", id)).find((a) => a.field === "amount")?.newValue).toBe("350");

    const st = await chamar(expenseRoute.PATCH, "PATCH", `/expenses/${id}`, { status: "pago" }, { params: { id } });
    expect(st.status).toBe(400);

    const pago = await chamar(expensePay.POST, "POST", `/expenses/${id}/pay`, undefined, { params: { id } });
    expect(pago.status, JSON.stringify(pago.body)).toBe(200);
    expect(pago.body.data).toMatchObject({ alreadyPaid: false, expense: { status: "pago" } });
    const de_novo = await chamar(expensePay.POST, "POST", `/expenses/${id}/pay`, {}, { params: { id } });
    expect(de_novo.body.data.alreadyPaid).toBe(true);
    const editarPaga = await chamar(expenseRoute.PATCH, "PATCH", `/expenses/${id}`, { amount: 1 }, { params: { id } });
    expect(editarPaga.status).toBe(422);
  });

  it("recorrência mensal nasce inteira (transação); cartão e categoria inexistente são recusados", async () => {
    const r = await chamar(expensesRoute.POST, "POST", "/expenses",
      { description: `Aluguel ${TAG}`, amount: 2000, dueDate: `${COMP}-05`, recurrence: "MONTHLY" });
    expect(r.status).toBe(201);
    const serie = await runWithoutScope(async () => await prisma.transaction.count({ where: { recurrenceGroupId: r.body.data.id } }));
    expect(serie).toBe(13);
    expect((await chamar(expensesRoute.POST, "POST", "/expenses", { description: "c", amount: 1, dueDate: HOJE, type: "CARD" })).status).toBe(400);
    expect((await chamar(expensesRoute.POST, "POST", "/expenses", { description: "c", amount: 1, dueDate: HOJE, category: "não existe" })).status).toBe(404);
  });
});

describe("upsell", () => {
  it("POST com descrição e responsável; PATCH no funil aberto; decidido não é editado", async () => {
    const c = await createMrrClient(A, { name: `Up ${TAG}` });
    const emp = await asOwner(A, async () => await prisma.employee.create({ data: { name: `Bianca ${TAG}` } }));
    const r = await chamar(upsellsRoute.POST, "POST", "/upsells",
      { clientId: c.id, description: "Tráfego pago", amount: 900, responsibleId: emp.id, expectedCloseDate: `${COMP}-28`, notes: "via WhatsApp" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ title: "Tráfego pago", value: 900, responsible: `Bianca ${TAG}`, status: "OPPORTUNITY", client: { id: c.id } });
    const id = r.body.data.id;
    expect(invalidados).toContain("path:/upsell");

    const p = await chamar(upsellRoute.PATCH, "PATCH", `/upsells/${id}`, { amount: 1200, status: "NEGOTIATION" }, { params: { id } });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.data).toMatchObject({ value: 1200, status: "NEGOTIATION" });

    expect((await chamar(upsellRoute.PATCH, "PATCH", `/upsells/${id}`, { status: "WON" }, { params: { id } })).status).toBe(400);
    await asOwner(A, async () => await prisma.upsell.update({ where: { id }, data: { status: "WON" } }));
    const decidido = await chamar(upsellRoute.PATCH, "PATCH", `/upsells/${id}`, { amount: 1 }, { params: { id } });
    expect(decidido.status).toBe(422);

    expect((await chamar(upsellsRoute.POST, "POST", "/upsells", { clientId: c.id, amount: 10 })).status).toBe(400);
    const deB = await createMrrClient(B, { name: `UpB ${TAG}` });
    expect((await chamar(upsellsRoute.POST, "POST", "/upsells", { clientId: deB.id, description: "x", amount: 10 })).status).toBe(404);
  });
});

describe("rotina", () => {
  it("conclui uma ação de hoje; chave desconhecida = 404; sem routine.write = 403", async () => {
    // Uma despesa vencida gera a ação "despesas-vencidas" na rotina de hoje.
    await asOwner(A, async () =>
      await prisma.transaction.create({
        data: { type: "despesa", description: `Vencida ${TAG}`, amount: 50, date: new Date("2026-01-05T12:00:00Z"), dueDate: new Date("2026-01-05T00:00:00Z"), status: "pendente", belongsTo: "empresa" },
      })
    );
    const rotina = await chamar(routineDaily.GET, "GET", "/routine/daily", undefined, { key: null });
    const acao = rotina.body.data.actions.find((a: any) => a.key === "despesas-vencidas");
    expect(acao).toBeTruthy();

    const k = encodeURIComponent("despesas-vencidas");
    const r = await chamar(routineComplete.POST, "POST", `/routine/actions/${k}/complete`, {}, { params: { id: k } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ key: "despesas-vencidas", done: true, alreadyDone: false });
    const depois = await chamar(routineDaily.GET, "GET", "/routine/daily", undefined, { key: null });
    expect(depois.body.data.actions.find((a: any) => a.key === "despesas-vencidas").done).toBe(true);

    expect((await chamar(routineComplete.POST, "POST", "/routine/actions/nao-existe/complete", {}, { params: { id: "nao-existe" } })).status).toBe(404);
    expect((await chamar(routineComplete.POST, "POST", `/routine/actions/${k}/complete`, {}, { params: { id: k }, token: tokenLeitura })).status).toBe(403);
    void tokenB;
  });
});
