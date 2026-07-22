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
 *  - Caixa disponível     = Σ Account.balance + Σ CashBox.currentAmount.
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
    margem: receitas > 0 ? lucro / receitas : 0,
    folhaPeriodo,
    folhaSobreReceita: receitas > 0 ? folhaPeriodo / receitas : 0,
  };
}

// ===================================================================
// Caixa e projeção
// ===================================================================

export type CashSummary = {
  caixaDisponivel: number; // contas + caixinhas
  contasBancarias: number;
  reservas: number; // caixinhas
  entradasPeriodo: number; // recebido no período
  saidasPeriodo: number; // pago no período
  saldoRealizado: number; // entradas − saídas
  saldoPrevisto: number; // + a receber aberto − a pagar pendente (sem horizonte)
  projecao30: number;
  projecao60: number;
  projecao90: number;
};

async function projecao(caixa: number, dias: number): Promise<number> {
  const limite = new Date();
  limite.setDate(limite.getDate() + dias);
  const meses = Math.ceil(dias / 30);

  const [entradas, saidas, passivos] = await Promise.all([
    prisma.billing.aggregate({
      where: {
        status: { in: [...BILLING_OPEN_STATUSES] },
        dueDate: { lte: limite },
      },
      _sum: { amount: true, paidTotal: true },
    }),
    prisma.transaction.aggregate({
      where: {
        type: "despesa",
        status: { in: ["pendente", "devendo"] },
        OR: [{ dueDate: { lte: limite } }, { dueDate: null, date: { lte: limite } }],
      },
      _sum: { amount: true },
    }),
    prisma.liability.aggregate({
      where: { monthlyPayment: { not: null }, remainingValue: { gt: 0 } },
      _sum: { monthlyPayment: true },
    }),
  ]);

  return (
    caixa +
    (n(entradas._sum.amount) - n(entradas._sum.paidTotal)) -
    n(saidas._sum.amount) -
    n(passivos._sum.monthlyPayment) * meses
  );
}

async function getCashSummaryImpl(period: Period): Promise<CashSummary> {
  const { start, end } = period;

  const [accounts, boxes, inflow, outflow, openBillings, pendingExpenses] =
    await Promise.all([
      prisma.account.aggregate({ where: { active: true }, _sum: { balance: true } }),
      prisma.cashBox.aggregate({ _sum: { currentAmount: true } }),
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
  const reservas = n(boxes._sum.currentAmount);
  const caixaDisponivel = contasBancarias + reservas;
  const entradasPeriodo = n(inflow._sum.amount);
  const saidasPeriodo = n(outflow._sum.amount);
  const aReceber = n(openBillings._sum.amount) - n(openBillings._sum.paidTotal);
  const aPagar = n(pendingExpenses._sum.amount);

  const [p30, p60, p90] = await Promise.all([
    projecao(caixaDisponivel, 30),
    projecao(caixaDisponivel, 60),
    projecao(caixaDisponivel, 90),
  ]);

  return {
    caixaDisponivel,
    contasBancarias,
    reservas,
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

export type BalanceSummary = {
  // ativos
  contas: number;
  reservas: number;
  aReceber: number; // cobranças abertas
  ativosManuais: number; // Asset (equipamentos, investimentos, créditos…)
  ativosTotais: number;
  // passivos
  contasAPagar: number; // despesas pendentes
  faturasCartao: number; // faturas de cartão em aberto
  passivosManuais: number; // Liability.remainingValue
  passivosTotais: number;
  saldoPatrimonial: number;
};

export async function getBalanceSummary(): Promise<BalanceSummary> {
  const [accounts, boxes, billings, assets, pendingExpenses, invoices, liabilities] =
    await Promise.all([
      prisma.account.aggregate({ where: { active: true }, _sum: { balance: true } }),
      prisma.cashBox.aggregate({ _sum: { currentAmount: true } }),
      prisma.billing.aggregate({
        where: { status: { in: [...BILLING_OPEN_STATUSES] } },
        _sum: { amount: true, paidTotal: true },
      }),
      prisma.asset.aggregate({ _sum: { value: true } }),
      prisma.transaction.aggregate({
        where: { type: "despesa", status: { in: ["pendente", "devendo"] } },
        _sum: { amount: true },
      }),
      prisma.creditCardInvoice.aggregate({
        where: { status: { in: ["aberta", "fechada", "parcial", "atrasada"] } },
        _sum: { total: true, paid: true },
      }),
      prisma.liability.aggregate({ _sum: { remainingValue: true } }),
    ]);

  const contas = n(accounts._sum.balance);
  const reservas = n(boxes._sum.currentAmount);
  const aReceber = n(billings._sum.amount) - n(billings._sum.paidTotal);
  const ativosManuais = n(assets._sum.value);
  const ativosTotais = contas + reservas + aReceber + ativosManuais;

  const contasAPagar = n(pendingExpenses._sum.amount);
  const faturasCartao = n(invoices._sum.total) - n(invoices._sum.paid);
  const passivosManuais = n(liabilities._sum.remainingValue);
  const passivosTotais = contasAPagar + faturasCartao + passivosManuais;

  return {
    contas,
    reservas,
    aReceber,
    ativosManuais,
    ativosTotais,
    contasAPagar,
    faturasCartao,
    passivosManuais,
    passivosTotais,
    saldoPatrimonial: ativosTotais - passivosTotais,
  };
}

// ===================================================================
// Folha
// ===================================================================

export type PayrollSummary = {
  runId: string | null;
  status: string | null;
  total: number; // Σ itens (descontos negativos)
  byEmployee: { employeeId: string; name: string; role: string | null; total: number }[];
  folhaSobreReceita: number;
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

  if (!run) {
    return { runId: null, status: null, total: 0, byEmployee: [], folhaSobreReceita: 0 };
  }

  const byEmp = new Map<string, { employeeId: string; name: string; role: string | null; total: number }>();
  let total = 0;
  for (const item of run.items) {
    const amt = n(item.amount) * (item.kind === "DEDUCTION" ? -1 : 1);
    total += amt;
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
    folhaSobreReceita: receitas > 0 ? total / receitas : 0,
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
