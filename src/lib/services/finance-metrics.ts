import { computeOperationalMargin } from "@/lib/financial/calculations";
import { projecaoDeCaixa } from "./liquidity";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { ownerCached } from "@/lib/owner-cache";
import { BILLING_OPEN_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/period";
import { toNumber as n } from "@/lib/format";

/**
 * Núcleo financeiro operacional — cálculos consolidados da agência.
 *
 * Convenções (fonte única de verdade):
 *  - Receitas do período  = Income RECEIVED (receivedAt) + Transaction
 *    type=receita não cancelada (legado/extrato importado).
 *  - Despesas do período  = Transaction type=despesa não cancelada (date).
 *  - Folha NÃO entra automaticamente em despesas: ao marcar a folha como
 *    PAGA, o sistema cria a despesa (expenseType=PAYROLL) — assim o lucro
 *    = receitas − despesas já inclui folha SEM contagem dupla.
 *  - Caixa disponível     = Σ Account.balance das contas ativas.
 *  - Projeção (30/60/90)  = caixa + cobranças abertas a vencer no horizonte
 *    − despesas pendentes no horizonte − parcelas de passivos no horizonte.
 */


// ===================================================================
// Resultado operacional do período
// ===================================================================

export type FinanceSummary = {
  receitas: number;
  despesas: number;
  despesasPagas: number;
  despesasFixas: number;
  despesasVariaveis: number;
  resultadoOperacional: number; // receitas − despesas (competência simples)
  lucro: number; // receitas − despesas pagas (caixa)
  margem: number; // lucro / receitas (0-1)
  folhaPeriodo: number;
  folhaSobreReceita: number; // 0-1
};

async function getFinanceSummaryImpl(period: Period): Promise<FinanceSummary> {
  const { start, end } = period;

  const [txReceita, incomeReceived, despesasAgg, despesasPagasAgg, fixasAgg, variaveisAgg, folhaItems] =
    await Promise.all([
      prisma.transaction.aggregate({
        where: { type: "receita", date: { gte: start, lt: end }, status: { not: "cancelado" } },
        _sum: { amount: true },
      }),
      prisma.income.aggregate({
        where: { status: "RECEIVED", receivedAt: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "despesa", date: { gte: start, lt: end }, status: { not: "cancelado" } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "despesa", date: { gte: start, lt: end }, status: "pago" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "despesa", expenseType: "FIXED", date: { gte: start, lt: end }, status: { not: "cancelado" } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "despesa", expenseType: "VARIABLE", date: { gte: start, lt: end }, status: { not: "cancelado" } },
        _sum: { amount: true },
      }),
      // Folha por competência dentro do período (runs cujo mês cai no range)
      prisma.payrollItem.findMany({
        where: { payroll: { status: { in: ["APPROVED", "PAID"] } } },
        select: { amount: true, kind: true, payroll: { select: { month: true, year: true } } },
      }),
    ]);

  const receitas = n(txReceita._sum.amount) + n(incomeReceived._sum.amount);
  const despesas = n(despesasAgg._sum.amount);
  const despesasPagas = n(despesasPagasAgg._sum.amount);

  // DEDUCTION entra NEGATIVO (mesma regra de getPayrollSummary e das séries
  // do dashboard) — sem o sinal, a folha era superestimada e contaminava
  // folhaSobreReceita, % Folha e a Saúde Financeira.
  const folhaPeriodo = folhaItems
    .filter((i) => {
      const d = new Date(i.payroll.year, i.payroll.month - 1, 1);
      return d >= new Date(start.getFullYear(), start.getMonth(), 1) && d < end;
    })
    .reduce((s, i) => s + n(i.amount) * (i.kind === "DEDUCTION" ? -1 : 1), 0);

  const lucro = receitas - despesasPagas;
  return {
    receitas,
    despesas,
    despesasPagas,
    despesasFixas: n(fixasAgg._sum.amount),
    despesasVariaveis: n(variaveisAgg._sum.amount),
    resultadoOperacional: receitas - despesas,
    lucro,
    margem: computeOperationalMargin(lucro, receitas),
    folhaPeriodo,
    folhaSobreReceita: receitas > 0 ? folhaPeriodo / receitas : 0,
  };
}

// ===================================================================
// Caixa e projeção
// ===================================================================

export type CashSummary = {
  /** Saldo das contas ATIVAS. As reservas (CashBox) saíram em 10/09/2026. */
  caixaDisponivel: number;
  contasBancarias: number;
  entradasPeriodo: number; // recebido no período
  saidasPeriodo: number; // pago no período
  saldoRealizado: number; // entradas − saídas
  saldoPrevisto: number; // + a receber aberto − a pagar pendente (sem horizonte)
  projecao30: number;
  projecao60: number;
  projecao90: number;
};

/**
 * Projeção de caixa por horizonte.
 *
 * A conta NÃO mora mais aqui (DA-01): esta função tinha a sua própria versão
 * de "projeção 30 dias" e discordava do card de Liquidez na mesma tela —
 * −R$ 26.548,53 contra −R$ 107.643,06 na auditoria de 11/09/2026. A diferença
 * vinha de somar como entrada garantida do horizonte TODA cobrança vencida do
 * passado. Agora as duas leem `projecaoDeCaixa`, que deixa o vencido de fora
 * da soma e o reporta à parte.
 */
async function projecao(dias: number): Promise<number> {
  return (await projecaoDeCaixa(dias)).projecao;
}

async function getCashSummaryImpl(period: Period): Promise<CashSummary> {
  const { start, end } = period;

  const [accounts, inflow, outflow, openBillings, pendingExpenses] =
    await Promise.all([
      prisma.account.aggregate({ where: { active: true }, _sum: { balance: true } }),
      prisma.income.aggregate({
        where: { status: "RECEIVED", receivedAt: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "despesa", status: "pago", date: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      prisma.billing.aggregate({
        where: { status: { in: [...BILLING_OPEN_STATUSES] } },
        _sum: { amount: true, paidTotal: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "despesa", status: { in: ["pendente", "devendo"] } },
        _sum: { amount: true },
      }),
    ]);

  const contasBancarias = n(accounts._sum.balance);
  const caixaDisponivel = contasBancarias;
  const entradasPeriodo = n(inflow._sum.amount);
  const saidasPeriodo = n(outflow._sum.amount);
  const aReceber = n(openBillings._sum.amount) - n(openBillings._sum.paidTotal);
  const aPagar = n(pendingExpenses._sum.amount);

  const [p30, p60, p90] = await Promise.all([
    projecao(30),
    projecao(60),
    projecao(90),
  ]);

  return {
    caixaDisponivel,
    contasBancarias,
    entradasPeriodo,
    saidasPeriodo,
    saldoRealizado: entradasPeriodo - saidasPeriodo,
    saldoPrevisto: caixaDisponivel + aReceber - aPagar,
    projecao30: p30,
    projecao60: p60,
    projecao90: p90,
  };
}

// ===================================================================
// Patrimônio (ativos × passivos)
// ===================================================================

// ===================================================================
// Folha
// ===================================================================

export type PayrollSummary = {
  runId: string | null;
  status: string | null;
  total: number; // Σ itens (descontos negativos)
  byEmployee: { employeeId: string; name: string; role: string | null; total: number }[];
  /** Itens crus da folha (já buscados) — evita rebusca na Gestão do Mês. */
  items: {
    employeeId: string;
    kind: string;
    amount: number;
    employee: { id: string; name: string; role: string | null };
  }[];
  folhaSobreReceita: number;
  /** Folha PAGA com lançamentos posteriores ainda não pagos (complemento). */
  pendingTotal: number;
};

export async function getPayrollSummary(
  month: number,
  year: number
): Promise<PayrollSummary> {
  const run = await prisma.payroll.findFirst({
    where: { month, year },
    include: {
      items: { include: { employee: { select: { id: true, name: true, role: true } } } },
    },
  });

  // Sem folha lançada no mês (caso comum ao navegar meses antigos/futuros):
  // retorna zerado ANTES dos aggregates de receita — 2 queries a menos.
  if (!run) {
    return { runId: null, status: null, total: 0, byEmployee: [], items: [], folhaSobreReceita: 0, pendingTotal: 0 };
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const [txReceita, incomeReceived] = await Promise.all([
    prisma.transaction.aggregate({
      where: { type: "receita", date: { gte: monthStart, lt: monthEnd }, status: { not: "cancelado" } },
      _sum: { amount: true },
    }),
    prisma.income.aggregate({
      where: { status: "RECEIVED", receivedAt: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
  ]);
  const receitas = n(txReceita._sum.amount) + n(incomeReceived._sum.amount);

  const byEmp = new Map<string, { employeeId: string; name: string; role: string | null; total: number }>();
  let total = 0;
  // Complemento A PAGAR: item sem carimbo de pagamento numa folha PAGA
  // (lançamento posterior — comissão que fechou no mês seguinte).
  let pendingTotal = 0;
  for (const item of run.items) {
    const amt = n(item.amount) * (item.kind === "DEDUCTION" ? -1 : 1);
    total += amt;
    if (run.status === "PAID" && item.settledAt == null) pendingTotal += amt;
    const cur = byEmp.get(item.employee.id) ?? {
      employeeId: item.employee.id,
      name: item.employee.name,
      role: item.employee.role,
      total: 0,
    };
    cur.total += amt;
    byEmp.set(item.employee.id, cur);
  }

  return {
    runId: run.id,
    status: run.status,
    total,
    byEmployee: Array.from(byEmp.values()).sort((a, b) => b.total - a.total),
    // Itens crus já buscados pelo include — consumidores (Gestão do Mês)
    // reusam em vez de rebuscar payrollItem.findMany na mesma request.
    items: run.items.map((it) => ({
      employeeId: it.employeeId,
      kind: it.kind,
      amount: n(it.amount),
      employee: { id: it.employee.id, name: it.employee.name, role: it.employee.role },
    })),
    folhaSobreReceita: receitas > 0 ? total / receitas : 0,
    pendingTotal,
  };
}

/** Versão cacheada por (usuário, argumentos) — TTL 300s, invalidada pelas tags de mutação. */
export const getFinanceSummary = ownerCached("finance-summary", getFinanceSummaryImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.DASHBOARD_METRICS],
});

/** Versão cacheada por (usuário, argumentos) — TTL 300s, invalidada pelas tags de mutação. */
export const getCashSummary = ownerCached("cash-summary", getCashSummaryImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.DASHBOARD_METRICS],
});
