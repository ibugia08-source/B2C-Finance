import { prisma } from "@/lib/prisma";
import { limitesUsadosPorCartao } from "./calculations";
import { toNumber as n } from "@/lib/format";

/**
 * Métricas de DESPESAS + cartões (mini dashboard do módulo Despesas e
 * bloco de despesas da Dashboard principal).
 *
 * Convenções:
 *  - "Vencida" é estado DERIVADO: pendente/devendo com dueDate < hoje
 *    (nenhuma reescrita de dados — a UI e os filtros derivam).
 *  - "Total em cartão" = despesas do mês com tipo CARTÃO (expenseType=CARD)
 *    ou lançadas em cartão (cardId).
 *  - "Débitos em faturas" = faturas de cartão em aberto (total − pago).
 */


export type ExpenseSummary = {
  total: number; // despesas do mês (não canceladas)
  count: number;
  paid: number; // pagas
  pending: number; // pendentes dentro do prazo
  overdue: number; // vencidas (pendente + dueDate < hoje)
  overdueCount: number;
  recurring: number; // despesas recorrentes do mês
  recurringCount: number;
  cardExpenses: number; // despesas tipo cartão no mês
  invoiceOpenTotal: number; // débitos em faturas de cartão (aberto)
  creditLimitTotal: number;
  creditLimitUsed: number;
  creditLimitAvailable: number;
  upcoming: { id: string; description: string; amount: number; dueDate: Date }[];
};

export async function getExpenseSummary(reference: Date = new Date()): Promise<ExpenseSummary> {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in7 = new Date(today);
  in7.setDate(in7.getDate() + 7);

  const [monthTx, openInvoices, cards, upcoming] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { not: "cancelado" },
        date: { gte: start, lt: end },
      },
      select: {
        amount: true,
        status: true,
        dueDate: true,
        recurrence: true,
        recurrenceGroupId: true,
        expenseType: true,
        cardId: true,
      },
    }),
    prisma.creditCardInvoice.findMany({
      where: { status: { in: ["aberta", "fechada", "atrasada", "parcial"] } },
      select: { total: true, paid: true },
    }),
    prisma.creditCard.findMany({
      where: { active: true },
      select: { id: true, limitTotal: true },
    }),
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { in: ["pendente", "devendo"] },
        dueDate: { gte: today, lt: in7 },
      },
      orderBy: { dueDate: "asc" },
      take: 8,
      select: { id: true, description: true, amount: true, dueDate: true },
    }),
  ]);

  let total = 0, paid = 0, pending = 0, overdue = 0, overdueCount = 0;
  let recurring = 0, recurringCount = 0, cardExpenses = 0;
  for (const t of monthTx) {
    const v = n(t.amount);
    total += v;
    if (t.status === "pago") paid += v;
    else if (t.dueDate && t.dueDate < today) {
      overdue += v;
      overdueCount += 1;
    } else {
      pending += v;
    }
    const isRecurring =
      t.recurrenceGroupId != null || (t.recurrence != null && t.recurrence !== "NONE");
    if (isRecurring) {
      recurring += v;
      recurringCount += 1;
    }
    if (t.expenseType === "CARD" || t.cardId != null) cardExpenses += v;
  }

  const invoiceOpenTotal = openInvoices.reduce(
    (s, i) => s + Math.max(0, n(i.total) - n(i.paid)),
    0
  );

  const usedByCard = await limitesUsadosPorCartao(cards.map((c) => c.id));
  const creditLimitTotal = cards.reduce((s, c) => s + n(c.limitTotal), 0);
  const creditLimitUsed = cards.reduce((s, c) => s + (usedByCard.get(c.id) ?? 0), 0);

  return {
    total,
    count: monthTx.length,
    paid,
    pending,
    overdue,
    overdueCount,
    recurring,
    recurringCount,
    cardExpenses,
    invoiceOpenTotal,
    creditLimitTotal,
    creditLimitUsed,
    creditLimitAvailable: Math.max(0, creditLimitTotal - creditLimitUsed),
    upcoming: upcoming.map((u) => ({
      id: u.id,
      description: u.description,
      amount: n(u.amount),
      dueDate: u.dueDate!,
    })),
  };
}
