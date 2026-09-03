import { prisma } from "@/lib/prisma";
import { monthRange, toNumber as n } from "@/lib/format";

export async function totalDespesasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const result = await prisma.transaction.aggregate({
    where: { type: "despesa", date: { gte: start, lt: end }, status: { not: "cancelado" } },
    _sum: { amount: true },
  });
  return n(result._sum.amount);
}

export async function totalReceitasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const tx = await prisma.transaction.aggregate({
    where: { type: "receita", date: { gte: start, lt: end }, status: { not: "cancelado" } },
    _sum: { amount: true },
  });
  // Considera apenas receitas efetivamente recebidas no mês
  const inc = await prisma.income.aggregate({
    where: { receivedAt: { gte: start, lt: end }, status: "RECEIVED" },
    _sum: { amount: true },
  });
  return (n(tx._sum.amount)) + (n(inc._sum.amount));
}

export async function receitasPrevistasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const inc = await prisma.income.aggregate({
    where: {
      receivedAt: { gte: start, lt: end },
      status: { in: ["EXPECTED", "LATE"] },
    },
    _sum: { amount: true },
  });
  return n(inc._sum.amount);
}

export async function despesasPrevistasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const r = await prisma.transaction.aggregate({
    where: {
      type: "despesa",
      date: { gte: start, lt: end },
      status: { in: ["pendente", "devendo"] },
    },
    _sum: { amount: true },
  });
  return n(r._sum.amount);
}

export async function despesasPagasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const r = await prisma.transaction.aggregate({
    where: {
      type: "despesa",
      date: { gte: start, lt: end },
      status: "pago",
    },
    _sum: { amount: true },
  });
  return n(r._sum.amount);
}

export async function faturasPagasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const r = await prisma.creditCardInvoice.aggregate({
    where: { status: "paga", dueDate: { gte: start, lt: end } },
    _sum: { paid: true },
  });
  return n(r._sum.paid);
}

export async function totalEmCaixa() {
  const r = await prisma.cashBox.aggregate({ _sum: { currentAmount: true } });
  return n(r._sum.currentAmount);
}

export async function totalReservaEmergencia() {
  const r = await prisma.cashBox.aggregate({
    where: { type: "EMERGENCY" },
    _sum: { currentAmount: true },
  });
  return n(r._sum.currentAmount);
}

export async function taxaEndividamento(reference: Date = new Date()) {
  const receitas = await totalReceitasMes(reference);
  const faturas = await totalFaturas(["aberta", "fechada", "parcial", "atrasada"]);
  const desp = await despesasPrevistasMes(reference);
  const obrig = faturas.openAmount + desp;
  if (receitas <= 0) return obrig > 0 ? 1 : 0;
  return obrig / receitas;
}

export async function sobraReal(reference: Date = new Date()) {
  const receitasRecebidas = await totalReceitasMes(reference);
  const despesasPagas = await despesasPagasMes(reference);
  const faturasPagas = await faturasPagasMes(reference);
  return receitasRecebidas - despesasPagas - faturasPagas;
}

export async function saldoPrevistoCompleto(reference: Date = new Date()) {
  const recRec = await totalReceitasMes(reference);
  const recPrev = await receitasPrevistasMes(reference);
  const aReceber = await totalAReceber();
  const desp = await despesasPrevistasMes(reference);
  const faturas = await totalFaturas(["aberta", "fechada", "parcial", "atrasada"]);
  return recRec + recPrev + aReceber - desp - faturas.openAmount;
}

export async function comprometimentoFaturas(reference: Date = new Date()) {
  const receitas = await totalReceitasMes(reference);
  const faturas = await totalFaturas(["aberta", "fechada", "parcial", "atrasada"]);
  if (receitas <= 0) return faturas.openAmount > 0 ? 1 : 0;
  return faturas.openAmount / receitas;
}

export async function nivelReserva(reference: Date = new Date()) {
  const caixa = await totalEmCaixa();
  const desp = await totalDespesasMes(reference);
  if (desp <= 0) return { meses: caixa > 0 ? Infinity : 0, classificacao: caixa > 0 ? "Forte" : "Sem reserva" };
  const meses = caixa / desp;
  let classificacao: "Sem reserva" | "Baixa" | "Boa" | "Forte" = "Sem reserva";
  if (meses >= 6) classificacao = "Forte";
  else if (meses >= 3) classificacao = "Boa";
  else if (meses > 0) classificacao = "Baixa";
  return { meses, classificacao };
}

export async function totalAReceber() {
  const r = await prisma.receivable.aggregate({
    where: { status: { in: ["aberto", "atrasado", "renegociado"] } },
    _sum: { amount: true },
  });
  return n(r._sum.amount);
}

export async function totalFaturas(status?: string[]) {
  const r = await prisma.creditCardInvoice.aggregate({
    where: status ? { status: { in: status } } : undefined,
    _sum: { total: true, paid: true },
  });
  const total = n(r._sum.total);
  const paid = n(r._sum.paid);
  return { total, paid, openAmount: total - paid };
}

/**
 * Limite usado por cartão em UMA query (groupBy) para vários cartões.
 * Substitui limiteUsado/limiteDisponivel chamados em loop por cartão.
 */
export async function limitesUsadosPorCartao(
  cardIds: string[]
): Promise<Map<string, number>> {
  if (cardIds.length === 0) return new Map();
  const rows = await prisma.creditCardInvoice.groupBy({
    by: ["cardId"],
    where: { cardId: { in: cardIds }, status: { in: ["aberta", "fechada", "parcial"] } },
    _sum: { total: true, paid: true },
  });
  return new Map(
    rows.map((r) => [
      r.cardId,
      Math.max(0, (n(r._sum.total)) - (n(r._sum.paid))),
    ])
  );
}

export async function limiteUsado(cardId: string) {
  const map = await limitesUsadosPorCartao([cardId]);
  return map.get(cardId) ?? 0;
}

export async function limiteDisponivel(cardId: string) {
  const [card, used] = await Promise.all([
    prisma.creditCard.findUnique({ where: { id: cardId } }),
    limiteUsado(cardId),
  ]);
  if (!card) return 0;
  return Math.max(0, n(card.limitTotal) - used);
}

export async function quemMeDeve() {
  const rows = await prisma.receivable.groupBy({
    by: ["personId"],
    _sum: { amount: true },
    where: { status: { in: ["aberto", "atrasado", "renegociado"] } },
  });
  const personIds = rows.map((r) => r.personId).filter((id): id is string => id != null);
  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    personId: r.personId,
    name: r.personId ? (nameMap.get(r.personId) ?? "?") : "?",
    total: n(r._sum.amount),
  }));
}
