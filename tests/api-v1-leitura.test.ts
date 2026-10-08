import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling, asOwner, type TestOwner,
} from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * API V1 — LEITURA (28/09/2026). Testes de INTEGRAÇÃO: chamam os Route
 * Handlers reais com um Request e um token de verdade, contra o banco de
 * testes. Provam o contrato (success/data/meta, erros, requestId), o scope,
 * o isolamento por dono, a paginação, os filtros e — principal — o status
 * TEMPORAL: a competência passada mostra o status que valia nela, não o de hoje.
 */

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { criarIntegracao } from "@/lib/services/service-accounts";
import { changeClientStatus } from "@/lib/clients/status-history";
import { addMonths, getStartOfCompetence, todayKey } from "@/lib/competence";
import { API_SCOPES } from "@/lib/api/scopes";
import { defineEndpoint } from "@/lib/api/http";
import { pontuar } from "@/lib/api/v1/search";
import { mascararDocumento } from "@/lib/api/v1/common";

import * as health from "@/app/api/v1/health/route";
import * as dashboard from "@/app/api/v1/dashboard/summary/route";
import * as clients from "@/app/api/v1/clients/route";
import * as client from "@/app/api/v1/clients/[id]/route";
import * as statusHistory from "@/app/api/v1/clients/[id]/status-history/route";
import * as receivables from "@/app/api/v1/receivables/route";
import * as receivable from "@/app/api/v1/receivables/[id]/route";
import * as expenses from "@/app/api/v1/expenses/route";
import * as expense from "@/app/api/v1/expenses/[id]/route";
import * as cash from "@/app/api/v1/cash/summary/route";
import * as upsells from "@/app/api/v1/upsells/route";
import * as routine from "@/app/api/v1/routine/daily/route";
import * as reportsDaily from "@/app/api/v1/reports/daily/route";
import * as reportsMonthly from "@/app/api/v1/reports/monthly/route";
import * as search from "@/app/api/v1/search/route";

const HOJE = todayKey();
const COMP = HOJE.slice(0, 7);
const ANTERIOR = addMonths(COMP, -1);
const [ANO, MES] = COMP.split("-").map(Number);
const TUDO = { alterar: true, programar: true, retroativo: true };
const TAG = randomUUID().slice(0, 6);

let A: TestOwner;
let B: TestOwner;
let tokenTudo: string;
let tokenSoDashboard: string;
let tokenRotina: string;
let ids: Record<string, string> = {};
let categoriaId: string;

const admin = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: o.id, name: "Admin", email: o.email, role: "ADMIN", permissions: [], workspaceOwnerId: null },
});
async function chave(o: TestOwner, scopes: string[]) {
  const r = await criarIntegracao({ ownerId: o.id, principal: admin(o) }, { name: `t-${TAG}`, scopes, expiresInDays: null });
  if (!r.ok) throw new Error(r.error);
  return r.token;
}

type Rota = { GET: (req: Request, route?: any) => Promise<Response> };
async function chamar(rota: Rota, path: string, token: string | null = tokenTudo, params?: Record<string, string>) {
  const req = new Request(`http://localhost/api/v1${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const res = await rota.GET(req, params ? { params } : undefined);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  tokenTudo = await chave(A, API_SCOPES);
  tokenSoDashboard = await chave(A, ["dashboard.read"]);
  tokenRotina = await chave(A, ["routine.read"]);

  const face = await createMrrClient(A, { name: `Face Love Estética ${TAG}`, startedAt: new Date(2025, 0, 1) });
  const outro = await createMrrClient(A, { name: `Zeta Odonto ${TAG}`, startedAt: new Date(2025, 0, 1) });
  const inativo = await createMrrClient(A, { name: `Mudou Status ${TAG}`, startedAt: new Date(2025, 0, 1) });
  const deB = await createMrrClient(B, { name: `Face Love Estética ${TAG} (do B)`, startedAt: new Date(2025, 0, 1) });
  await asOwner(A, async () => {
    await prisma.client.update({ where: { id: face.id }, data: { legalName: "Face Love Clínica Ltda", document: "12.345.678/0001-90", salesOwner: "Raiane", segment: "Estética" } });
    await prisma.client.update({ where: { id: outro.id }, data: { modality: "TCV", monthlyValue: null, totalContractValue: 12000 } });
  });
  // Status TEMPORAL: "Mudou Status" fica Inativo a partir do 1º dia da competência atual.
  await asOwner(A, async () => {
    await changeClientStatus({ clientId: inativo.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(COMP) }, TUDO);
  });

  // Cobranças: Face Love com uma vencida (ontem ou antes) em aberto; Zeta paga.
  const venc = new Date(Date.UTC(ANO, MES - 1, 1));
  const b1 = await createBilling(A, face.id, { month: MES, year: ANO, amount: 1500, dueDate: venc });
  const b2 = await createBilling(A, outro.id, { month: MES, year: ANO, amount: 800, dueDate: venc });
  const bB = await createBilling(B, deB.id, { month: MES, year: ANO, amount: 999, dueDate: venc });
  await asOwner(A, async () => {
    await prisma.billing.update({ where: { id: b2.id }, data: { status: "PAID", paidTotal: 800, paidAt: venc } });
    await prisma.payment.create({ data: { billingId: b2.id, amount: 800, paidAt: venc, method: "PIX" } });
  });

  // Despesas e upsell.
  const cat = await runWithoutScope(async () => await prisma.category.create({ data: { name: `Ferramentas ${TAG}`, kind: "despesa" } }));
  categoriaId = cat.id;
  const [d1] = await asOwner(A, async () => [
    await prisma.transaction.create({
      data: { type: "despesa", description: `Software ${TAG}`, amount: 300, date: new Date(`${COMP}-01T12:00:00Z`), dueDate: new Date(`${COMP}-01T00:00:00Z`), status: "pendente", belongsTo: "empresa", categoryId: cat.id },
    }),
    await prisma.transaction.create({
      data: { type: "despesa", description: `Aluguel ${TAG}`, amount: 2000, date: new Date(`${COMP}-01T12:00:00Z`), status: "pago", belongsTo: "empresa" },
    }),
    await prisma.transaction.create({
      data: { type: "receita", description: `Não é despesa ${TAG}`, amount: 50, date: new Date(`${COMP}-01T12:00:00Z`), status: "pago" },
    }),
  ]);
  const up = await asOwner(A, async () =>
    await prisma.upsell.create({ data: { clientId: face.id, value: 900, status: "NEGOTIATION", responsible: "Bianca", title: "Tráfego pago" } })
  );
  ids = { face: face.id, outro: outro.id, inativo: inativo.id, deB: deB.id, b1: b1.id, b2: b2.id, bB: bB.id, d1: d1.id, up: up.id };
});

afterAll(async () => {
  await runWithoutScope(async () => {
    for (const o of [A, B]) {
      await prisma.upsell.deleteMany({ where: { ownerId: o.id } });
      await prisma.transaction.deleteMany({ where: { ownerId: o.id } });
    }
    await prisma.category.deleteMany({ where: { id: categoriaId } });
  });
  await destroyOwner(A);
  await destroyOwner(B);
});

describe("contrato", () => {
  it("sucesso: success/data/meta com requestId e generatedAt", async () => {
    const r = await chamar(health, "/health");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, data: { status: "ok", apiVersion: "v1" } });
    expect(r.body.meta.requestId).toBe(r.headers.get("x-request-id"));
    expect(Date.parse(r.body.meta.generatedAt)).not.toBeNaN();
  });

  it("erro: success=false, code/message e requestId; sem token = 401", async () => {
    const r = await chamar(health, "/health", null);
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ success: false, error: { code: "missing_token" } });
    expect(typeof r.body.meta.requestId).toBe("string");
  });

  it("scope ausente = 403", async () => {
    const r = await chamar(clients, "/clients", tokenSoDashboard);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: "insufficient_scope", scope: "clients.read" });
  });

  it("parâmetro desconhecido ou inválido = 400 com os campos", async () => {
    const r1 = await chamar(clients, "/clients?statuss=ACTIVE");
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe("validation_error");
    const r2 = await chamar(clients, "/clients?competence=2026-13");
    expect(r2.status).toBe(400);
    expect(r2.body.error.details[0].field).toBe("competence");
    const r3 = await chamar(clients, "/clients?pageSize=1000");
    expect(r3.status).toBe(400);
  });

  it("parâmetro opcional em branco (ferramenta do n8n) conta como ausente", async () => {
    const r = await chamar(clients, `/clients?competence=&status=&search=${TAG}`);
    expect(r.status).toBe(200);
    expect(r.body.meta.statusReference.competence).toBe(COMP);
    expect((await chamar(clients, "/clients?naoExiste=")).status).toBe(400);
  });

  it("erro interno não expõe mensagem nem stack", async () => {
    const quebra = defineEndpoint({ action: "teste", scope: null }, async () => {
      throw new Error("SEGREDO_INTERNO em /var/app/lib.ts:42");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await quebra(new Request("http://localhost/api/v1/x", { headers: { authorization: `Bearer ${tokenTudo}` } }));
    spy.mockRestore();
    expect(res.status).toBe(500);
    const txt = await res.text();
    expect(txt).not.toContain("SEGREDO_INTERNO");
    expect(txt).not.toContain("lib.ts");
    expect(JSON.parse(txt)).toMatchObject({ success: false, error: { code: "internal_error" } });
  });
});

describe("clientes", () => {
  it("lista paginada, só do dono, com status da competência", async () => {
    const r = await chamar(clients, `/clients?search=${TAG}&pageSize=2`);
    expect(r.status).toBe(200);
    expect(r.body.meta.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const p2 = await chamar(clients, `/clients?search=${TAG}&pageSize=2&page=2`);
    const todos = [...r.body.data, ...p2.body.data].map((c: any) => c.id);
    expect(new Set(todos)).toEqual(new Set([ids.face, ids.outro, ids.inativo]));
    expect(todos).not.toContain(ids.deB);
  });

  it("STATUS TEMPORAL: a competência anterior mostra Ativo; a atual, Inativo", async () => {
    const ant = await chamar(clients, `/clients?search=Mudou%20Status%20${TAG}&competence=${ANTERIOR}`);
    expect(ant.body.data[0].status.code).toBe("ACTIVE");
    expect(ant.body.meta.statusReference.competence).toBe(ANTERIOR);
    const atual = await chamar(clients, `/clients?search=Mudou%20Status%20${TAG}&competence=${COMP}`);
    expect(atual.body.data[0].status.code).toBe("INACTIVE");
    const soAtivosAnt = await chamar(clients, `/clients?search=${TAG}&status=ACTIVE&competence=${ANTERIOR}`);
    expect(soAtivosAnt.body.data.map((c: any) => c.id)).toContain(ids.inativo);
    const soAtivosHoje = await chamar(clients, `/clients?search=${TAG}&status=ACTIVE`);
    expect(soAtivosHoje.body.data.map((c: any) => c.id)).not.toContain(ids.inativo);
  });

  it("filtros: modalidade, responsável, segmento e inadimplência", async () => {
    const tcv = await chamar(clients, `/clients?search=${TAG}&modality=TCV`);
    expect(tcv.body.data.map((c: any) => c.id)).toEqual([ids.outro]);
    const resp = await chamar(clients, `/clients?search=${TAG}&responsible=raiane`);
    expect(resp.body.data.map((c: any) => c.id)).toEqual([ids.face]);
    const seg = await chamar(clients, `/clients?search=${TAG}&segment=est%C3%A9tica`);
    expect(seg.body.data.map((c: any) => c.id)).toEqual([ids.face]);
    const devendo = await chamar(clients, `/clients?search=${TAG}&delinquency=owing`);
    expect(devendo.body.data.map((c: any) => c.id)).toEqual([ids.face]);
    const pago = await chamar(clients, `/clients?search=${TAG}&delinquency=paid`);
    expect(pago.body.data.map((c: any) => c.id)).toEqual([ids.outro]);
    // Documento mascarado na lista.
    expect(devendo.body.data[0].document).toBe("**.***.***/0001-90");
  });

  it("detalhe: documento completo, status atual e da competência; outro dono = 404", async () => {
    const r = await chamar(client, `/clients/${ids.inativo}?competence=${ANTERIOR}`, tokenTudo, { id: ids.inativo });
    expect(r.status).toBe(200);
    expect(r.body.data.status.current.code).toBe("INACTIVE");
    expect(r.body.data.status.atCompetence).toMatchObject({ competence: ANTERIOR, status: { code: "ACTIVE" } });
    const f = await chamar(client, `/clients/${ids.face}`, tokenTudo, { id: ids.face });
    expect(f.body.data.document).toBe("12.345.678/0001-90");
    const deB = await chamar(client, `/clients/${ids.deB}`, tokenTudo, { id: ids.deB });
    expect(deB.status).toBe(404);
    expect(deB.body.error.code).toBe("not_found");
  });

  it("histórico de status: intervalos de vigência; outro dono = 404", async () => {
    const r = await chamar(statusHistory, `/clients/${ids.inativo}/status-history`, tokenTudo, { id: ids.inativo });
    expect(r.status).toBe(200);
    const st = r.body.data.intervals.map((i: any) => i.status.code);
    expect(st).toContain("ACTIVE");
    expect(st).toContain("INACTIVE");
    expect(r.body.data.currentStatus.code).toBe("INACTIVE");
    const deB = await chamar(statusHistory, `/clients/${ids.deB}/status-history`, tokenTudo, { id: ids.deB });
    expect(deB.status).toBe(404);
  });
});

describe("busca", () => {
  it("'face love' acha o cliente do dono, sem acento/caixa, com documento mascarado", async () => {
    const r = await chamar(search, `/search?q=face%20love%20${TAG}&type=client`);
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: any) => x.id)).toEqual([ids.face]);
    const hit = r.body.data[0];
    expect(Object.keys(hit).sort()).toEqual(["document", "id", "legalName", "modality", "name", "score", "status", "type"]);
    expect(hit).toMatchObject({ legalName: "Face Love Clínica Ltda", document: "**.***.***/0001-90", status: { code: "ACTIVE" }, modality: "MRR" });
    const semAcento = await chamar(search, `/search?q=FACELOVE%20ESTETICA%20${TAG}`);
    expect(semAcento.body.data.map((x: any) => x.id)).toContain(ids.face);
  });

  it("serializadores de data aceitam o texto que o cache devolve (ownerCached)", async () => {
    const { instante } = await import("@/lib/api/http");
    const { dia } = await import("@/lib/api/v1/common");
    const d = new Date("2026-09-10T00:00:00.000Z");
    expect(instante(d.toISOString() as any)).toBe(d.toISOString());
    expect(dia(d.toISOString() as any)).toBe(dia(d));
    expect(instante("lixo" as any)).toBeNull();
    expect(dia(null)).toBeNull();
  });

  it("pontuação e máscara", () => {
    const c = { id: "1", name: "Face Love Estética", legalName: "Face Love Clínica Ltda", document: "12345678000190", modality: "MRR" };
    expect(pontuar(c, "face love estética")).toBe(100);
    expect(pontuar(c, "face")).toBeGreaterThan(pontuar(c, "clinica"));
    expect(pontuar(c, "xyz")).toBe(0);
    expect(mascararDocumento("123.456.789-01")).toBe("***.***.***-01");
    expect(mascararDocumento(null)).toBeNull();
  });

  it("q curto demais = 400", async () => {
    expect((await chamar(search, "/search?q=a")).status).toBe(400);
  });
});

describe("recebimentos", () => {
  it("status derivado (vencido) sem gravar nada; filtro open; só do dono", async () => {
    const r = await chamar(receivables, `/receivables?clientId=${ids.face}`);
    expect(r.status).toBe(200);
    const b = r.body.data.find((x: any) => x.id === ids.b1);
    expect(b.openAmount).toBe(1500);
    if (HOJE > `${COMP}-01`) expect(b.status.code).toBe("OVERDUE");
    const cru = await runWithoutScope(async () => await prisma.billing.findUnique({ where: { id: ids.b1 } }));
    expect(cru!.status).toBe("PENDING"); // leitura não escreveu
    const abertas = await chamar(receivables, `/receivables?status=open&competence=${COMP}`);
    const idsAbertas = abertas.body.data.map((x: any) => x.id);
    expect(idsAbertas).toContain(ids.b1);
    expect(idsAbertas).not.toContain(ids.b2);
    expect(idsAbertas).not.toContain(ids.bB);
    const pagas = await chamar(receivables, `/receivables?status=PAID,PAID_LATE`);
    expect(pagas.body.data.map((x: any) => x.id)).toContain(ids.b2);
  });

  it("janela por data de vencimento; dateFrom sem dateTo = 400", async () => {
    const r = await chamar(receivables, `/receivables?dateFrom=${COMP}-01&dateTo=${COMP}-01`);
    expect(r.body.data.map((x: any) => x.id)).toEqual(expect.arrayContaining([ids.b1, ids.b2]));
    expect(r.body.meta.window).toEqual({ dateFrom: `${COMP}-01`, dateTo: `${COMP}-01` });
    expect((await chamar(receivables, `/receivables?dateFrom=${COMP}-01`)).status).toBe(400);
  });

  it("detalhe com pagamentos; de outro dono = 404", async () => {
    const r = await chamar(receivable, `/receivables/${ids.b2}`, tokenTudo, { id: ids.b2 });
    expect(r.body.data.payments).toHaveLength(1);
    expect(r.body.data.payments[0].amount).toBe(800);
    expect((await chamar(receivable, `/receivables/${ids.bB}`, tokenTudo, { id: ids.bB })).status).toBe(404);
  });
});

describe("despesas, caixa e upsell", () => {
  it("despesas do mês: só type=despesa; filtro de status e categoria por nome", async () => {
    const r = await chamar(expenses, "/expenses");
    const desc = r.body.data.map((x: any) => x.description);
    expect(desc).toEqual(expect.arrayContaining([`Software ${TAG}`, `Aluguel ${TAG}`]));
    expect(desc).not.toContain(`Não é despesa ${TAG}`);
    const cat = await chamar(expenses, `/expenses?category=ferramentas%20${TAG}`);
    expect(cat.body.data.map((x: any) => x.id)).toEqual([ids.d1]);
    const pagas = await chamar(expenses, "/expenses?status=pago");
    expect(pagas.body.data.every((x: any) => x.rawStatus === "pago")).toBe(true);
    const det = await chamar(expense, `/expenses/${ids.d1}`, tokenTudo, { id: ids.d1 });
    expect(det.body.data).toMatchObject({ amount: 300, category: { name: `Ferramentas ${TAG}` } });
  });

  it("caixa: resumo numérico", async () => {
    const r = await chamar(cash, "/cash/summary");
    expect(r.status).toBe(200);
    expect(typeof r.body.data.available).toBe("number");
    expect(typeof r.body.data.projection.projectedBalance).toBe("number");
  });

  it("upsell: filtros por status, cliente e responsável", async () => {
    const r = await chamar(upsells, `/upsells?status=NEGOTIATION&clientId=${ids.face}&responsible=bianca`);
    expect(r.body.data.map((x: any) => x.id)).toEqual([ids.up]);
    expect(r.body.data[0]).toMatchObject({ value: 900, client: { id: ids.face } });
    const nada = await chamar(upsells, `/upsells?status=WON&clientId=${ids.face}`);
    expect(nada.body.data).toEqual([]);
  });
});

describe("painéis e relatórios", () => {
  it("dashboard: indicadores oficiais da competência", async () => {
    const r = await chamar(dashboard, `/dashboard/summary?competence=${COMP}`);
    expect(r.status).toBe(200);
    expect(r.body.data.competence).toBe(COMP);
    expect(r.body.data.metrics.mrr_oficial).toMatchObject({ unit: "currency" });
    expect(r.body.data.metrics.clientes_ativos.unit).toBe("count");
  });

  it("rotina: com só routine.read, as seções de outras áreas vêm vazias", async () => {
    const r = await chamar(routine, "/routine/daily", tokenRotina);
    expect(r.status).toBe(200);
    expect(r.body.data.collections.overdue).toEqual([]);
    expect(r.body.data.payments.overdue).toEqual([]);
    expect(r.body.data.cash).toBeNull();
    const cheia = await chamar(routine, "/routine/daily");
    expect(cheia.status).toBe(200);
  });

  it("relatório diário: seções sem scope são omitidas", async () => {
    const r = await chamar(reportsDaily, `/reports/daily?date=${COMP}-01`);
    expect(r.status).toBe(200);
    expect(r.body.meta.omittedSections).toEqual([]);
    expect(r.body.data.receivables.dueToday.items.map((x: any) => x.id)).toEqual(expect.arrayContaining([ids.b1, ids.b2]));
    expect(r.body.data.receivables.received).toMatchObject({ count: 1, amount: 800 });
    expect(r.body.data.receivables.received.items.map((x: any) => x.billingId)).toContain(ids.b2);
    const diaAnterior = new Date(Date.UTC(ANO, MES - 1, 0)).toISOString().slice(0, 10);
    const anterior = await chamar(reportsDaily, `/reports/daily?date=${diaAnterior}`);
    expect(anterior.status).toBe(200);
    expect(anterior.body.data.receivables.received.items.map((x: any) => x.billingId)).not.toContain(ids.b2);
    const soRel = await chave(A, ["reports.read"]);
    const parcial = await chamar(reportsDaily, `/reports/daily?date=${COMP}-01`, soRel);
    expect(parcial.body.meta.omittedSections).toEqual(["receivables", "expenses", "clients", "upsells"]);
    expect(parcial.body.data.receivables).toBeUndefined();
  });

  it("relatório diário de HOJE: despesa paga no dia (trilha), clientes cadastrados, status registrados e upsells criados", async () => {
    const { setExpenseStatus } = await import("@/lib/engines/expense-engine");
    const hojeDesp = await asOwner(A, async () =>
      await prisma.transaction.create({
        data: { type: "despesa", description: `Paga hoje ${TAG}`, amount: 77, date: new Date(`${COMP}-02T12:00:00Z`), dueDate: new Date(`${COMP}-02T00:00:00Z`), status: "pendente", belongsTo: "empresa" },
      })
    );
    const r1 = await asOwner(A, async () => await setExpenseStatus(hojeDesp.id, "pago"));
    expect(r1.ok).toBe(true);
    const r = await chamar(reportsDaily, `/reports/daily?date=${HOJE}`);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.expenses.paid.items.map((x: any) => x.id)).toContain(hojeDesp.id);
    expect(d.expenses.paid.amount).toBeGreaterThanOrEqual(77);
    expect(d.clients.createdClients.map((c: any) => c.id)).toEqual(expect.arrayContaining([ids.face, ids.outro, ids.inativo]));
    expect(d.clients.statusChangesRecorded.some((m: any) => m.client.id === ids.inativo && m.status.code === "INACTIVE")).toBe(true);
    expect(d.upsells.created.items.map((u: any) => u.id)).toContain(ids.up);
    // O dia de ontem não vê nada disso.
    const ontem = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const r0 = await chamar(reportsDaily, `/reports/daily?date=${ontem}`);
    expect(r0.body.data.expenses.paid.items.map((x: any) => x.id)).not.toContain(hojeDesp.id);
  });

  it("relatório mensal: fechamento, carteira pela competência e recebimentos", async () => {
    const r = await chamar(reportsMonthly, `/reports/monthly?competence=${COMP}`);
    expect(r.status).toBe(200);
    expect(r.body.data.closing.state).toBeTruthy();
    const inativos = r.body.data.portfolio.byStatus.find((s: any) => s.status.code === "INACTIVE");
    expect(inativos?.count).toBeGreaterThanOrEqual(1);
    expect(r.body.data.receivables.count).toBe(2);
  });
});
