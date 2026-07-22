import { prisma } from "@/lib/prisma";
import { getPeriodRevenue } from "@/lib/services/revenue-metrics";
import { toNumber as n } from "@/lib/format";
import { type ReportQuery } from "../query";
import { monthsInPeriod, type ReportDef, type ReportRow } from "../shared";

async function buildFinanceiroMensal(q: ReportQuery): Promise<ReportRow[]> {
  const months = monthsInPeriod(q);
  if (months.length === 0) return [];
  const { start, end } = q.period;
  const clientWhere = q.clientId ? { clientId: q.clientId } : {};

  const [incomes, txs, payrollItems] = await Promise.all([
    prisma.income.findMany({
      where: { status: "RECEIVED", receivedAt: { gte: start, lt: end }, ...clientWhere },
      select: { receivedAt: true, amount: true },
    }),
    prisma.transaction.findMany({
      where: { date: { gte: start, lt: end }, status: { not: "cancelado" }, type: { in: ["receita", "despesa"] } },
      select: { date: true, amount: true, type: true, status: true },
    }),
    prisma.payrollItem.findMany({
      where: { payroll: { status: { in: ["APPROVED", "PAID"] } } },
      select: { amount: true, kind: true, payroll: { select: { month: true, year: true } } },
    }),
  ]);

  const key = (y: number, m: number) => `${y}-${m}`;
  const idx = new Map(months.map((mo, i) => [key(mo.y, mo.m), i]));
  const zero = () => months.map(() => 0);
  const receitas = zero();
  const despesas = zero();
  const despesasPagas = zero();
  const folha = zero();

  const bucket = (arr: number[], d: Date, v: number) => {
    const i = idx.get(key(d.getFullYear(), d.getMonth() + 1));
    if (i != null) arr[i] += v;
  };
  for (const i of incomes) bucket(receitas, i.receivedAt, n(i.amount));
  for (const t of txs) {
    if (t.type === "receita") bucket(receitas, t.date, n(t.amount));
    else {
      bucket(despesas, t.date, n(t.amount));
      if (t.status === "pago") bucket(despesasPagas, t.date, n(t.amount));
    }
  }
  for (const it of payrollItems) {
    const i = idx.get(key(it.payroll.year, it.payroll.month));
    if (i != null) folha[i] += n(it.amount) * (it.kind === "DEDUCTION" ? -1 : 1);
  }

  return months.map((mo, i) => {
    const lucro = receitas[i] - despesasPagas[i];
    return {
      mes: `${String(mo.m).padStart(2, "0")}/${mo.y}`,
      receitas: receitas[i],
      despesas: despesas[i],
      folha: folha[i],
      lucro,
      margem: receitas[i] > 0 ? Math.round((lucro / receitas[i]) * 100) : 0,
    };
  });
}

/** Faturamento total mês a mês: MRR + TCV (regra central, sem rateio). */
async function buildFaturamentoTotal(q: ReportQuery): Promise<ReportRow[]> {
  const months = monthsInPeriod(q);
  const rows: ReportRow[] = [];
  for (const mo of months) {
    const start = new Date(mo.y, mo.m - 1, 1);
    const end = new Date(mo.y, mo.m, 1);
    const r = await getPeriodRevenue(start, end, {
      salesOwner: q.responsavel ?? undefined,
      clientId: q.clientId ?? undefined,
    });
    rows.push({
      mes: `${String(mo.m).padStart(2, "0")}/${mo.y}`,
      mrr: r.mrr,
      clientesMrr: r.mrrClients,
      tcv: r.tcv,
      clientesTcv: r.tcvClients,
      total: r.total,
    });
  }
  return rows;
}

/** Margem operacional por mês (receitas × despesas × folha). */
async function buildMargemOperacional(q: ReportQuery): Promise<ReportRow[]> {
  const rows = await buildFinanceiroMensal(q);
  return rows.map((r) => ({
    mes: r.mes,
    receitas: r.receitas,
    despesas: r.despesas,
    folha: r.folha,
    lucro: r.lucro,
    margem: r.margem,
  }));
}

export const financeiroMensalReport: ReportDef = {
  key: "financeiro-mensal",
  title: "Financeiro mensal",
  description: "Receitas, despesas, folha, lucro e margem, mês a mês.",
  columns: [
    { key: "mes", label: "Mês", kind: "text" },
    { key: "receitas", label: "Receitas", kind: "money", total: true },
    { key: "despesas", label: "Despesas", kind: "money", total: true },
    { key: "folha", label: "Folha", kind: "money", total: true },
    { key: "lucro", label: "Lucro/prejuízo", kind: "money", total: true },
    { key: "margem", label: "Margem", kind: "percent" },
  ],
  filterFields: ["periodo", "cliente"],
  groupOptions: [],
  defaultSort: { key: "mes", dir: "asc" },
  defaultPeriodo: "ano",
  build: buildFinanceiroMensal,
};
