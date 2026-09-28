import { prisma } from "@/lib/prisma";
import { computePeriodMetrics } from "@/lib/metrics/engine";
import { periodOfMonth } from "@/lib/period";
import { getLiquidez } from "@/lib/services/liquidity";
import { getCashSummary } from "@/lib/services/finance-metrics";
import { montarRotinaDoDia } from "@/lib/services/daily-routine";
import { periodoDe } from "@/lib/services/closing-period";
import { getClientsByStatusForCompetence } from "@/lib/clients/status-history";
import type { DomainContext } from "@/lib/engines/domain";
import { todayKey, type Competence } from "@/lib/competence";
import { dinheiro, instante } from "../http";
import { competenciaAtual, dia, intervaloDaCompetencia, statusDoCliente } from "./common";
import { listarRecebiveisApi, serializarRecebivel } from "./receivables";
import { serializarDespesa } from "./expenses";

/**
 * PAINÉIS NA API: dashboard, caixa, rotina e relatórios. Tudo sai das mesmas
 * funções das telas (motor de métricas, liquidez, rotina do dia) — a API não
 * tem fórmula própria de indicador.
 */

const PERCENTUAIS = new Set(["margem_gerencial", "percentual_recorrencia", "percentual_realizacao", "churn_rate", "percentual_folha"]);
const CONTAGENS = new Set(["clientes_ativos", "novos_clientes", "churn_quantidade"]);

export async function indicadoresDaCompetencia(competence: Competence) {
  const [y, m] = competence.split("-").map(Number);
  const period = periodOfMonth(y, m);
  const metricas = await computePeriodMetrics(period);
  const metrics: Record<string, { value: number | null; name: string; unit: "currency" | "percent" | "count" }> = {};
  for (const [key, v] of Object.entries(metricas)) {
    metrics[key] = {
      value: v.value == null ? null : Math.round(v.value * 100) / 100,
      name: v.spec.name,
      unit: PERCENTUAIS.has(key) ? "percent" : CONTAGENS.has(key) ? "count" : "currency",
    };
  }
  return { competence, partial: period.parcial, metrics };
}

export async function resumoDoCaixa() {
  const agora = new Date();
  const hoje = todayKey(agora);
  const [y, m] = hoje.split("-").map(Number);
  const [liq, mes] = await Promise.all([getLiquidez(agora.toISOString()), getCashSummary(periodOfMonth(y, m))]);
  return {
    date: hoje,
    accountsBalance: liq.contas,
    commitments: liq.compromissos,
    commitmentWindowDays: liq.janelaDias,
    available: liq.disponivel,
    breakdown: liq.itens.map((i) => ({ label: i.label, value: i.value, type: i.tipo === "conta" ? "account" : "commitment" })),
    next30Days: { inflows: liq.entradas30d, outflows: liq.saidas30d, projectedBalance: liq.projecao30d },
    projection: {
      horizonDays: liq.projecao.horizonteDias,
      startingBalance: liq.projecao.partida,
      receivable: liq.projecao.aReceber,
      overdueReceivableNotIncluded: liq.projecao.aReceberVencido,
      payable: liq.projecao.aPagar,
      financedLiabilities: liq.projecao.passivoFinanciado,
      projectedBalance: liq.projecao.projecao,
    },
    month: {
      competence: `${y}-${String(m).padStart(2, "0")}`,
      inflows: mes.entradasPeriodo,
      outflows: mes.saidasPeriodo,
      realizedBalance: mes.saldoRealizado,
      expectedBalance: mes.saldoPrevisto,
      projection30: mes.projecao30,
      projection60: mes.projecao60,
      projection90: mes.projecao90,
    },
  };
}

/**
 * Rotina do dia — o MESMO montador da tela /rotina. O que a conta não pode
 * ver (sem scope de recebimentos, despesas, caixa…) já vem vazio de lá,
 * porque os gates usam `domainCan`, que para conta de serviço segue os scopes.
 */
export async function rotinaDoDiaApi(ctx: DomainContext) {
  const r = await montarRotinaDoDia(ctx);
  return {
    date: todayKey(),
    actions: r.acoes.map((a) => ({ key: a.key, priority: a.priority, text: a.text, done: r.doneActions.has(a.key) })),
    pendingActions: r.acoesPendentes,
    collections: {
      overdue: r.vencidosSorted.map((q) => ({
        client: { id: q.clientId, name: q.clientName },
        totalOverdue: q.totalOverdue,
        daysOverdue: q.daysOverdue,
        billingCount: q.billingCount,
        priority: q.priority,
        reasons: q.reasons,
        lastContactAt: instante(q.lastContactAt),
        brokenPromise: !!q.promise?.broken,
        anchorBillingId: q.anchorBilling?.id ?? null,
      })),
      overdueTotal: Math.round(r.cobrVencidasTotal * 100) / 100,
      dueSoon: r.proximos.map((x) => ({
        id: x.b.id,
        client: { id: x.b.client.id, name: x.b.client.name },
        description: x.b.description,
        openAmount: Math.round(x.open * 100) / 100,
        dueDate: dia(x.b.dueDate),
        daysUntilDue: x.dias,
        priority: x.priority,
      })),
      dueSoonTotal: Math.round(r.cobrProximasTotal * 100) / 100,
    },
    payments: {
      overdue: r.payVencidos.map((p) => ({ ...p, dueDate: dia(p.dueDate), daysOverdue: p.dias, dias: undefined })),
      overdueTotal: Math.round(r.pagVencidosTotal * 100) / 100,
      dueSoon: r.payProximos.map((p) => ({ ...p, dueDate: dia(p.dueDate), daysUntilDue: p.dias, dias: undefined })),
      dueSoonTotal: Math.round(r.pagProximosTotal * 100) / 100,
    },
    renewals: r.renov
      ? { month: r.renov.month, pendingCount: r.renovPendentes.length, pendingExpectedValue: r.renovPendenteValor }
      : null,
    cash: r.cash ? { available: r.cash.caixaDisponivel, projection30: r.cash.projecao30 } : null,
    openUpsells: r.openUpsells.map((u) => ({
      id: u.id, client: u.client.name, value: dinheiro(u.value), responsible: u.responsible,
    })),
  };
}

// ---------------------------------------------------------------------------
// Relatórios
// ---------------------------------------------------------------------------

/** Limites UTC do dia civil da Bahia (UTC−3, sem horário de verão). */
function instantesDoDia(d: string): { gte: Date; lt: Date } {
  const gte = new Date(`${d}T03:00:00.000Z`);
  return { gte, lt: new Date(gte.getTime() + 86_400_000) };
}
function diaCivilUtc(d: string): { gte: Date; lt: Date } {
  const gte = new Date(`${d}T00:00:00.000Z`);
  return { gte, lt: new Date(gte.getTime() + 86_400_000) };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Relatório DIÁRIO: o que venceu, entrou e mudou num dia. Cada seção só sai
 * se a conta tiver o scope da área (o relatório não é atalho para ler o que
 * o scope não permite); as omitidas vão em `omittedSections`.
 */
export async function relatorioDiario(date: string, scopes: string[]) {
  const pode = (s: string) => scopes.includes(s);
  const omitted: string[] = [];
  const out: Record<string, unknown> = { date };

  if (pode("receivables.read")) {
    const [vencendo, pagamentos] = await Promise.all([
      prisma.billing.findMany({
        where: { dueDate: diaCivilUtc(date), status: { notIn: ["CANCELED"] } },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        select: {
          id: true, clientId: true, description: true, competence: true, competenceMonth: true, competenceYear: true,
          amount: true, paidTotal: true, dueDate: true, paidAt: true, status: true, isLate: true,
          paidInDifferentMonth: true, collectionStatus: true, billingKind: true, revenueType: true,
          installmentNumber: true, canceledAt: true, client: { select: { id: true, name: true } },
        },
      }),
      prisma.payment.findMany({
        where: { paidAt: instantesDoDia(date), status: "CONFIRMED" },
        orderBy: { paidAt: "asc" },
        select: {
          id: true, amount: true, paidAt: true, method: true,
          billing: { select: { id: true, description: true, client: { select: { id: true, name: true } } } },
        },
      }),
    ]);
    const due = vencendo.map((b) => serializarRecebivel(b));
    const recebidos = pagamentos.map((p) => ({
      id: p.id, amount: dinheiro(p.amount), paidAt: instante(p.paidAt), method: p.method,
      billingId: p.billing.id, description: p.billing.description, client: p.billing.client,
    }));
    out.receivables = {
      dueToday: { count: due.length, amount: r2(due.reduce((s, x) => s + x.amount, 0)), openAmount: r2(due.reduce((s, x) => s + x.openAmount, 0)), items: due },
      received: { count: recebidos.length, amount: r2(recebidos.reduce((s, x) => s + (x.amount ?? 0), 0)), items: recebidos },
    };
  } else omitted.push("receivables");

  if (pode("expenses.read")) {
    // PAGAS NO DIA: a despesa não guarda data de pagamento; o fato fica na
    // trilha (AuditLog: status → "pago", gravado pelo motor ao pagar). Uma
    // consulta à trilha + uma às despesas, sem N+1.
    const marcadasPagas = await prisma.auditLog.findMany({
      where: { entity: "Transaction", field: "status", newValue: "pago", createdAt: instantesDoDia(date) },
      select: { entityId: true, createdAt: true },
    });
    const idsPagas = [...new Set(marcadasPagas.map((a) => a.entityId))];
    const pagas = idsPagas.length
      ? await prisma.transaction.findMany({
          where: { id: { in: idsPagas }, type: "despesa", status: "pago" },
          orderBy: [{ amount: "desc" }, { id: "asc" }],
      select: {
        id: true, description: true, amount: true, date: true, dueDate: true, status: true, expenseType: true,
        recurrence: true, recurrenceGroupId: true, origin: true, notes: true, createdAt: true,
        category: { select: { id: true, name: true } }, client: { select: { id: true, name: true } },
        account: { select: { id: true, name: true } },
      },
        })
      : [];
    const despesas = await prisma.transaction.findMany({
      where: { type: "despesa", status: { not: "cancelado" }, OR: [{ dueDate: diaCivilUtc(date) }, { dueDate: null, date: diaCivilUtc(date) }] },
      orderBy: [{ amount: "desc" }, { id: "asc" }],
      select: {
        id: true, description: true, amount: true, date: true, dueDate: true, status: true, expenseType: true,
        recurrence: true, recurrenceGroupId: true, origin: true, notes: true, createdAt: true,
        category: { select: { id: true, name: true } }, client: { select: { id: true, name: true } },
        account: { select: { id: true, name: true } },
      },
    });
    const itens = despesas.map((t) => serializarDespesa(t));
    out.expenses = {
      dueToday: {
        count: itens.length,
        amount: r2(itens.reduce((s, x) => s + (x.amount ?? 0), 0)),
        paidAmount: r2(itens.filter((x) => x.rawStatus === "pago").reduce((s, x) => s + (x.amount ?? 0), 0)),
        items: itens,
      },
      paid: {
        count: pagas.length,
        amount: r2(pagas.reduce((s, t) => s + Number(t.amount), 0)),
        items: pagas.map((t) => serializarDespesa(t)),
      },
    };
  } else omitted.push("expenses");

  if (pode("client_status.read") || pode("clients.read")) {
    const [mudancas, registradas, novos, cadastrados] = await Promise.all([
      prisma.clientStatusHistory.findMany({
        where: { effectiveFrom: new Date(`${date}T00:00:00.000Z`) },
        orderBy: { createdAt: "asc" },
        select: { clientId: true, status: true, reason: true, client: { select: { name: true } } },
      }),
      // Alterações REGISTRADAS no dia (qualquer vigência: hoje, programada
      // ou retroativa) — o que a equipe/integração mudou hoje.
      prisma.clientStatusHistory.findMany({
        where: { createdAt: instantesDoDia(date), NOT: { origin: { startsWith: "BACKFILL" } } },
        orderBy: { createdAt: "asc" },
        select: { clientId: true, status: true, reason: true, effectiveFrom: true, client: { select: { name: true } } },
      }),
      prisma.client.findMany({
        where: { startedAt: diaCivilUtc(date) },
        orderBy: { name: "asc" },
        select: { id: true, name: true, modality: true },
      }),
      prisma.client.findMany({
        where: { createdAt: instantesDoDia(date) },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, modality: true },
      }),
    ]);
    out.clients = {
      statusChanges: mudancas.map((m) => ({ client: { id: m.clientId, name: m.client.name }, status: statusDoCliente(m.status), reason: m.reason })),
      statusChangesRecorded: registradas.map((m) => ({
        client: { id: m.clientId, name: m.client.name },
        status: statusDoCliente(m.status),
        effectiveFrom: dia(m.effectiveFrom),
        reason: m.reason,
      })),
      newClients: novos,
      createdClients: cadastrados,
    };
  } else omitted.push("clients");

  if (pode("upsells.read")) {
    const [criados, vendidos] = await Promise.all([
      prisma.upsell.findMany({
        where: { createdAt: instantesDoDia(date) },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, value: true, status: true, responsible: true, client: { select: { id: true, name: true } } },
      }),
      prisma.upsell.findMany({
        where: { status: "WON", closedAt: instantesDoDia(date) },
        orderBy: { closedAt: "asc" },
        select: { id: true, title: true, value: true, status: true, responsible: true, client: { select: { id: true, name: true } } },
      }),
    ]);
    const plano = (u: (typeof criados)[number]) => ({ ...u, value: dinheiro(u.value) });
    out.upsells = {
      created: { count: criados.length, value: r2(criados.reduce((s, u) => s + Number(u.value), 0)), items: criados.map(plano) },
      won: { count: vendidos.length, value: r2(vendidos.reduce((s, u) => s + Number(u.value), 0)), items: vendidos.map(plano) },
    };
  } else omitted.push("upsells");

  return { data: out, omitted };
}

/** Relatório MENSAL da competência: indicadores, carteira, recebimentos, despesas e fechamento. */
export async function relatorioMensal(competence: Competence, scopes: string[]) {
  const pode = (s: string) => scopes.includes(s);
  const omitted: string[] = [];
  const periodo = await periodoDe(competence);
  const out: Record<string, unknown> = {
    competence,
    closing: {
      state: periodo.estado,
      label: periodo.rotulo,
      closedAt: instante(periodo.fechadoEm),
      closedBy: periodo.fechadoPor,
      reopenedAt: instante(periodo.reabertoEm),
    },
  };

  if (pode("dashboard.read")) out.indicators = (await indicadoresDaCompetencia(competence)).metrics;
  else omitted.push("indicators");

  if (pode("clients.read") || pode("client_status.read")) {
    const porStatus = await getClientsByStatusForCompetence(competence, { today: todayKey() });
    out.portfolio = {
      byStatus: Object.entries(porStatus)
        .map(([s, ids]) => ({ status: statusDoCliente(s), count: ids.length }))
        .sort((a, b) => b.count - a.count),
    };
  } else omitted.push("portfolio");

  if (pode("receivables.read")) {
    const [y, m] = competence.split("-").map(Number);
    const todas = await listarRecebiveisApi({ where: { competenceYear: y, competenceMonth: m }, page: 1, pageSize: 5000 });
    const porStatus: Record<string, { count: number; amount: number; openAmount: number }> = {};
    for (const i of todas.itens) {
      const s = (porStatus[i.status.code] ??= { count: 0, amount: 0, openAmount: 0 });
      s.count += 1;
      s.amount = r2(s.amount + i.amount);
      s.openAmount = r2(s.openAmount + i.openAmount);
    }
    out.receivables = { count: todas.total, totals: todas.totals, byStatus: porStatus };
  } else omitted.push("receivables");

  if (pode("expenses.read")) {
    const grupos = await prisma.transaction.groupBy({
      by: ["status"],
      where: { type: "despesa", date: intervaloDaCompetencia(competence) },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const byStatus = Object.fromEntries(
      grupos.map((g) => [g.status, { count: g._count._all, amount: dinheiro(g._sum.amount) ?? 0 }])
    );
    const total = grupos.filter((g) => g.status !== "cancelado").reduce((s, g) => s + (dinheiro(g._sum.amount) ?? 0), 0);
    out.expenses = { total: r2(total), byStatus };
  } else omitted.push("expenses");

  return { data: out, omitted };
}

export { competenciaAtual };
