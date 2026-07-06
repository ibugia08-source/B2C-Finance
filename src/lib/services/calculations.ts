import { prisma } from "@/lib/prisma";
import { monthRange } from "@/lib/format";

export async function totalDespesasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const result = await prisma.transaction.aggregate({
    where: { type: "despesa", date: { gte: start, lt: end }, status: { not: "cancelado" } },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
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
  return (tx._sum.amount ?? 0) + (inc._sum.amount ?? 0);
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
  return inc._sum.amount ?? 0;
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
  return r._sum.amount ?? 0;
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
  return r._sum.amount ?? 0;
}

export async function faturasPagasMes(reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const r = await prisma.creditCardInvoice.aggregate({
    where: { status: "paga", dueDate: { gte: start, lt: end } },
    _sum: { paid: true },
  });
  return r._sum.paid ?? 0;
}

export async function totalEmCaixa() {
  const r = await prisma.cashBox.aggregate({ _sum: { currentAmount: true } });
  return r._sum.currentAmount ?? 0;
}

export async function totalReservaEmergencia() {
  const r = await prisma.cashBox.aggregate({
    where: { type: "EMERGENCY" },
    _sum: { currentAmount: true },
  });
  return r._sum.currentAmount ?? 0;
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

export async function saldoPrevistoMes(reference: Date = new Date()) {
  const r = await totalReceitasMes(reference);
  const d = await totalDespesasMes(reference);
  return r - d;
}

export async function totalPorPessoa() {
  const rows = await prisma.transaction.groupBy({
    by: ["responsibleId"],
    _sum: { amount: true },
    where: { status: { not: "cancelado" }, type: "despesa" },
  });
  const people = await prisma.person.findMany();
  return rows.map((r) => ({
    personId: r.responsibleId,
    name: people.find((p) => p.id === r.responsibleId)?.name ?? "Sem responsável",
    total: r._sum.amount ?? 0,
  }));
}

export async function totalPorCartao() {
  const rows = await prisma.transaction.groupBy({
    by: ["cardId"],
    _sum: { amount: true },
    where: { status: { not: "cancelado" }, type: "despesa", cardId: { not: null } },
  });
  const cards = await prisma.creditCard.findMany();
  return rows.map((r) => ({
    cardId: r.cardId,
    name: cards.find((c) => c.id === r.cardId)?.name ?? "?",
    total: r._sum.amount ?? 0,
  }));
}

export async function totalAReceber() {
  const r = await prisma.receivable.aggregate({
    where: { status: { in: ["aberto", "atrasado", "renegociado"] } },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

export async function totalFaturas(status?: string[]) {
  const r = await prisma.creditCardInvoice.aggregate({
    where: status ? { status: { in: status } } : undefined,
    _sum: { total: true, paid: true },
  });
  const total = r._sum.total ?? 0;
  const paid = r._sum.paid ?? 0;
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
      Math.max(0, (r._sum.total ?? 0) - (r._sum.paid ?? 0)),
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
  return Math.max(0, card.limitTotal - used);
}

/**
 * PROJEÇÃO de parcelas futuras por cartão, calculada a partir dos METADADOS
 * das transações importadas (installmentNumber/installmentTotal) — nenhuma
 * parcela futura existe no banco. Para cada grupo de parcelamento considera a
 * parcela mais recente vista: restante = (total − nº atual) × valor da parcela.
 */
export async function parcelasFuturasEstimadasPorCartao(
  cardIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>(cardIds.map((id) => [id, 0]));
  if (cardIds.length === 0) return result;

  const txs = await prisma.transaction.findMany({
    where: {
      cardId: { in: cardIds },
      installmentTotal: { gt: 1 },
      status: { not: "cancelado" },
    },
    select: {
      cardId: true,
      amount: true,
      installmentNumber: true,
      installmentTotal: true,
      installmentGroupKey: true,
      date: true,
    },
  });

  // Última parcela vista por grupo (sem grupo → trata a própria linha como grupo)
  const latestByGroup = new Map<string, (typeof txs)[number]>();
  for (const t of txs) {
    const key = t.installmentGroupKey ?? `solo:${t.cardId}:${t.date.getTime()}:${t.amount}`;
    const prev = latestByGroup.get(key);
    if (!prev || (t.installmentNumber ?? 0) > (prev.installmentNumber ?? 0)) {
      latestByGroup.set(key, t);
    }
  }

  for (const t of latestByGroup.values()) {
    if (!t.cardId || !t.installmentTotal) continue;
    const current = t.installmentNumber ?? 1;
    const remaining = Math.max(0, t.installmentTotal - current) * t.amount;
    result.set(t.cardId, (result.get(t.cardId) ?? 0) + remaining);
  }
  return result;
}

export async function parcelasFuturas() {
  const today = new Date();
  return prisma.installment.findMany({
    where: { paid: false, dueDate: { gte: today } },
    orderBy: { dueDate: "asc" },
    include: { transaction: { include: { card: true } } },
  });
}

export async function gastosPorPertenceA(belongsTo: string, reference: Date = new Date()) {
  const { start, end } = monthRange(reference);
  const r = await prisma.transaction.aggregate({
    where: {
      belongsTo,
      type: "despesa",
      date: { gte: start, lt: end },
      status: { not: "cancelado" },
    },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

export async function quemMeDeve() {
  const rows = await prisma.receivable.groupBy({
    by: ["personId"],
    _sum: { amount: true },
    where: { status: { in: ["aberto", "atrasado", "renegociado"] } },
  });
  const people = await prisma.person.findMany();
  return rows.map((r) => ({
    personId: r.personId,
    name: people.find((p) => p.id === r.personId)?.name ?? "?",
    total: r._sum.amount ?? 0,
  }));
}

export type DashboardSummary = {
  receitas: number;
  despesas: number;
  faturas: { total: number; paid: number; openAmount: number };
  aReceber: number;
  porPertenceA: { pessoal: number; empresa: number; terceiro: number; familiar: number };
  caixa: number;
  taxaEndividamento: number;
  sobraReal: number;
  receitasPrevistas: number;
  despesasPrevistas: number;
};

/**
 * Todas as métricas do dashboard em UMA passada: ~11 queries em paralelo e
 * derivações em memória (antes: ~25 aggregates, vários repetidos em série).
 */
export async function getDashboardSummary(
  reference: Date = new Date()
): Promise<DashboardSummary> {
  const { start, end } = monthRange(reference);

  const [
    txReceitaAgg,
    incomeReceivedAgg,
    despesasAgg,
    faturasAgg,
    aReceberAgg,
    belongsToRows,
    caixaAgg,
    despesasPrevAgg,
    despesasPagasAgg,
    faturasPagasAgg,
    receitasPrevAgg,
  ] = await Promise.all([
    prisma.transaction.aggregate({
      where: { type: "receita", date: { gte: start, lt: end }, status: { not: "cancelado" } },
      _sum: { amount: true },
    }),
    prisma.income.aggregate({
      where: { receivedAt: { gte: start, lt: end }, status: "RECEIVED" },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { type: "despesa", date: { gte: start, lt: end }, status: { not: "cancelado" } },
      _sum: { amount: true },
    }),
    prisma.creditCardInvoice.aggregate({
      where: { status: { in: ["aberta", "fechada", "parcial", "atrasada"] } },
      _sum: { total: true, paid: true },
    }),
    prisma.receivable.aggregate({
      where: { status: { in: ["aberto", "atrasado", "renegociado"] } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["belongsTo"],
      where: { type: "despesa", date: { gte: start, lt: end }, status: { not: "cancelado" } },
      _sum: { amount: true },
    }),
    prisma.cashBox.aggregate({ _sum: { currentAmount: true } }),
    prisma.transaction.aggregate({
      where: {
        type: "despesa",
        date: { gte: start, lt: end },
        status: { in: ["pendente", "devendo"] },
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { type: "despesa", date: { gte: start, lt: end }, status: "pago" },
      _sum: { amount: true },
    }),
    prisma.creditCardInvoice.aggregate({
      where: { status: "paga", dueDate: { gte: start, lt: end } },
      _sum: { paid: true },
    }),
    prisma.income.aggregate({
      where: { receivedAt: { gte: start, lt: end }, status: { in: ["EXPECTED", "LATE"] } },
      _sum: { amount: true },
    }),
  ]);

  const receitas = (txReceitaAgg._sum.amount ?? 0) + (incomeReceivedAgg._sum.amount ?? 0);
  const faturaTotal = faturasAgg._sum.total ?? 0;
  const faturaPaid = faturasAgg._sum.paid ?? 0;
  const faturas = { total: faturaTotal, paid: faturaPaid, openAmount: faturaTotal - faturaPaid };
  const despesasPrevistas = despesasPrevAgg._sum.amount ?? 0;

  const byBelongs = new Map(belongsToRows.map((r) => [r.belongsTo, r._sum.amount ?? 0]));
  const obrig = faturas.openAmount + despesasPrevistas;

  return {
    receitas,
    despesas: despesasAgg._sum.amount ?? 0,
    faturas,
    aReceber: aReceberAgg._sum.amount ?? 0,
    porPertenceA: {
      pessoal: byBelongs.get("pessoal") ?? 0,
      empresa: byBelongs.get("empresa") ?? 0,
      terceiro: byBelongs.get("terceiro") ?? 0,
      familiar: byBelongs.get("familiar") ?? 0,
    },
    caixa: caixaAgg._sum.currentAmount ?? 0,
    taxaEndividamento: receitas <= 0 ? (obrig > 0 ? 1 : 0) : obrig / receitas,
    sobraReal:
      receitas - (despesasPagasAgg._sum.amount ?? 0) - (faturasPagasAgg._sum.paid ?? 0),
    receitasPrevistas: receitasPrevAgg._sum.amount ?? 0,
    despesasPrevistas,
  };
}
