import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import {
  prisma, runWithoutScope, asOwner, createOwner, destroyOwner, createMrrClient, createBilling, type TestOwner,
} from "./support/db";
import type { Principal } from "@/lib/auth/owner-scope";

/**
 * INADIMPLÊNCIA NA API (29/09/2026) — correção da divergência Telegram × tela.
 *
 * O agente respondia "não há inadimplentes" porque consultava UMA competência
 * (a atual) e só o status DELINQUENT (= escaladas manualmente). A posição
 * atual agora vem de GET /receivables/delinquency, com a MESMA regra e a
 * MESMA função da tela /inadimplencia (filtroDeCobrancaVencida +
 * getDelinquentClients), sem escrever nada na leitura.
 */

vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

import { criarIntegracao } from "@/lib/services/service-accounts";
import { vincularIdentidade } from "@/lib/services/messaging-identities";
import { getDelinquentClients, markOverdueBillings } from "@/lib/services/billing-metrics";
import { posicaoDeInadimplenciaApi } from "@/lib/api/v1/delinquency";
import { API_SCOPES } from "@/lib/api/scopes";
import { hojeCivil } from "@/lib/civil-date";
import * as inad from "@/app/api/v1/receivables/delinquency/route";
import * as recebiveis from "@/app/api/v1/receivables/route";
import * as rotina from "@/app/api/v1/routine/daily/route";
import * as resolve from "@/app/api/v1/integrations/resolve-identity/route";

const TAG = randomUUID().slice(0, 6);
const HOJE = hojeCivil();
const DIA = 86_400_000;
const diasAtras = (n: number) => new Date(HOJE.getTime() - n * DIA);
const comp = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });

let A: TestOwner;
let B: TestOwner;
const tok: Record<string, string> = {};
const c: Record<string, string> = {};
const b: Record<string, string> = {};
const u: Record<string, string> = {};
const idt: Record<string, string> = {};
const tg: Record<string, string> = {};

const admin = (o: TestOwner): Principal => ({
  kind: "user", origin: "UI",
  user: { id: o.id, name: "Admin", email: o.email, role: "ADMIN", permissions: [], workspaceOwnerId: null },
});

async function cobranca(o: TestOwner, cliente: string, chave: string, dueDate: Date, valor: number, extra: Record<string, unknown> = {}) {
  const { year, month } = comp(dueDate);
  const r = await createBilling(o, cliente, { month, year, amount: valor, dueDate, revenueType: "ONE_TIME", description: `${chave} ${TAG}` });
  if (Object.keys(extra).length) await runWithoutScope(async () => await prisma.billing.update({ where: { id: r.id }, data: extra as any }));
  b[chave] = r.id;
}

type Resp = { status: number; body: any };
async function chamar(h: (req: Request, r?: any) => Promise<Response>, path: string, o: { token?: string | null; identidade?: string } = {}): Promise<Resp> {
  const headers: Record<string, string> = { "x-b2c-source": "telegram" };
  if (o.token !== null) headers.authorization = `Bearer ${o.token ?? tok.A}`;
  if (o.identidade) headers["x-b2c-identity"] = o.identidade;
  const res = await h(new Request(`http://localhost/api/v1${path}`, { method: "GET", headers }));
  return { status: res.status, body: await res.json() };
}

/** Só os clientes desta fixture (o banco de teste é compartilhado). */
const daFixture = (itens: { client: { id: string } }[]) => itens.filter((i) => Object.values(c).includes(i.client.id));

beforeAll(async () => {
  A = await createOwner();
  B = await createOwner();
  for (const [o, k, scopes] of [[A, "A", API_SCOPES], [B, "B", API_SCOPES], [A, "semLeitura", ["clients.read"]]] as const) {
    const r = await criarIntegracao({ ownerId: o.id, principal: admin(o) }, { name: `inad-${k}-${TAG}`, scopes: [...scopes], expiresInDays: null });
    if (!r.ok) throw new Error(r.error);
    tok[k] = r.token;
  }
  const mk = async (k: string, nome: string) => (c[k] = (await createMrrClient(A, { name: `${nome} ${TAG}` })).id);
  await mk("anterior", "Z Anterior");       // vencida de competência anterior, ainda PENDING no banco
  await mk("atual", "Y Atual");             // vencida do mês (já OVERDUE)
  await mk("hoje", "Vence Hoje");           // vence hoje → não é inadimplência
  await mk("futura", "Futura");             // a vencer
  await mk("parcial", "X Parcial");         // parcial vencida → saldo restante
  await mk("quitada", "Quitada");
  await mk("removida", "Removida");
  await mk("renegociada", "Renegociada");
  await mk("dupla", "W Dupla");             // duas vencidas do mesmo cliente
  await mk("foraDaFila", "V Fora da Fila"); // retirado da fila da Rotina hoje
  await cobranca(A, c.anterior, "anterior", diasAtras(40), 900);
  await cobranca(A, c.atual, "atual", diasAtras(3), 300, { status: "OVERDUE" });
  await cobranca(A, c.hoje, "hoje", diasAtras(0), 500);
  await cobranca(A, c.futura, "futura", diasAtras(-10), 500);
  await cobranca(A, c.parcial, "parcial", diasAtras(10), 1000, { status: "PARTIAL", paidTotal: 400 });
  await cobranca(A, c.quitada, "quitada", diasAtras(20), 800, { status: "PAID", paidTotal: 800, paidAt: diasAtras(19) });
  await cobranca(A, c.removida, "removida", diasAtras(20), 800, { status: "CANCELED", canceledAt: new Date() });
  await cobranca(A, c.renegociada, "renegociada", diasAtras(20), 800, { status: "RENEGOTIATED" });
  await cobranca(A, c.dupla, "dupla1", diasAtras(15), 500);
  await cobranca(A, c.dupla, "dupla2", diasAtras(45), 700, { status: "OVERDUE" });
  await cobranca(A, c.foraDaFila, "foraDaFila", diasAtras(5), 250);
  const dia = new Date(); dia.setHours(0, 0, 0, 0);
  await runWithoutScope(async () =>
    await prisma.routineItemState.create({ data: { routineDate: dia, itemType: "cobranca", itemKey: c.foraDaFila, status: "removed", ownerId: A.id } })
  );
  // Outro workspace com inadimplência própria.
  const cb = (await createMrrClient(B, { name: `De B ${TAG}` })).id;
  await cobranca(B, cb, "deB", diasAtras(30), 9999);

  // Pessoas (Telegram): Financeiro vê inadimplência; Administrativo vê recebimentos mas não inadimplência.
  for (const [k, role] of [["fin", "FINANCEIRO"], ["adm", "ADMINISTRATIVO"]] as const) {
    u[k] = (await runWithoutScope(async () =>
      await prisma.user.create({ data: { name: `${k} ${TAG}`, email: `${k}-${randomUUID()}@b2c.local`, passwordHash: "x", role, workspaceOwnerId: A.id }, select: { id: true } })
    )).id;
    tg[k] = String(730000000 + Math.floor(Math.random() * 9_999_999));
    const v = await vincularIdentidade({ ownerId: A.id, principal: admin(A) }, { userId: u[k], channel: "TELEGRAM", externalIdentifier: tg[k] });
    if (!v.ok) throw new Error(v.error);
    idt[k] = v.id;
  }
});
afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.routineItemState.deleteMany({ where: { ownerId: A.id } });
    for (const o of [A, B]) await prisma.messagingIdentity.deleteMany({ where: { ownerId: o.id } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
  });
  await destroyOwner(A);
  await destroyOwner(B);
});

// ---------------------------------------------------------------------------

describe("regra: posição atual, todas as competências, sem escrever", () => {
  it("entra: vencida anterior (ainda PENDING), vencida do mês, parcial (saldo), cliente com duas; sai: hoje, futura, quitada, removida, renegociada", async () => {
    const r = await chamar(inad.GET, "/receivables/delinquency?pageSize=200");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const porCliente = Object.fromEntries(daFixture(r.body.data).map((i: any) => [i.client.id, i]));
    expect(Object.keys(porCliente).sort()).toEqual([c.anterior, c.atual, c.parcial, c.dupla, c.foraDaFila].sort());
    expect(porCliente[c.anterior]).toMatchObject({ overdueAmount: 900, billingCount: 1, daysOverdue: 40, agingBucket: "31-60" });
    expect(porCliente[c.atual]).toMatchObject({ overdueAmount: 300, billingCount: 1, daysOverdue: 3 });
    expect(porCliente[c.parcial]).toMatchObject({ overdueAmount: 600, billingCount: 1 });
    // Duas cobranças do mesmo cliente: UM cliente, saldo somado, atraso da mais antiga.
    expect(porCliente[c.dupla]).toMatchObject({ overdueAmount: 1200, billingCount: 2, daysOverdue: 45, agingBucket: "31-60" });
    // Sem dado pessoal além do nome.
    expect(Object.keys(porCliente[c.dupla]).sort()).toEqual(["agingBucket", "billingCount", "client", "daysOverdue", "oldestDueDate", "overdueAmount"]);
    expect(Object.keys(porCliente[c.dupla].client).sort()).toEqual(["id", "name"]);
    expect(r.body.meta).toMatchObject({ scope: { kind: "all_open", competence: null } });
    expect(r.body.meta.asOf).toBe(HOJE.toISOString().slice(0, 10));
    expect(r.body.meta.rule).toContain("Mesma regra da tela");
  });

  it("GET não grava: a cobrança vencida ainda PENDING continua PENDING depois da leitura", async () => {
    await chamar(inad.GET, "/receivables/delinquency");
    const s = await runWithoutScope(async () => await prisma.billing.findUnique({ where: { id: b.anterior }, select: { status: true } }));
    expect(s!.status).toBe("PENDING");
  });

  it("tela × API com a MESMA fixture e o MESMO instante: mesmos clientes, saldos, contagens e ordem; e igual à tela depois da marcação", async () => {
    const agora = new Date();
    const api = await asOwner(A, async () => await posicaoDeInadimplenciaApi({ page: 1, pageSize: 200, agora }));
    const tela = await asOwner(A, async () => await getDelinquentClients({ agora }));
    const resumo = (l: { id: string; v: number; n: number; d: number }[]) => l.filter((x) => Object.values(c).includes(x.id));
    const daApi = resumo(api.itens.map((i) => ({ id: i.client.id, v: i.overdueAmount, n: i.billingCount, d: i.daysOverdue })));
    const daTela = resumo(tela.map((t) => ({ id: t.clientId, v: t.totalOverdue, n: t.billingCount, d: t.daysOverdue })));
    expect(daApi).toEqual(daTela);
    // A tela grava OVERDUE antes de ler (markOverdueBillings); a leitura derivada dá o mesmo conjunto.
    await asOwner(A, async () => { await markOverdueBillings(); });
    const telaDepois = await asOwner(A, async () => await getDelinquentClients({ agora }));
    expect(resumo(telaDepois.map((t) => ({ id: t.clientId, v: t.totalOverdue, n: t.billingCount, d: t.daysOverdue })))).toEqual(daApi);
    await runWithoutScope(async () => await prisma.billing.update({ where: { id: b.anterior }, data: { status: "PENDING" } }));
  });

  it("cliente retirado da fila da Rotina hoje continua na inadimplência global", async () => {
    const adminIdt = (await vincularIdentidade({ ownerId: A.id, principal: admin(A) }, { userId: A.id, channel: "TELEGRAM", externalIdentifier: String(740000000 + Math.floor(Math.random() * 9_999_999)) }));
    if (!adminIdt.ok) throw new Error(adminIdt.error);
    const rot = await chamar(rotina.GET, "/routine/daily", { identidade: adminIdt.id });
    expect(rot.status).toBe(200);
    const naFila = (rot.body.data.collections?.overdue ?? []).map((q: any) => q.client.id);
    // A fila está preenchida com vencidos desta fixture (é uma seleção priorizada, não a lista completa)…
    expect(naFila.filter((id: string) => Object.values(c).includes(id)).length).toBeGreaterThan(0);
    expect(naFila).not.toContain(c.foraDaFila); // …mas sem o cliente retirado hoje
    const r = await chamar(inad.GET, "/receivables/delinquency?pageSize=200");
    expect(daFixture(r.body.data).map((i: any) => i.client.id)).toContain(c.foraDaFila);
  });

  it("recorte por competência: só as cobranças daquela competência vencidas hoje, e diz o recorte", async () => {
    const { year, month } = comp(diasAtras(40));
    const k = `${year}-${String(month).padStart(2, "0")}`;
    const r = await chamar(inad.GET, `/receivables/delinquency?competence=${k}&pageSize=200`);
    expect(r.status).toBe(200);
    expect(r.body.meta.scope).toMatchObject({ kind: "competence", competence: k });
    const ids = daFixture(r.body.data).map((i: any) => i.client.id);
    expect(ids).toContain(c.anterior);
    expect(ids).not.toContain(c.atual);
    // Competência sem nada vencido: sucesso com zero — recorte, não ausência global.
    const vazio = await chamar(inad.GET, "/receivables/delinquency?competence=2099-01");
    expect(vazio.status).toBe(200);
    expect(vazio.body.meta.totals).toEqual({ clients: 0, overdueAmount: 0, billings: 0 });
    expect(vazio.body.meta.scope.kind).toBe("competence");
  });

  it("a consulta antiga (competência atual + DELINQUENT) não enxerga a inadimplência — por isso a divergência", async () => {
    const antiga = await chamar(recebiveis.GET, "/receivables?status=DELINQUENT&pageSize=200");
    const idsAntiga = antiga.body.data.map((x: any) => x.client.id);
    for (const k of ["anterior", "atual", "parcial", "dupla"]) expect(idsAntiga).not.toContain(c[k]);
    const nova = await chamar(inad.GET, "/receivables/delinquency?pageSize=200");
    expect(daFixture(nova.body.data).length).toBe(5);
  });
});

describe("paginação e totais", () => {
  it("totais e contagem do filtro inteiro em todas as páginas; páginas sem sobreposição e ordem determinística", async () => {
    const tudo = await chamar(inad.GET, "/receivables/delinquency?pageSize=200");
    const total = tudo.body.meta.totals;
    expect(total.clients).toBe(tudo.body.data.length);
    expect(total.overdueAmount).toBeCloseTo(tudo.body.data.reduce((s: number, i: any) => s + i.overdueAmount, 0), 2);
    expect(total.billings).toBe(tudo.body.data.reduce((s: number, i: any) => s + i.billingCount, 0));
    const paginas: any[] = [];
    for (let p = 1; p <= Math.ceil(total.clients / 2); p++) {
      const r = await chamar(inad.GET, `/receivables/delinquency?pageSize=2&page=${p}`);
      expect(r.body.meta.totals).toEqual(total);
      expect(r.body.meta.pagination).toMatchObject({ page: p, pageSize: 2, total: total.clients });
      paginas.push(...r.body.data);
    }
    expect(paginas.map((i) => i.client.id)).toEqual(tudo.body.data.map((i: any) => i.client.id));
    expect(new Set(paginas.map((i) => i.client.id)).size).toBe(paginas.length);
    const valores = paginas.map((i) => i.overdueAmount);
    expect([...valores].sort((a, b2) => b2 - a)).toEqual(valores);
  });
});

describe("isolamento, autenticação e permissão", () => {
  it("outro workspace não aparece e não vê", async () => {
    const r = await chamar(inad.GET, "/receivables/delinquency?pageSize=200");
    expect(r.body.data.some((i: any) => i.client.name === `De B ${TAG}`)).toBe(false);
    const deB = await chamar(inad.GET, "/receivables/delinquency?pageSize=200", { token: tok.B });
    expect(deB.body.data.map((i: any) => i.client.id).some((id: string) => Object.values(c).includes(id))).toBe(false);
    expect(deB.body.data.some((i: any) => i.client.name === `De B ${TAG}`)).toBe(true);
  });

  it("sem token = 401; sem receivables.read = 403; parâmetro desconhecido = 400", async () => {
    expect((await chamar(inad.GET, "/receivables/delinquency", { token: null })).status).toBe(401);
    const s = await chamar(inad.GET, "/receivables/delinquency", { token: tok.semLeitura });
    expect(s.status).toBe(403);
    expect(s.body.error.code).toBe("insufficient_scope");
    expect((await chamar(inad.GET, "/receivables/delinquency?status=DELINQUENT")).status).toBe(400);
  });

  it("Telegram: Financeiro (Ver inadimplência) acessa; Administrativo (vê recebimentos, não inadimplência) = 403", async () => {
    const fin = await chamar(inad.GET, "/receivables/delinquency", { identidade: idt.fin });
    expect(fin.status).toBe(200);
    expect(fin.body.meta.onBehalfOf).toEqual({ identityId: idt.fin });
    const adm = await chamar(inad.GET, "/receivables/delinquency", { identidade: idt.adm });
    expect(adm.status).toBe(403);
    expect(adm.body.error.code).toBe("user_forbidden");
  });

  it("resolve-identity inclui recebimentos.ver_inadimplencia só para quem tem", async () => {
    const res = async (id: string) => {
      const r = await resolve.POST(new Request("http://localhost/api/v1/integrations/resolve-identity", {
        method: "POST", headers: { authorization: `Bearer ${tok.A}`, "content-type": "application/json" },
        body: JSON.stringify({ channel: "TELEGRAM", externalIdentifier: id }),
      }));
      return (await r.json()).data;
    };
    const fin = await res(tg.fin);
    expect(fin.permissions).toContain("recebimentos.ver_inadimplencia");
    expect(fin.allowedScopes).toContain("receivables.read");
    const adm = await res(tg.adm);
    expect(adm.permissions).not.toContain("recebimentos.ver_inadimplencia");
    expect(adm.allowedScopes).toContain("receivables.read"); // o scope sozinho não basta
  });
});

describe("ausência real", () => {
  it("workspace sem nada vencido: sucesso, lista vazia e totais zero (e escopo total)", async () => {
    const C = await createOwner();
    try {
      const r0 = await criarIntegracao({ ownerId: C.id, principal: admin(C) }, { name: `inad-C-${TAG}`, scopes: API_SCOPES, expiresInDays: null });
      if (!r0.ok) throw new Error(r0.error);
      const cl = (await createMrrClient(C, { name: `Em dia ${TAG}` })).id;
      await createBilling(C, cl, { ...comp(diasAtras(-5)), amount: 100, dueDate: diasAtras(-5), revenueType: "ONE_TIME" });
      const r = await chamar(inad.GET, "/receivables/delinquency", { token: r0.token });
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual([]);
      expect(r.body.meta.totals).toEqual({ clients: 0, overdueAmount: 0, billings: 0 });
      expect(r.body.meta.scope.kind).toBe("all_open");
    } finally {
      await destroyOwner(C);
    }
  });
});
