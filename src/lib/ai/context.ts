import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthLabel, toNumber as n } from "@/lib/format";
import {
  totalReceitasMes,
  totalDespesasMes,
  sobraReal,
  saldoPrevistoCompleto,
  totalEmCaixa,
  taxaEndividamento,
  comprometimentoFaturas,
  nivelReserva,
  totalAReceber,
  totalFaturas,
  quemMeDeve,
} from "@/lib/services/calculations";
import { hasPermission, type PermissionUser } from "@/lib/permissions";

const TYPE_BELONG = ["pessoal", "empresa", "terceiro", "familiar"];

// ---------------------------------------------------------------------------
// Privacidade POR USUÁRIO (conversas e memórias do Assistente)
// ---------------------------------------------------------------------------

/**
 * Filtro de autoria para AIConversation/AIMemory. A extensão do Prisma só
 * escopa pelo DONO do workspace — que é o mesmo para a equipe inteira —, então
 * sem este filtro um colega lia/continuava/apagava a conversa do outro.
 * Linhas legadas (userId null, anteriores a 25/09/2026) não têm autor
 * conhecido: só o ADMIN as enxerga.
 */
export function aiPrivateWhere(viewer: { id: string; role: string }) {
  if (viewer.role === "ADMIN") {
    return { OR: [{ userId: viewer.id }, { userId: null }] };
  }
  return { userId: viewer.id };
}

// ---------------------------------------------------------------------------
// Recorte do retrato pelas permissões de quem pergunta
// ---------------------------------------------------------------------------

/**
 * Quais blocos do retrato o usuário pode receber. Espelha a permissão de TELA
 * dona de cada número: a IA não pode ser uma porta dos fundos para o que o
 * usuário não vê no app.
 */
export type SnapshotVisibility = {
  receitas: boolean; // receitas.visualizar
  despesas: boolean; // despesas.visualizar
  folha: boolean; // folha.visualizar (lançamentos de folha nos detalhes)
  caixa: boolean; // caixa.visualizar (caixa, contas, faturas)
  recebiveis: boolean; // recebimentos.visualizar
  resultado: boolean; // dashboard.ver_financeiro (sobra, saldo, saúde)
};

export const FULL_SNAPSHOT_VISIBILITY: SnapshotVisibility = {
  receitas: true,
  despesas: true,
  folha: true,
  caixa: true,
  recebiveis: true,
  resultado: true,
};

export function snapshotVisibilityFor(user: PermissionUser | null | undefined): SnapshotVisibility {
  return {
    receitas: hasPermission(user, "receitas.visualizar"),
    despesas: hasPermission(user, "despesas.visualizar"),
    folha: hasPermission(user, "folha.visualizar"),
    caixa: hasPermission(user, "caixa.visualizar"),
    recebiveis: hasPermission(user, "recebimentos.visualizar"),
    resultado: hasPermission(user, "dashboard.ver_financeiro"),
  };
}

const skip = <T,>(v: T) => Promise.resolve(v);

/**
 * Monta um retrato financeiro compacto do usuário para alimentar a IA.
 * Reutiliza calculations.ts e algumas consultas agregadas. Mantém-se enxuto
 * para controlar o consumo de tokens.
 *
 * `vis` recorta o retrato pelas permissões de quem pergunta: bloco sem
 * permissão nem é consultado (fica null/vazio e some do texto). Sem
 * folha.visualizar, os lançamentos de folha (expenseType PAYROLL) saem dos
 * detalhes (categorias, pertencimento, transações recentes).
 */
export async function buildFinancialSnapshot(
  ref = new Date(),
  vis: SnapshotVisibility = FULL_SNAPSHOT_VISIBILITY
) {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  // Prisma: NOT sobre coluna anulável descartaria os nulls — daí o OR explícito.
  const semFolha = vis.folha
    ? {}
    : { OR: [{ expenseType: null }, { expenseType: { not: "PAYROLL" as const } }] };
  const tiposVisiveis = [
    ...(vis.receitas ? ["receita"] : []),
    ...(vis.despesas ? ["despesa"] : []),
  ];

  const [
    receitas,
    despesas,
    sobra,
    saldoPrev,
    caixa,
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
    vis.receitas ? totalReceitasMes(ref) : skip(null),
    vis.despesas ? totalDespesasMes(ref) : skip(null),
    vis.resultado ? sobraReal(ref) : skip(null),
    vis.resultado ? saldoPrevistoCompleto(ref) : skip(null),
    vis.caixa ? totalEmCaixa() : skip(null),
    vis.resultado ? taxaEndividamento(ref) : skip(null),
    vis.resultado ? comprometimentoFaturas(ref) : skip(null),
    vis.resultado ? nivelReserva(ref) : skip(null),
    vis.recebiveis ? totalAReceber() : skip(null),
    vis.caixa ? totalFaturas(["aberta", "fechada", "parcial", "atrasada"]) : skip(null),
    vis.recebiveis ? quemMeDeve() : skip([] as any[]),
    vis.despesas
      ? prisma.transaction.groupBy({
          by: ["categoryId"],
          where: {
            type: "despesa",
            status: { not: "cancelado" },
            date: { gte: start, lt: end },
            ...semFolha,
          },
          _sum: { amount: true },
          _count: { _all: true },
        })
      : skip([] as { categoryId: string | null; _sum: { amount: any }; _count: { _all: number } }[]),
    tiposVisiveis.length
      ? prisma.transaction.findMany({
          where: {
            date: { gte: start, lt: end },
            status: { not: "cancelado" },
            type: { in: tiposVisiveis },
            ...semFolha,
          },
          orderBy: { date: "desc" },
          take: 15,
          include: { category: true, card: true, responsible: true },
        })
      : skip([]),
    vis.caixa
      ? prisma.creditCardInvoice.findMany({
          where: { status: { in: ["aberta", "fechada", "parcial", "atrasada"] } },
          orderBy: { dueDate: "asc" },
          include: { card: true },
          take: 12,
        })
      : skip([]),
    prisma.person.count(),
    vis.caixa ? prisma.creditCard.count() : skip(null),
  ]);

  const categories = catRows.length
    ? await prisma.category.findMany({ select: { id: true, name: true } })
    : [];
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const topCategorias = catRows
    .map((r) => ({
      categoria: r.categoryId ? catName.get(r.categoryId) ?? "—" : "Sem categoria",
      total: n(r._sum.amount),
      qtde: r._count._all,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const porPertence: Record<string, number> = {};
  if (vis.despesas) {
    for (const b of TYPE_BELONG) {
      const r = await prisma.transaction.aggregate({
        where: {
          belongsTo: b,
          type: "despesa",
          status: { not: "cancelado" },
          date: { gte: start, lt: end },
          ...semFolha,
        },
        _sum: { amount: true },
      });
      porPertence[b] = n(r._sum.amount);
    }
  }

  return {
    periodo: monthLabel(ref),
    visaoGeral: {
      receitasMes: receitas,
      despesasMes: despesas,
      sobraRealMes: sobra,
      saldoPrevisto: saldoPrev,
      totalEmCaixa: caixa,
      aReceberDeTerceiros: aReceber,
      faturasEmAberto: faturas ? faturas.openAmount : null,
    },
    saudeFinanceira: vis.resultado
      ? {
          taxaEndividamentoPct: Math.round((taxa ?? 0) * 100),
          comprometimentoFaturasPct: Math.round((compr ?? 0) * 100),
          reservaMeses:
            nivel && Number.isFinite(nivel.meses) ? Number(nivel.meses.toFixed(1)) : null,
          reservaClassificacao: nivel?.classificacao ?? "—",
        }
      : null,
    gastosPorCategoria: topCategorias,
    gastosPorPertencimento: porPertence,
    faturas: invoices.map((i) => ({
      conta: i.card.name,
      referencia: `${String(i.referenceMonth).padStart(2, "0")}/${i.referenceYear}`,
      vencimento: formatDateBR(i.dueDate),
      total: i.total,
      emAberto: n(i.total) - n(i.paid),
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
  const geral: string[] = [];
  if (vg.receitasMes != null) geral.push(`receitas ${formatBRL(vg.receitasMes)}`);
  if (vg.despesasMes != null) geral.push(`despesas ${formatBRL(vg.despesasMes)}`);
  if (vg.sobraRealMes != null) geral.push(`sobra real ${formatBRL(vg.sobraRealMes)}`);
  if (vg.saldoPrevisto != null) geral.push(`saldo previsto ${formatBRL(vg.saldoPrevisto)}`);
  if (vg.totalEmCaixa != null) geral.push(`em caixa ${formatBRL(vg.totalEmCaixa)}`);
  if (vg.aReceberDeTerceiros != null) geral.push(`a receber ${formatBRL(vg.aReceberDeTerceiros)}`);
  if (vg.faturasEmAberto != null) geral.push(`faturas em aberto ${formatBRL(vg.faturasEmAberto)}`);
  if (geral.length) lines.push(`VISÃO GERAL: ${geral.join("; ")}.`);
  if (sf) {
    lines.push(
      `SAÚDE: endividamento ${sf.taxaEndividamentoPct}%; comprometimento c/ faturas ${sf.comprometimentoFaturasPct}%; ` +
        `reserva ${sf.reservaMeses ?? "—"} meses (${sf.reservaClassificacao}).`
    );
  }
  if (s.gastosPorCategoria.length) {
    lines.push(
      "GASTOS POR CATEGORIA (mês): " +
        s.gastosPorCategoria.map((c) => `${c.categoria} ${formatBRL(c.total)} (${c.qtde}x)`).join("; ") +
        "."
    );
  }
  const pertence = Object.entries(s.gastosPorPertencimento);
  if (pertence.length) {
    lines.push(
      "GASTOS POR PERTENCIMENTO: " + pertence.map(([k, v]) => `${k} ${formatBRL(v)}`).join("; ") + "."
    );
  }
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
  lines.push(
    `CONTAGENS: ${s.contagens.pessoas} pessoas` +
      (s.contagens.contasBancarias != null ? `, ${s.contagens.contasBancarias} contas bancárias` : "") +
      "."
  );
  return lines.join("\n");
}

/** Carrega as memórias (fixadas primeiro) como texto para o contexto. */
export async function loadMemoryText(
  viewer: { id: string; role: string },
  limit = 40
): Promise<string> {
  const mems = await prisma.aIMemory.findMany({
    where: aiPrivateWhere(viewer),
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
  if (!mems.length) return "";
  return mems.map((m) => `- (${m.kind}) ${m.content}`).join("\n");
}
