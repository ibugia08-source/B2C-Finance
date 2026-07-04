import { prisma } from "@/lib/prisma";

export type MonthlyHistory = {
  labels: string[];
  receitas: number[];
  despesas: number[];
  caixa: number[];
};

function shortLabel(d: Date): string {
  const m = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  // mostra o ano em janeiro para delimitar o histórico
  return d.getMonth() === 0 ? `${m}/${String(d.getFullYear()).slice(2)}` : m;
}

/**
 * Série mensal dos últimos meses COM histórico (no máx. 12).
 * - receitas: Income(RECEIVED) + Transaction(receita) por mês
 * - despesas: Transaction(despesa, ≠ cancelado) por mês
 * - caixa: saldo do caixa no fim de cada mês = saldo atual − movimentações posteriores
 */
export async function getMonthlyHistory(maxMonths = 12): Promise<MonthlyHistory> {
  const now = new Date();

  const [firstIncome, firstTx, firstMov, caixaAgg] = await Promise.all([
    prisma.income.findFirst({ orderBy: { receivedAt: "asc" }, select: { receivedAt: true } }),
    prisma.transaction.findFirst({
      where: { type: { in: ["despesa", "receita"] } },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    prisma.cashBoxMovement.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    prisma.cashBox.aggregate({ _sum: { currentAmount: true } }),
  ]);

  const caixaNow = caixaAgg._sum.currentAmount ?? 0;
  const dataDates = [firstIncome?.receivedAt, firstTx?.date, firstMov?.date].filter(
    Boolean
  ) as Date[];

  let count = 6;
  if (dataDates.length > 0) {
    const earliest = new Date(Math.min(...dataDates.map((d) => d.getTime())));
    const diff =
      (now.getFullYear() - earliest.getFullYear()) * 12 +
      (now.getMonth() - earliest.getMonth());
    count = Math.min(maxMonths, Math.max(6, diff + 1));
  }

  // buckets do mais antigo ao mais recente
  const months = Array.from({ length: count }, (_, k) => {
    const i = count - 1 - k;
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    return { start, end, label: shortLabel(start) };
  });
  const rangeStart = months[0].start;

  const [incomes, txs, movements] = await Promise.all([
    prisma.income.findMany({
      where: { status: "RECEIVED", receivedAt: { gte: rangeStart } },
      select: { receivedAt: true, amount: true },
    }),
    prisma.transaction.findMany({
      where: { type: { in: ["despesa", "receita"] }, status: { not: "cancelado" }, date: { gte: rangeStart } },
      select: { date: true, amount: true, type: true },
    }),
    prisma.cashBoxMovement.findMany({ select: { date: true, amount: true, type: true } }),
  ]);

  const receitas = months.map(() => 0);
  const despesas = months.map(() => 0);

  const idxOf = (d: Date) => months.findIndex((m) => d >= m.start && d < m.end);

  for (const inc of incomes) {
    const i = idxOf(inc.receivedAt);
    if (i >= 0) receitas[i] += inc.amount;
  }
  for (const t of txs) {
    const i = idxOf(t.date);
    if (i < 0) continue;
    if (t.type === "despesa") despesas[i] += t.amount;
    else receitas[i] += t.amount;
  }

  const caixa = months.map((m) => {
    let netAfter = 0;
    for (const mv of movements) {
      if (mv.date >= m.end) netAfter += mv.type === "IN" ? mv.amount : -mv.amount;
    }
    return caixaNow - netAfter;
  });

  return {
    labels: months.map((m) => m.label),
    receitas: receitas.map((v) => Number(v.toFixed(2))),
    despesas: despesas.map((v) => Number(v.toFixed(2))),
    caixa: caixa.map((v) => Number(v.toFixed(2))),
  };
}
