import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthLabel } from "@/lib/format";
import {
  totalReceitasMes,
  totalDespesasMes,
  sobraReal,
  saldoPrevistoCompleto,
  totalEmCaixa,
  totalReservaEmergencia,
  taxaEndividamento,
  comprometimentoFaturas,
  nivelReserva,
  totalAReceber,
  totalFaturas,
  quemMeDeve,
} from "@/lib/services/calculations";

const TYPE_BELONG = ["pessoal", "empresa", "terceiro", "familiar"];

/**
 * Monta um retrato financeiro compacto do usuário para alimentar a IA.
 * Reutiliza calculations.ts e algumas consultas agregadas. Mantém-se enxuto
 * para controlar o consumo de tokens.
 */
export async function buildFinancialSnapshot(ref = new Date()) {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);

  const [
    receitas,
    despesas,
    sobra,
    saldoPrev,
    caixa,
    reserva,
    taxa,
    compr,
    nivel,
    aReceber,
    faturas,
    devedores,
    catRows,
    recentes,
    invoices,
    pessoasCount,
    cardsCount,
  ] = await Promise.all([
    totalReceitasMes(ref),
    totalDespesasMes(ref),
    sobraReal(ref),
    saldoPrevistoCompleto(ref),
    totalEmCaixa(),
    totalReservaEmergencia(),
    taxaEndividamento(ref),
    comprometimentoFaturas(ref),
    nivelReserva(ref),
    totalAReceber(),
    totalFaturas(["aberta", "fechada", "parcial", "atrasada"]),
    quemMeDeve(),
    prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { type: "despesa", status: { not: "cancelado" }, date: { gte: start, lt: end } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.transaction.findMany({
      where: { date: { gte: start, lt: end }, status: { not: "cancelado" } },
      orderBy: { date: "desc" },
      take: 15,
      include: { category: true, card: true, responsible: true },
    }),
    prisma.creditCardInvoice.findMany({
      where: { status: { in: ["aberta", "fechada", "parcial", "atrasada"] } },
      orderBy: { dueDate: "asc" },
      include: { card: true },
      take: 12,
    }),
    prisma.person.count(),
    prisma.creditCard.count(),
  ]);

  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const topCategorias = catRows
    .map((r) => ({
      categoria: r.categoryId ? catName.get(r.categoryId) ?? "—" : "Sem categoria",
      total: r._sum.amount ?? 0,
      qtde: r._count._all,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const porPertence: Record<string, number> = {};
  for (const b of TYPE_BELONG) {
    const r = await prisma.transaction.aggregate({
      where: { belongsTo: b, type: "despesa", status: { not: "cancelado" }, date: { gte: start, lt: end } },
      _sum: { amount: true },
    });
    porPertence[b] = r._sum.amount ?? 0;
  }

  return {
    periodo: monthLabel(ref),
    visaoGeral: {
      receitasMes: receitas,
      despesasMes: despesas,
      sobraRealMes: sobra,
      saldoPrevisto: saldoPrev,
      totalEmCaixa: caixa,
      reservaEmergencia: reserva,
      aReceberDeTerceiros: aReceber,
      faturasEmAberto: faturas.openAmount,
    },
    saudeFinanceira: {
      taxaEndividamentoPct: Math.round(taxa * 100),
      comprometimentoFaturasPct: Math.round(compr * 100),
      reservaMeses: Number.isFinite(nivel.meses) ? Number(nivel.meses.toFixed(1)) : null,
      reservaClassificacao: nivel.classificacao,
    },
    gastosPorCategoria: topCategorias,
    gastosPorPertencimento: porPertence,
    faturas: invoices.map((i) => ({
      conta: i.card.name,
      referencia: `${String(i.referenceMonth).padStart(2, "0")}/${i.referenceYear}`,
      vencimento: formatDateBR(i.dueDate),
      total: i.total,
      emAberto: i.total - i.paid,
      status: i.status,
    })),
    quemMeDeve: devedores.map((d: any) => ({ pessoa: d.name, total: d.total })),
    transacoesRecentes: recentes.map((t) => ({
      data: formatDateBR(t.date),
      descricao: t.description,
      valor: t.amount,
      tipo: t.type,
      categoria: t.category?.name ?? null,
      conta: t.card?.name ?? null,
      responsavel: t.responsible?.name ?? null,
      status: t.status,
    })),
    contagens: { pessoas: pessoasCount, contasBancarias: cardsCount },
  };
}

export type FinancialSnapshot = Awaited<ReturnType<typeof buildFinancialSnapshot>>;

/** Serializa o snapshot em texto enxuto e legível para o prompt. */
export function snapshotToText(s: FinancialSnapshot): string {
  const vg = s.visaoGeral;
  const sf = s.saudeFinanceira;
  const lines: string[] = [];
  lines.push(`PERÍODO DE REFERÊNCIA: ${s.periodo}`);
  lines.push(
    `VISÃO GERAL: receitas ${formatBRL(vg.receitasMes)}; despesas ${formatBRL(vg.despesasMes)}; ` +
      `sobra real ${formatBRL(vg.sobraRealMes)}; saldo previsto ${formatBRL(vg.saldoPrevisto)}; ` +
      `em caixa ${formatBRL(vg.totalEmCaixa)}; reserva ${formatBRL(vg.reservaEmergencia)}; ` +
      `a receber ${formatBRL(vg.aReceberDeTerceiros)}; faturas em aberto ${formatBRL(vg.faturasEmAberto)}.`
  );
  lines.push(
    `SAÚDE: endividamento ${sf.taxaEndividamentoPct}%; comprometimento c/ faturas ${sf.comprometimentoFaturasPct}%; ` +
      `reserva ${sf.reservaMeses ?? "—"} meses (${sf.reservaClassificacao}).`
  );
  if (s.gastosPorCategoria.length) {
    lines.push(
      "GASTOS POR CATEGORIA (mês): " +
        s.gastosPorCategoria.map((c) => `${c.categoria} ${formatBRL(c.total)} (${c.qtde}x)`).join("; ") +
        "."
    );
  }
  lines.push(
    "GASTOS POR PERTENCIMENTO: " +
      Object.entries(s.gastosPorPertencimento)
        .map(([k, v]) => `${k} ${formatBRL(v)}`)
        .join("; ") +
      "."
  );
  if (s.faturas.length) {
    lines.push(
      "FATURAS ABERTAS: " +
        s.faturas
          .map((f) => `${f.conta} ${f.referencia} vence ${f.vencimento} em aberto ${formatBRL(f.emAberto)} (${f.status})`)
          .join("; ") +
        "."
    );
  }
  if (s.quemMeDeve.length) {
    lines.push("QUEM ME DEVE: " + s.quemMeDeve.map((d) => `${d.pessoa} ${formatBRL(d.total)}`).join("; ") + ".");
  }
  if (s.transacoesRecentes.length) {
    lines.push(
      "TRANSAÇÕES RECENTES: " +
        s.transacoesRecentes
          .map((t) => `${t.data} ${t.descricao} ${formatBRL(t.valor)}${t.categoria ? ` [${t.categoria}]` : ""}${t.responsavel ? ` (${t.responsavel})` : ""}`)
          .join("; ") +
        "."
    );
  }
  lines.push(`CONTAGENS: ${s.contagens.pessoas} pessoas, ${s.contagens.contasBancarias} contas bancárias.`);
  return lines.join("\n");
}

/** Carrega as memórias (fixadas primeiro) como texto para o contexto. */
export async function loadMemoryText(limit = 40): Promise<string> {
  const mems = await prisma.aIMemory.findMany({
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
  if (!mems.length) return "";
  return mems.map((m) => `- (${m.kind}) ${m.content}`).join("\n");
}
