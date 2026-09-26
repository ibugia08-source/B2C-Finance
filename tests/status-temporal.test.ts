import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling, asOwner,
  type TestOwner,
} from "./support/db";
import {
  addMonths, getEndOfCompetence, getStartOfCompetence, todayKey, addDays,
} from "@/lib/competence";
import type { Period } from "@/lib/period";

/**
 * STATUS DO CLIENTE COM VIGÊNCIA — fluxo real no banco (26/09/2026).
 *
 * As datas são RELATIVAS AO DIA REAL (o gatilho do banco usa o relógio do
 * Postgres): CUR = competência em curso, PROX = a seguinte. Em 26/09/2026,
 * CUR = Setembro/2026 e PROX = Outubro/2026 — exatamente o cenário do dono.
 */

// Permissões controláveis por teste (RBAC existente, sem sistema paralelo).
const perms = new Set<string>(["*"]);
vi.mock("@/lib/auth/viewer", () => {
  const v = { id: "teste", name: "Teste", email: "teste@b2c.local", role: "ADMIN", permissions: [], personId: null };
  const tem = (p: string) => perms.has("*") || perms.has(p);
  return {
    requirePermission: async () => v,
    tryPermission: async (p: string) => (tem(p) ? v : null),
    getViewer: async () => v,
    NO_PERMISSION: { ok: false, error: "Sem permissão." },
    can: (_v: unknown, p: string) => tem(p),
  };
});
vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {}, revalidateFinance: () => {}, revalidateClients: () => {},
  revalidateCatalog: () => {}, revalidateClientStatus: () => {},
}));
vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

const HOJE = todayKey();
const CUR = HOJE.slice(0, 7);
const PROX = addMonths(CUR, 1);
const DEPOIS = addMonths(CUR, 2);
const ANT = addMonths(CUR, -1);
const TUDO = { alterar: true, programar: true, retroativo: true };

let owner: TestOwner;
let outro: TestOwner;
let sh: typeof import("@/lib/clients/status-history");
let acoes: typeof import("@/lib/actions/client-status");

const periodoDe = (comp: string): Period => {
  const [y, m] = comp.split("-").map(Number);
  return { key: "custom", start: new Date(y, m - 1, 1), end: new Date(y, m, 1), label: "", parcial: false, decorridoAte: null, preset: "custom" } as Period;
};

beforeAll(async () => {
  owner = await createOwner();
  outro = await createOwner();
  sh = await import("@/lib/clients/status-history");
  acoes = await import("@/lib/actions/client-status");
});
afterAll(async () => {
  await destroyOwner(owner);
  await destroyOwner(outro);
});

async function alpha(nome = "Alpha", monthlyValue = 1500) {
  // Entrou há 8 meses: ativo em todas as competências recentes.
  const [y, m] = addMonths(CUR, -8).split("-").map(Number);
  return createMrrClient(owner, { name: nome, monthlyValue, startedAt: new Date(Date.UTC(y, m - 1, 10, 15)) });
}
const statusComp = (id: string, comp: string) =>
  asOwner(owner, async () => sh.getClientStatusForCompetence(id, +comp.slice(0, 4), +comp.slice(5, 7)));
const cadastro = (id: string) =>
  runWithoutScope(async () => prisma.client.findUniqueOrThrow({ where: { id }, select: { status: true, churnedAt: true } }));
const linhas = (id: string) => asOwner(owner, async () => sh.getClientStatusTimeline(id));

describe("regressão principal", () => {
  it("abrir o mês seguinte e marcar Inativo NÃO reescreve o mês atual", async () => {
    const a = await alpha();
    expect(await statusComp(a.id, CUR)).toBe("ACTIVE");

    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );

    expect(await statusComp(a.id, CUR)).toBe("ACTIVE"); // nunca Inativo
    expect(await statusComp(a.id, ANT)).toBe("ACTIVE");
    expect(await statusComp(a.id, PROX)).toBe("INACTIVE");
    // Programada: o status atual (materializado) não mudou.
    expect((await cadastro(a.id)).status).toBe("ACTIVE");
    expect(await asOwner(owner, async () => sh.getCurrentClientStatus(a.id))).toBe("ACTIVE");
    const prox = await asOwner(owner, async () => sh.getNextScheduledStatusChange(a.id));
    expect(prox).toMatchObject({ status: "INACTIVE", from: getStartOfCompetence(PROX) });
    // Intervalos sem sobreposição, fechando na véspera.
    const t = await linhas(a.id);
    expect(sh.validateTimeline(t)).toEqual([]);
    expect(t.find((x) => x.status === "ACTIVE")!.to).toBe(getEndOfCompetence(CUR));
  });

  it("alterar o mês seguinte ao seguinte não mexe no seguinte", async () => {
    const a = await alpha("Alpha 2");
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "ACTIVE", effectiveFrom: getStartOfCompetence(DEPOIS) }, TUDO)
    );
    expect(await statusComp(a.id, CUR)).toBe("ACTIVE");
    expect(await statusComp(a.id, PROX)).toBe("INACTIVE");
    expect(await statusComp(a.id, DEPOIS)).toBe("ACTIVE");
    expect(await statusComp(a.id, addMonths(DEPOIS, 1))).toBe("ACTIVE");
  });
});

describe("reorganização da linha do tempo", () => {
  it("Pausado no meio preserva o Inativo já programado (sem sobreposição)", async () => {
    const a = await alpha("Intermediário");
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "PAUSED", effectiveFrom: getStartOfCompetence(CUR) }, TUDO)
    );
    const t = await linhas(a.id);
    expect(t.map((x) => [x.status, x.from, x.to])).toEqual([
      ["ACTIVE", expect.any(String), getEndOfCompetence(ANT)],
      ["PAUSED", getStartOfCompetence(CUR), getEndOfCompetence(CUR)],
      ["INACTIVE", getStartOfCompetence(PROX), null],
    ]);
    // Pausar valeu HOJE: o status atual acompanhou (e a relação/termo, pelo caminho único).
    expect((await cadastro(a.id)).status).toBe("PAUSED");
  });

  it("cancelar a alteração programada devolve o status anterior em diante e audita", async () => {
    const a = await alpha("Cancela");
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    await asOwner(owner, async () =>
      sh.cancelScheduledStatusChange({ clientId: a.id, effectiveFrom: getStartOfCompetence(PROX), reason: "desistiu" }, TUDO)
    );
    const t = await linhas(a.id);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ status: "ACTIVE", to: null });
    const audit = await runWithoutScope(async () =>
      prisma.auditLog.findMany({ where: { entity: "Client", entityId: a.id }, orderBy: { createdAt: "asc" } })
    );
    expect(audit.map((x) => x.field)).toEqual(["status_programado", "status_programado_cancelado"]);
    expect(audit[1].reason).toBe("desistiu");
    expect(JSON.parse(audit[0].newValue!)).toMatchObject({ status: "INACTIVE", competence: PROX });
  });

  it("não cancela o que já está valendo", async () => {
    const a = await alpha("Não Cancela");
    await expect(
      asOwner(owner, async () => sh.cancelScheduledStatusChange({ clientId: a.id, effectiveFrom: HOJE }, TUDO))
    ).rejects.toMatchObject({ code: "NAO_E_FUTURA" });
  });
});

describe("integridade no banco", () => {
  it("recusa dois status válidos no mesmo dia e fim antes do começo", async () => {
    const a = await alpha("Integridade");
    const [row] = await linhas(a.id);
    await expect(
      runWithoutScope(async () =>
        prisma.clientStatusHistory.create({
          data: {
            clientId: a.id, status: "PAUSED", ownerId: owner.id,
            effectiveFrom: new Date(`${addDays(row.from, 5)}T00:00:00Z`),
          },
        })
      )
    ).rejects.toThrow();
    await expect(
      runWithoutScope(async () =>
        prisma.clientStatusHistory.create({
          data: {
            clientId: a.id, status: "PAUSED", ownerId: owner.id,
            effectiveFrom: new Date("2001-05-10T00:00:00Z"), effectiveTo: new Date("2001-05-01T00:00:00Z"),
          },
        })
      )
    ).rejects.toThrow();
  });

  it("todo cliente nasce com linha do tempo (gatilho) — da entrada, com o dono", async () => {
    const a = await alpha("Nasce");
    const t = await linhas(a.id);
    expect(t).toHaveLength(1);
    expect(t[0].status).toBe("ACTIVE");
    const dono = await runWithoutScope(async () =>
      prisma.clientStatusHistory.findFirstOrThrow({ where: { clientId: a.id }, select: { ownerId: true } })
    );
    expect(dono.ownerId).toBe(owner.id);
  });
});

describe("permissões (RBAC existente)", () => {
  it("sem clientes.alterar_status não altera; ADMIN (*) altera", async () => {
    const a = await alpha("Perm");
    perms.clear();
    perms.add("clientes.visualizar");
    try {
      const r = await asOwner(owner, async () =>
        acoes.changeClientStatusAction({ clientId: a.id, status: "PAUSED", effectiveFrom: HOJE })
      );
      expect(r.ok).toBe(false);
      expect(await statusComp(a.id, CUR)).toBe("ACTIVE");
    } finally {
      perms.clear();
      perms.add("*");
    }
    const ok = await asOwner(owner, async () =>
      acoes.changeClientStatusAction({ clientId: a.id, status: "PAUSED", effectiveFrom: HOJE })
    );
    expect(ok.ok, (ok as any).error).toBe(true);
  });

  it("programar exige clientes.programar_status; retroativo exige clientes.alterar_status_retroativo", async () => {
    const a = await alpha("Perm 2");
    perms.clear();
    perms.add("clientes.alterar_status");
    try {
      const fut = await asOwner(owner, async () =>
        acoes.changeClientStatusAction({ clientId: a.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) })
      );
      expect(fut.ok).toBe(false);
      const retro = await asOwner(owner, async () =>
        acoes.changeClientStatusAction({ clientId: a.id, status: "PAUSED", effectiveFrom: getStartOfCompetence(ANT) })
      );
      expect(retro.ok).toBe(false);
      // Na competência em curso, alterar_status basta.
      const atual = await asOwner(owner, async () =>
        acoes.changeClientStatusAction({ clientId: a.id, status: "PAUSED", effectiveFrom: getStartOfCompetence(CUR) })
      );
      expect(atual.ok, (atual as any).error).toBe(true);
    } finally {
      perms.clear();
      perms.add("*");
    }
  });

  it("outro dono não altera nem enxerga a linha do tempo", async () => {
    const a = await alpha("Isolado");
    await expect(
      asOwner(outro, async () =>
        sh.changeClientStatus({ clientId: a.id, status: "CHURNED", effectiveFrom: HOJE }, TUDO)
      )
    ).rejects.toMatchObject({ code: "CLIENTE" });
    expect(await asOwner(outro, async () => sh.getClientStatusTimeline(a.id))).toEqual([]);
    expect(await statusComp(a.id, CUR)).toBe("ACTIVE");
  });
});

describe("competência fechada", () => {
  it("fechada bloqueia; reaberta permite, com auditoria", async () => {
    const { currentWorkspaceId } = await import("@/lib/services/workspace");
    const ws = await asOwner(owner, async () => currentWorkspaceId());
    const a = await alpha("Fechamento");
    // Linha do tempo antiga e limitada (2019) para não cruzar com outras suítes.
    await runWithoutScope(async () =>
      prisma.$transaction([
        prisma.$executeRaw`SELECT b2c_status_apply(${a.id}, 'ACTIVE'::"ClientStatus", '2019-01-01'::date, NULL, NULL, 'USUARIO', false)`,
        prisma.$executeRaw`SELECT b2c_status_apply(${a.id}, 'INACTIVE'::"ClientStatus", '2019-06-01'::date, NULL, NULL, 'USUARIO', false)`,
      ])
    );
    await runWithoutScope(async () =>
      prisma.closingPeriod.upsert({
        where: { workspaceId_scopeType_scopeId_competence: { workspaceId: ws, scopeType: "WORKSPACE", scopeId: "", competence: "2019-04" } },
        create: { workspaceId: ws, competence: "2019-04", state: "CLOSED", closedAt: new Date(), closedBy: "teste" },
        update: { state: "CLOSED", closedAt: new Date(), closedBy: "teste" },
      })
    );
    try {
      await expect(
        asOwner(owner, async () =>
          sh.changeClientStatus({ clientId: a.id, status: "PAUSED", effectiveFrom: "2019-03-10" }, TUDO)
        )
      ).rejects.toMatchObject({ code: "COMPETENCIA_FECHADA" });
      // Mudança que termina ANTES do mês fechado passa.
      await runWithoutScope(async () =>
        prisma.closingPeriod.update({
          where: { workspaceId_scopeType_scopeId_competence: { workspaceId: ws, scopeType: "WORKSPACE", scopeId: "", competence: "2019-04" } },
          data: { state: "REOPENED", reopenReason: "ajuste de status", reopenedAt: new Date(), reopenedBy: "teste" },
        })
      );
      await asOwner(owner, async () =>
        sh.changeClientStatus({ clientId: a.id, status: "PAUSED", effectiveFrom: "2019-03-10", reason: "correção" }, TUDO)
      );
      expect(await asOwner(owner, async () => sh.getClientStatusAtDate(a.id, "2019-04-15"))).toBe("PAUSED");
      expect(await asOwner(owner, async () => sh.getClientStatusAtDate(a.id, "2019-03-09"))).toBe("ACTIVE");
      expect(await asOwner(owner, async () => sh.getClientStatusAtDate(a.id, "2019-06-01"))).toBe("INACTIVE");
      const audit = await runWithoutScope(async () =>
        prisma.auditLog.findFirst({ where: { entity: "Client", entityId: a.id, field: "status_vigencia" } })
      );
      expect(audit?.reason).toBe("correção");
    } finally {
      await runWithoutScope(async () => prisma.closingPeriod.deleteMany({ where: { workspaceId: ws, competence: "2019-04" } }));
    }
  });
});

describe("carteira × fatos financeiros", () => {
  it("MRR: mês atual inclui, mês seguinte (projeção) exclui; o cliente continua no passado", async () => {
    const { getPeriodRevenue } = await import("@/lib/services/revenue-metrics");
    const a = await alpha("MRR Alpha", 1500);
    const mrrDe = async (comp: string) => {
      const p = periodoDe(comp);
      const r = await asOwner(owner, async () => getPeriodRevenue(p.start, p.end, { clientId: a.id }));
      return r.mrr;
    };
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    expect(await mrrDe(CUR)).toBe(1500);
    expect(await mrrDe(ANT)).toBe(1500);
    expect(await mrrDe(PROX)).toBe(0);
  });

  it("TCV do mês de fechamento continua integral mesmo com o cliente inativo depois", async () => {
    const { getPeriodRevenue } = await import("@/lib/services/revenue-metrics");
    const c = await asOwner(owner, async () =>
      prisma.client.create({
        data: { name: "TCV Setembro", status: "ACTIVE", modality: "TCV", totalContractValue: 3000, startedAt: new Date(`${getStartOfCompetence(ANT)}T15:00:00Z`) },
        select: { id: true },
      })
    );
    const [y, m] = CUR.split("-").map(Number);
    await createBilling(owner, c.id, { year: y, month: m, amount: 3000, revenueType: "TCV" });
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: c.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    const p = periodoDe(CUR);
    const r = await asOwner(owner, async () => getPeriodRevenue(p.start, p.end, { clientId: c.id }));
    expect(r.tcv).toBe(3000);
  });

  it("novo cliente conta no mês de entrada mesmo ficando inativo no mês seguinte", async () => {
    const { getNewClientsSummary } = await import("@/lib/services/revenue-metrics");
    const p = periodoDe(CUR);
    const antes = await asOwner(owner, async () => getNewClientsSummary(p.start, p.end));
    const c = await createMrrClient(owner, { name: "Novo do Mês", startedAt: new Date(`${getStartOfCompetence(CUR)}T15:00:00Z`) });
    const comEle = await asOwner(owner, async () => getNewClientsSummary(p.start, p.end));
    expect(comEle.count).toBe(antes.count + 1);
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: c.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    const depois = await asOwner(owner, async () => getNewClientsSummary(p.start, p.end));
    expect(depois.count).toBe(comEle.count); // a saída posterior não desfaz a entrada
    // Nem uma saída JÁ valendo (perdido hoje) tira a entrada do mês.
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: c.id, status: "CHURNED", effectiveFrom: HOJE }, TUDO)
    );
    expect((await asOwner(owner, async () => getNewClientsSummary(p.start, p.end))).count).toBe(comEle.count);
  });

  it("recebimento de competência anterior pago depois continua existindo e sendo registrado", async () => {
    const { settleBillingPayment } = await import("@/lib/services/payment-accounting");
    const a = await alpha("Paga Depois");
    const [y, m] = CUR.split("-").map(Number);
    const b = await createBilling(owner, a.id, { year: y, month: m, amount: 1500 });
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    const r = await asOwner(owner, async () =>
      settleBillingPayment({ billingId: b.id, amount: 1500, paidAt: new Date(), method: "PIX", accountId: null, notes: null } as any)
    );
    expect(r.ok, (r as any).error).toBe(true);
    const cob = await runWithoutScope(async () => prisma.billing.findUniqueOrThrow({ where: { id: b.id } }));
    expect(cob.status).toBe("PAID");
    expect(cob.competenceMonth).toBe(m);
  });

  it("Recebimentos: a mensalidade do mês atual nasce; a do mês da saída programada, não", async () => {
    const { ensureMonthlyBillings, bustBillingCycleThrottle } = await import("@/lib/services/receivables-cycle");
    const a = await alpha("Ciclo", 800);
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    bustBillingCycleThrottle();
    const [y, m] = CUR.split("-").map(Number);
    const [py, pm] = PROX.split("-").map(Number);
    await asOwner(owner, async () => ensureMonthlyBillings(m, y));
    await asOwner(owner, async () => ensureMonthlyBillings(pm, py));
    const n = (yy: number, mm: number) =>
      runWithoutScope(async () => prisma.billing.count({ where: { clientId: a.id, competenceYear: yy, competenceMonth: mm, revenueType: "MRR" } }));
    expect(await n(y, m)).toBe(1);
    expect(await n(py, pm)).toBe(0);
  });
});

describe("perda com vigência e o job diário", () => {
  it("saída que começa a valer é materializada pelo job: perda registrada na data, não conta como ativo", async () => {
    const { getMonthlyChurn } = await import("@/lib/services/revenue-metrics");
    const a = await alpha("Perde Hoje");
    // A alteração "chegou": linha do tempo já diz Perdido desde hoje, e o
    // cadastro ainda Ativo (é o que o job encontra na virada do dia).
    await runWithoutScope(async () =>
      prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('b2c.status_manual', '1', true)`,
        prisma.$executeRaw`SELECT b2c_status_apply(${a.id}, 'CHURNED'::"ClientStatus", ${HOJE}::date, 'fim', NULL, 'USUARIO', false)`,
      ])
    );
    expect((await cadastro(a.id)).status).toBe("ACTIVE");
    const r = await sh.materializarStatusProgramados(HOJE, owner.id);
    expect(r.atualizados).toBeGreaterThanOrEqual(1);
    expect((await cadastro(a.id)).status).toBe("CHURNED");
    const perdas = await runWithoutScope(async () => prisma.clientLoss.findMany({ where: { clientId: a.id } }));
    expect(perdas).toHaveLength(1);
    expect(perdas[0].lostAt.toISOString().slice(0, 10)).toBe(HOJE);
    // Perdidos: +1 no mês da saída; 0 no mês anterior.
    const cur = periodoDe(CUR);
    const ant = periodoDe(ANT);
    const noMes = await asOwner(owner, async () => getMonthlyChurn(cur.start, cur.end));
    const antes = await asOwner(owner, async () => getMonthlyChurn(ant.start, ant.end));
    expect(noMes.count).toBeGreaterThanOrEqual(1);
    expect(antes.count).toBe(0);
    // Idempotente.
    const again = await sh.materializarStatusProgramados(HOJE, owner.id);
    expect(again.atualizados).toBe(0);
    // Ativos da competência não contam quem saiu (ref = hoje).
    const ativos = await asOwner(owner, async () => sh.getActiveClientsForCompetence(CUR));
    expect(ativos.has(a.id)).toBe(false);
    expect((await asOwner(owner, async () => sh.getActiveClientsForCompetence(ANT))).has(a.id)).toBe(true);
  });

  it("rotina/status de hoje não enxergam a alteração programada antes da data", async () => {
    const a = await alpha("Rotina");
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "CHURNED", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    expect((await cadastro(a.id)).status).toBe("ACTIVE");
    expect(await runWithoutScope(async () => prisma.clientLoss.count({ where: { clientId: a.id } }))).toBe(0);
    // O job de hoje não aplica nada para este cliente.
    await sh.materializarStatusProgramados(HOJE, owner.id);
    expect((await cadastro(a.id)).status).toBe("ACTIVE");
  });
});

describe("telas e relatórios", () => {
  it("Dashboard, relatório de clientes e projeção seguem a competência", async () => {
    const { getExecutiveDashboard } = await import("@/lib/services/dashboard-metrics");
    const { clientesReport } = await import("@/lib/reports/definitions/clientes");
    const { getPortfolioProjection } = await import("@/lib/services/portfolio-projection");
    const a = await alpha("Tela Alpha", 1500);
    await asOwner(owner, async () =>
      sh.changeClientStatus({ clientId: a.id, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) }, TUDO)
    );
    const ativosCur = await asOwner(owner, async () => sh.getActiveClientsForCompetence(CUR));
    const ativosProx = await asOwner(owner, async () => sh.getActiveClientsForCompetence(PROX));
    expect(ativosCur.has(a.id)).toBe(true);
    expect(ativosProx.has(a.id)).toBe(false);

    const dCur = await asOwner(owner, async () => getExecutiveDashboard({ period: periodoDe(CUR) } as any));
    const dProx = await asOwner(owner, async () => getExecutiveDashboard({ period: periodoDe(PROX) } as any));
    expect(dCur.clients.ativos).toBe(ativosCur.size);
    expect(dProx.clients.ativos).toBe(ativosProx.size);
    expect(dCur.clients.ativos - dProx.clients.ativos).toBeGreaterThanOrEqual(1);

    const linhaDe = async (comp: string) =>
      (await asOwner(owner, async () => clientesReport.build({ period: periodoDe(comp), clientId: a.id } as any)))[0];
    expect((await linhaDe(CUR)).status).toBe("Ativo");
    expect((await linhaDe(PROX)).status).toBe("Inativo");

    const proj = await asOwner(owner, async () => getPortfolioProjection(2));
    const pCur = proj.find((p) => p.competence === CUR)!;
    const pProx = proj.find((p) => p.competence === PROX)!;
    expect(pCur.kind).toBe("REALIZADO");
    expect(pProx.kind).toBe("PROJETADO");
    expect(pCur.mrr - pProx.mrr).toBeGreaterThanOrEqual(1500);
  });

  it("ação em massa aplica a mesma vigência a todos, preservando o passado", async () => {
    const ids = [(await alpha("Massa 1")).id, (await alpha("Massa 2")).id, (await alpha("Massa 3")).id];
    const r = await asOwner(owner, async () =>
      acoes.bulkChangeClientStatusAction({ ids, status: "INACTIVE", effectiveFrom: getStartOfCompetence(PROX) })
    );
    expect(r.ok, (r as any).error).toBe(true);
    expect(r.alterados).toBe(3);
    for (const id of ids) {
      expect(await statusComp(id, CUR)).toBe("ACTIVE");
      expect(await statusComp(id, PROX)).toBe("INACTIVE");
    }
  });
});

describe("reconstrução do histórico (backfill) — não inventa data", () => {
  async function reconstruir(id: string) {
    await runWithoutScope(async () =>
      prisma.$transaction([
        prisma.clientStatusHistory.deleteMany({ where: { clientId: id } }),
        prisma.$executeRaw`SELECT b2c_status_backfill_client(${id})`,
      ])
    );
    return linhas(id);
  }

  it("ativo com entrada: Ativo desde a entrada (inferido, sem revisão)", async () => {
    const a = await alpha("BF Ativo");
    const t = await reconstruir(a.id);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ status: "ACTIVE", to: null, origin: "BACKFILL_INFERIDO", needsReview: false });
  });

  it("perdido com perda registrada: Ativo até a véspera, Perdido desde a perda (comprovado)", async () => {
    const a = await alpha("BF Perda");
    const perda = addDays(HOJE, -40);
    await runWithoutScope(async () =>
      prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('b2c.status_manual', '1', true)`,
        prisma.client.update({ where: { id: a.id }, data: { status: "CHURNED" } }),
        prisma.clientLoss.create({ data: { clientId: a.id, ownerId: owner.id, lostAt: new Date(`${perda}T15:00:00Z`) } }),
      ])
    );
    const t = await reconstruir(a.id);
    expect(t.map((x) => [x.status, x.to ?? null])).toEqual([
      ["ACTIVE", addDays(perda, -1)],
      ["CHURNED", null],
    ]);
    expect(t[1]).toMatchObject({ from: perda, origin: "BACKFILL_COMPROVADO" });
  });

  it("perdido sem data nenhuma: só o status de hoje, marcado para revisão", async () => {
    const a = await alpha("BF Sem Data");
    await runWithoutScope(async () =>
      prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('b2c.status_manual', '1', true)`,
        prisma.client.update({ where: { id: a.id }, data: { status: "CHURNED" } }),
      ])
    );
    const t = await reconstruir(a.id);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ status: "CHURNED", from: HOJE, needsReview: true, origin: "BACKFILL_INDETERMINADO" });
  });

  it("perdido sem data mas com cobranças: ativo até o último mês cobrado, inferido e marcado", async () => {
    const a = await alpha("BF Cobranças");
    const ult = addMonths(CUR, -3);
    const [y, m] = ult.split("-").map(Number);
    await createBilling(owner, a.id, { year: y, month: m, amount: 1500 });
    await runWithoutScope(async () =>
      prisma.$transaction([
        prisma.$executeRaw`SELECT set_config('b2c.status_manual', '1', true)`,
        prisma.client.update({ where: { id: a.id }, data: { status: "CHURNED" } }),
      ])
    );
    const t = await reconstruir(a.id);
    expect(t.map((x) => x.status)).toEqual(["ACTIVE", "CHURNED"]);
    expect(t[0].to).toBe(getEndOfCompetence(ult));
    expect(t[1].from).toBe(getStartOfCompetence(addMonths(ult, 1)));
    expect(t.every((x) => x.needsReview)).toBe(true);
  });
});
