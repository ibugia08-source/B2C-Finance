import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, asOwner, type TestOwner,
} from "./support/db";
import {
  addCalendarMonths, calendarParts, civilParts, competenceKeyOf, currentYearMonth, expectationFromBase,
  expectationInMonth, fromMonthIndex, monthBounds, monthIndex, renewalCompetenceOptions,
  rollForward, toCompetenceKey, zonedDate,
} from "@/lib/renewal-expectation";

/**
 * RENOVAÇÕES POR DATA DE EXPECTATIVA (25/09/2026).
 *
 * Regra do dono: data de entrada + prazo do contrato = data de expectativa
 * de renovação. O módulo lista os clientes com expectativa no mês; os
 * desfechos (renovou / não renovou) contam no mês da expectativa; o módulo,
 * a Gestão do Mês, a Visão geral, a faixa, o gráfico e a rotina leem o MESMO
 * livro.
 */

vi.mock("@/lib/auth/viewer", () => {
  const v = { id: "teste", name: "Teste", email: "teste@b2c.local", role: "ADMIN", permissions: [], personId: null };
  return {
    requirePermission: async () => v,
    tryPermission: async () => v,
    getViewer: async () => v,
    NO_PERMISSION: { ok: false, error: "Sem permissão." },
    can: () => true,
  };
});
vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {}, revalidateFinance: () => {}, revalidateClients: () => {},
}));
vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

const HOJE = currentYearMonth();
const COMP_HOJE = toCompetenceKey(HOJE);
const PROX = fromMonthIndex(monthIndex(HOJE) + 1);
const ANT = fromMonthIndex(monthIndex(HOJE) - 1);

let owner: TestOwner;
let svc: typeof import("@/lib/services/renewal-schedule");
let metrics: typeof import("@/lib/services/renewal-metrics");
let outlook: typeof import("@/lib/services/revenue-metrics")["getRenewalOutlook"];
let cardDetail: typeof import("@/lib/services/dashboard-main")["getRenewalClientsDetail"];
let acoes: typeof import("@/lib/actions/renewals");
let clientes: typeof import("@/lib/actions/clients");

beforeAll(async () => {
  owner = await createOwner();
  svc = await import("@/lib/services/renewal-schedule");
  metrics = await import("@/lib/services/renewal-metrics");
  ({ getRenewalOutlook: outlook } = await import("@/lib/services/revenue-metrics"));
  ({ getRenewalClientsDetail: cardDetail } = await import("@/lib/services/dashboard-main"));
  acoes = await import("@/lib/actions/renewals");
  clientes = await import("@/lib/actions/clients");
});
afterAll(async () => {
  await destroyOwner(owner);
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Cliente com entrada e prazo cuja expectativa cai no mês `alvo`. */
async function clienteQueRenovaEm(
  nome: string,
  alvo: { year: number; month: number },
  extra: Record<string, unknown> = {}
) {
  const prazo = 12;
  const entrada = zonedDate(alvo.year - 1, alvo.month, 10);
  const c = await createMrrClient(owner, { name: nome, monthlyValue: 1000, startedAt: entrada });
  await asOwner(owner, async () =>
    prisma.client.update({
      where: { id: c.id },
      data: {
        contractMonths: prazo,
        expectedRenewalAt: expectationFromBase(entrada, prazo, zonedDate(alvo.year, alvo.month, 1)),
        ...extra,
      },
    })
  );
  return c;
}

describe("regra pura — entrada + prazo", () => {
  it("expectativa = entrada + prazo, no calendário da Bahia", () => {
    const ref = zonedDate(2026, 1, 15);
    const e = expectationFromBase(zonedDate(2026, 3, 10), 12, ref)!;
    expect(calendarParts(e)).toEqual({ year: 2027, month: 3, day: 10 });
    // Meio-dia local: o dia não "volta" no servidor em UTC.
    expect(e.toISOString()).toBe("2027-03-10T15:00:00.000Z");
  });

  it("ciclo que já passou anda em passos de prazo até o mês corrente", () => {
    const ref = zonedDate(2026, 9, 25);
    // Entrou em mar/2024, prazo 12: mar/25 e mar/26 passaram → mar/2027.
    expect(competenceKeyOf(expectationFromBase(zonedDate(2024, 3, 10), 12, ref)!)).toBe("2027-03");
    // Prazo 6 a partir de jan/2026: jul/2026 passou → jan/2027.
    expect(competenceKeyOf(expectationFromBase(zonedDate(2026, 1, 5), 6, ref)!)).toBe("2027-01");
    // Expectativa no próprio mês corrente fica nele.
    expect(competenceKeyOf(expectationFromBase(zonedDate(2025, 9, 30), 12, ref)!)).toBe("2026-09");
  });

  it("entrada gravada à meia-noite UTC (servidor) não escorrega para o dia anterior", () => {
    // 01/03/2026 criado na Vercel = 2026-03-01T00:00Z = 28/02 21h na Bahia.
    const e = expectationFromBase(new Date(Date.UTC(2026, 2, 1)), 12, zonedDate(2026, 9, 1))!;
    expect(civilParts(e)).toEqual({ year: 2027, month: 3, day: 1 });
    // E a de 03:00 UTC (meia-noite da Bahia) dá o mesmo dia.
    const e2 = expectationFromBase(new Date(Date.UTC(2026, 2, 1, 3)), 12, zonedDate(2026, 9, 1))!;
    expect(e2.getTime()).toBe(e.getTime());
  });

  it("sem entrada ou sem prazo não há expectativa", () => {
    expect(expectationFromBase(null, 12)).toBeNull();
    expect(expectationFromBase(new Date(), null)).toBeNull();
    expect(expectationFromBase(new Date(), 0)).toBeNull();
  });

  it("31 de janeiro + 1 mês = último dia de fevereiro", () => {
    expect(calendarParts(addCalendarMonths(zonedDate(2027, 1, 31), 1))).toEqual({ year: 2027, month: 2, day: 28 });
    expect(calendarParts(rollForward(zonedDate(2026, 1, 31), 1, zonedDate(2026, 2, 3)))).toEqual({ year: 2026, month: 2, day: 28 });
  });

  it("agendar num mês usa o dia do ciclo do cliente", () => {
    const d = expectationInMonth({ year: 2027, month: 2 }, zonedDate(2025, 5, 30));
    expect(calendarParts(d)).toEqual({ year: 2027, month: 2, day: 28 });
    expect(calendarParts(expectationInMonth({ year: 2027, month: 4 }, null)).day).toBe(1);
  });

  it("limites do mês no fuso da Bahia", () => {
    const { start, end } = monthBounds({ year: 2026, month: 9 });
    expect(start.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });

  it("opções de mês incluem o valor gravado mesmo fora da janela", () => {
    const opts = renewalCompetenceOptions("2020-01");
    expect(opts[0]).toEqual({ value: "2020-01", label: "Jan/2020" });
    expect(opts.some((o) => o.value === COMP_HOJE)).toBe(true);
  });
});

describe("cadastro calcula e preserva a expectativa", () => {
  it("criar com entrada + prazo grava a expectativa; editar outro campo não mexe; mudar o prazo refaz", async () => {
    const entrada = zonedDate(HOJE.year, HOJE.month, 5);
    const r = await asOwner(owner, async () =>
      clientes.saveClient(form({
        name: "Cadastro Base", status: "ACTIVE", paymentModel: "MRR",
        monthlyValue: "900,00", paymentDay: "5", contractMonths: "6",
        startedAt: `${String(calendarParts(entrada).day).padStart(2, "0")}/${String(HOJE.month).padStart(2, "0")}/${HOJE.year}`,
      }))
    );
    expect(r.ok, (r as any).error).toBe(true);
    const id = (r as any).id as string;
    const ler = () => runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id }, select: { expectedRenewalAt: true } })
    );
    const esperado = toCompetenceKey(fromMonthIndex(monthIndex(HOJE) + 6));
    expect(competenceKeyOf((await ler()).expectedRenewalAt!)).toBe(esperado);

    // Agendamento manual sobrevive a editar o telefone.
    const manual = toCompetenceKey(fromMonthIndex(monthIndex(HOJE) + 2));
    expect((await asOwner(owner, async () => acoes.scheduleClientRenewal(id, manual))).ok).toBe(true);
    const edit = await asOwner(owner, async () => clientes.getClientForEdit(id));
    const r2 = await asOwner(owner, async () =>
      clientes.saveClient(form({
        id, name: "Cadastro Base", status: "ACTIVE", paymentModel: "MRR",
        monthlyValue: "900,00", paymentDay: "5", contractMonths: "6", phone: "71 99999-0000",
        startedAt: `${String(calendarParts(entrada).day).padStart(2, "0")}/${String(HOJE.month).padStart(2, "0")}/${HOJE.year}`,
      }))
    );
    expect(r2.ok, (r2 as any).error).toBe(true);
    expect(edit).toBeTruthy();
    expect(competenceKeyOf((await ler()).expectedRenewalAt!)).toBe(manual);

    // Mudou o prazo: a base mudou, a expectativa é refeita.
    const r3 = await asOwner(owner, async () =>
      clientes.saveClient(form({
        id, name: "Cadastro Base", status: "ACTIVE", paymentModel: "MRR",
        monthlyValue: "900,00", paymentDay: "5", contractMonths: "12",
        startedAt: `${String(calendarParts(entrada).day).padStart(2, "0")}/${String(HOJE.month).padStart(2, "0")}/${HOJE.year}`,
      }))
    );
    expect(r3.ok, (r3 as any).error).toBe(true);
    expect(competenceKeyOf((await ler()).expectedRenewalAt!)).toBe(
      toCompetenceKey(fromMonthIndex(monthIndex(HOJE) + 12))
    );
  });
});

describe("livro do mês", () => {
  it("lista quem tem expectativa no mês, com as quatro métricas do módulo", async () => {
    const a = await clienteQueRenovaEm("Livro Pendente", PROX);
    const b = await clienteQueRenovaEm("Livro Ganha", PROX);
    const c = await clienteQueRenovaEm("Livro Perdida", PROX, { modality: "TCV", monthlyValue: null, totalContractValue: 6000 });
    await clienteQueRenovaEm("Outro Mês", fromMonthIndex(monthIndex(PROX) + 1));
    const compProx = toCompetenceKey(PROX);

    // "Sim, renovou" do módulo aberto no mês PROX.
    const ren = await asOwner(owner, async () =>
      acoes.renewClientFlow(form({
        clientId: b.id, months: "12", modality: "MRR", monthlyValue: "1.100,00",
        paymentDay: "10", launch: "0", forCompetence: compProx,
      }))
    );
    expect(ren.ok, (ren as any).error).toBe(true);
    // "Não renovou" do módulo aberto no mês PROX.
    const perda = await asOwner(owner, async () =>
      clientes.markClientLost(c.id, `${HOJE.year}-${String(HOJE.month).padStart(2, "0")}-15`, "preço", compProx)
    );
    expect(perda.ok, (perda as any).error).toBe(true);

    const livro = await asOwner(owner, async () => svc.renewalLedgerMonth(PROX));
    const porNome = new Map(livro.rows.map((r) => [r.name, r]));
    expect([...porNome.keys()].sort()).toEqual(["Livro Ganha", "Livro Pendente", "Livro Perdida"]);
    expect(porNome.get("Livro Pendente")!.outcome).toBe("pendente");
    expect(porNome.get("Livro Ganha")!.outcome).toBe("renovou");
    expect(porNome.get("Livro Perdida")!.outcome).toBe("nao_renovou");

    // Esperado = 1.000 (pendente) + 1.000 (ganha, valor congelado antes) + 6.000 (TCV perdido).
    expect(livro.expectedTotal).toBe(8000);
    expect(livro.gainedValue).toBe(13200); // 1.100 × 12
    expect(livro.lostValue).toBe(6000);
    expect(livro.renewedCount).toBe(1);
    expect(livro.lostCount).toBe(1);
    expect(livro.pendingCount).toBe(1);

    // A renovação moveu a próxima expectativa em 12 meses a partir da atual.
    const depois = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: b.id }, select: { expectedRenewalAt: true } })
    );
    expect(competenceKeyOf(depois.expectedRenewalAt!)).toBe(toCompetenceKey(fromMonthIndex(monthIndex(PROX) + 12)));
    // E o cliente não volta a aparecer como pendente no mês de PROX do ano seguinte… até lá.
    expect(a).toBeTruthy();
  });

  it("todas as telas contam igual: painel, faixa, janela, card e histórico", async () => {
    const livro = await asOwner(owner, async () => svc.renewalLedgerMonth(PROX));
    const painel = await asOwner(owner, async () => metrics.getRenewalPanel(PROX.month, PROX.year));
    expect(painel.rows.length).toBe(livro.rows.length);
    expect(painel.expectedTotal).toBe(livro.expectedTotal);

    const faixa = await asOwner(owner, async () => metrics.getRenewalStrip(HOJE.month, HOJE.year, 3));
    const f = faixa.find((x) => x.month === PROX.month && x.year === PROX.year)!;
    expect(f.count).toBe(livro.rows.length);
    expect(f.expectedTotal).toBe(livro.expectedTotal);

    const janela = await asOwner(owner, async () => outlook([1]));
    expect(janela[0].count).toBe(livro.rows.length);
    expect(janela[0].expectedTotal).toBe(livro.expectedTotal);

    const card = await asOwner(owner, async () => cardDetail([PROX]));
    expect(card.reduce((s, x) => s + x.value, 0)).toBe(livro.expectedTotal);

    // Período de VÁRIOS meses (trimestre, ano, intervalo livre): o card soma
    // o livro de TODOS os meses — antes ficava só com o primeiro.
    const livroHoje = await asOwner(owner, async () => svc.renewalLedgerMonth(HOJE));
    const cardDois = await asOwner(owner, async () => cardDetail([PROX, HOJE]));
    expect(cardDois).toHaveLength(livroHoje.rows.length + livro.rows.length);
    expect(Math.round(cardDois.reduce((s, x) => s + x.value, 0) * 100) / 100).toBe(
      Math.round((livroHoje.expectedTotal + livro.expectedTotal) * 100) / 100
    );
    // Com mais de um mês, a competência aparece no subtítulo; e a ordem é cronológica.
    if (cardDois.length > 0) expect(cardDois[0].sub).toMatch(/\//);
    expect(await asOwner(owner, async () => cardDetail([]))).toEqual([]);

    const hist = await asOwner(owner, async () => metrics.getRenewalHistory(PROX, 6));
    expect(hist).toHaveLength(7);
    expect(hist[6].expected).toBe(livro.expectedTotal);
    expect(hist[6].gained).toBe(livro.gainedValue);
    expect(hist[6].lost).toBe(livro.lostValue);
  });

  it("perda no meio do contrato não é renovação perdida; perda com a expectativa vencida é", async () => {
    const meio = await clienteQueRenovaEm("Saiu No Meio", fromMonthIndex(monthIndex(HOJE) + 5));
    const vencida = await clienteQueRenovaEm("Vencida Perdida", ANT);
    for (const id of [meio.id, vencida.id]) {
      const r = await asOwner(owner, async () =>
        clientes.markClientLost(id, `${HOJE.year}-${String(HOJE.month).padStart(2, "0")}-10`, "motivo")
      );
      expect(r.ok).toBe(true);
    }
    const perdas = await runWithoutScope(async () =>
      prisma.clientLoss.findMany({
        where: { clientId: { in: [meio.id, vencida.id] } },
        select: { clientId: true, renewalCompetence: true, expectedValue: true },
      })
    );
    const m = perdas.find((p) => p.clientId === meio.id)!;
    const v = perdas.find((p) => p.clientId === vencida.id)!;
    expect(m.renewalCompetence).toBeNull();
    expect(v.renewalCompetence).toBe(toCompetenceKey(ANT));
    expect(Number(v.expectedValue)).toBe(1000);
  });

  it("expectativas de meses anteriores sem desfecho aparecem como atrasadas no mês corrente", async () => {
    await clienteQueRenovaEm("Atrasada Sem Desfecho", ANT);
    const painel = await asOwner(owner, async () => metrics.getRenewalPanel(HOJE.month, HOJE.year));
    expect(painel.overdue?.count).toBeGreaterThanOrEqual(1);
    const anterior = await asOwner(owner, async () => svc.renewalLedgerMonth(ANT));
    expect(anterior.rows.find((r) => r.name === "Atrasada Sem Desfecho")?.outcome).toBe("pendente");
  });

  it("cliente que saiu não aparece como pendente", async () => {
    const c = await clienteQueRenovaEm("Inativo Pendente", PROX);
    await asOwner(owner, async () => prisma.client.update({ where: { id: c.id }, data: { status: "CHURNED" } }));
    const livro = await asOwner(owner, async () => svc.renewalLedgerMonth(PROX));
    expect(livro.rows.map((r) => r.name)).not.toContain("Inativo Pendente");
  });
});

describe("agendamento e edição manual", () => {
  it("agendar põe o cliente no mês escolhido; edição inline e em massa gravam o mês com ano", async () => {
    const c = await createMrrClient(owner, { name: "Agendado À Mão", startedAt: zonedDate(2025, 4, 18) });
    const alvo = toCompetenceKey(fromMonthIndex(monthIndex(HOJE) + 3));
    expect((await asOwner(owner, async () => acoes.scheduleClientRenewal(c.id, alvo))).ok).toBe(true);
    const lido = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { expectedRenewalAt: true } })
    );
    expect(competenceKeyOf(lido.expectedRenewalAt!)).toBe(alvo);
    expect(calendarParts(lido.expectedRenewalAt!).day).toBe(18);

    const livro = await asOwner(owner, async () => svc.renewalLedgerMonth(fromMonthIndex(monthIndex(HOJE) + 3)));
    expect(livro.rows.map((r) => r.name)).toContain("Agendado À Mão");

    // Mês inválido e passado distante são recusados.
    expect((await asOwner(owner, async () => acoes.scheduleClientRenewal(c.id, "2026-13"))).ok).toBe(false);
    expect((await asOwner(owner, async () => acoes.scheduleClientRenewal(c.id, "2020-01"))).ok).toBe(false);

    const inline = toCompetenceKey(fromMonthIndex(monthIndex(HOJE) + 4));
    expect((await asOwner(owner, async () => clientes.setClientRenewalExpectation(c.id, inline))).ok).toBe(true);
    const c2 = await createMrrClient(owner, { name: "Massa" });
    expect((await asOwner(owner, async () => clientes.bulkUpdateClients({ ids: [c.id, c2.id], renewalCompetence: inline }))).ok).toBe(true);
    const ambos = await runWithoutScope(async () =>
      prisma.client.findMany({ where: { id: { in: [c.id, c2.id] } }, select: { expectedRenewalAt: true } })
    );
    for (const x of ambos) expect(competenceKeyOf(x.expectedRenewalAt!)).toBe(inline);
    // Limpar.
    expect((await asOwner(owner, async () => clientes.setClientRenewalExpectation(c.id, null))).ok).toBe(true);
    const limpo = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { expectedRenewalAt: true } })
    );
    expect(limpo.expectedRenewalAt).toBeNull();
  });

  it("reativar cliente com expectativa vencida anda a expectativa até o mês corrente", async () => {
    const c = await clienteQueRenovaEm("Volta Ativo", fromMonthIndex(monthIndex(HOJE) - 3));
    await asOwner(owner, async () => prisma.client.update({ where: { id: c.id }, data: { status: "CHURNED" } }));
    expect((await asOwner(owner, async () => clientes.setClientStatus(c.id, "ACTIVE"))).ok).toBe(true);
    const lido = await runWithoutScope(async () =>
      prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { expectedRenewalAt: true } })
    );
    expect(monthIndex(calendarParts(lido.expectedRenewalAt!))).toBeGreaterThanOrEqual(monthIndex(HOJE));
  });
});
