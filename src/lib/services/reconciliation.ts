import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { competenceOf, type Competence } from "@/lib/competence";
import { hashDaLinha, lerExtrato } from "@/lib/reconciliation/parse";
import type { ReconciliationState } from "@prisma/client";

/**
 * CONCILIAÇÃO BANCÁRIA (F3.5 · ref. 01 §4.7; 02 §4.4).
 *
 * A regra que governa o arquivo inteiro, e que 02 §4.4 escreve em três
 * palavras: **NADA SILENCIOSO**. A conciliação NUNCA cria receita nem despesa
 * por conta própria. Ela liga o que o banco diz ao que o sistema já sabe; o
 * que sobra vira diferença VISÍVEL e depende de alguém decidir.
 *
 * Por que isso não é preciosismo: conciliação que "resolve sozinha" a
 * diferença é como um sistema financeiro passa a ter uma receita que ninguém
 * vendeu ou uma despesa que ninguém aprovou. O erro entra pelo caminho que
 * mais parece correto — o extrato bate — e só aparece meses depois, na
 * apuração do contador.
 *
 * O ESTADO É SEMPRE DERIVADO dos matches, nunca escrito pela tela:
 *
 *   sem match                      → UNMATCHED
 *   soma dos matches = valor       → MATCHED
 *   soma parcial                   → PARTIAL
 *   marcada como ignorada          → IGNORED
 *   confirmada com diferença       → REVIEW  (a "proposta de ajuste")
 *
 * Estado escrito à mão é estado que um dia discorda dos matches — e aí o
 * "% conciliado" do fechamento vira um número que ninguém consegue auditar.
 */

/** Tolerância de centavos ao comparar somas de dinheiro. */
const CENTAVO = 0.005;

export type AlvoDeMatch = "PAYMENT" | "TRANSACTION" | "INCOME" | "CASHBOX_MOVEMENT";

// ---------------------------------------------------------------------------
// Importação
// ---------------------------------------------------------------------------

export type ResultadoDaImportacao = {
  ok: true;
  statementId: string;
  lidas: number;
  importadas: number;
  duplicadas: number;
  erros: { linha: number; erro: string }[];
  formato: "OFX" | "CSV";
};

export async function importarExtrato(
  accountId: string,
  fileName: string,
  conteudo: string
): Promise<ResultadoDaImportacao | { ok: false; error: string }> {
  const conta = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!conta) return { ok: false, error: "Conta não encontrada." };

  const lido = lerExtrato(conteudo);
  if (lido.linhas.length === 0) {
    return {
      ok: false,
      error:
        lido.erros[0]?.erro ??
        "Nenhum movimento encontrado no arquivo. Envie o extrato em OFX ou CSV.",
    };
  }

  const comHash = lido.linhas.map((l) => ({ ...l, hash: hashDaLinha(accountId, l) }));

  // Deduplicação em DOIS lugares: contra o que já está no banco e dentro do
  // próprio arquivo. Extrato reexportado com um dia a mais é o caso normal —
  // reimportar não pode duplicar movimento.
  const existentes = new Set(
    (
      await prisma.bankStatementEntry.findMany({
        where: { accountId, hash: { in: comHash.map((l) => l.hash) } },
        select: { hash: true },
      })
    ).map((e) => e.hash)
  );
  const vistos = new Set<string>();
  const novas = comHash.filter((l) => {
    if (existentes.has(l.hash) || vistos.has(l.hash)) return false;
    vistos.add(l.hash);
    return true;
  });

  const statement = await prisma.bankStatement.create({
    data: {
      accountId,
      fileName,
      format: lido.formato,
      periodStart: lido.periodStart ?? new Date(),
      periodEnd: lido.periodEnd ?? new Date(),
      openingBalance: lido.openingBalance,
      closingBalance: lido.closingBalance,
    },
    select: { id: true },
  });

  if (novas.length > 0) {
    await prisma.bankStatementEntry.createMany({
      data: novas.map((l) => ({
        statementId: statement.id,
        accountId,
        externalId: l.externalId,
        hash: l.hash,
        postedAt: l.postedAt,
        amount: l.amount,
        description: l.description,
        balanceAfter: l.balanceAfter,
      })),
    });
  }

  return {
    ok: true,
    statementId: statement.id,
    lidas: lido.linhas.length,
    importadas: novas.length,
    duplicadas: lido.linhas.length - novas.length,
    erros: lido.erros,
    formato: lido.formato,
  };
}

// ---------------------------------------------------------------------------
// Sugestão de match
// ---------------------------------------------------------------------------

export type Sugestao = {
  targetType: AlvoDeMatch;
  targetId: string;
  descricao: string;
  data: Date;
  amount: number;
  confidence: number;
  motivo: string;
};

/** Diferença em dias entre duas datas (absoluta). */
function dias(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

/**
 * Confiança de uma sugestão. Escala pequena e explicável de propósito: o
 * número aparece na tela ao lado do "Confirmar", e uma pontuação que ninguém
 * sabe ler faz a pessoa confirmar tudo sem olhar — que é o pior desfecho
 * possível para uma conciliação.
 */
function confiancaDe(entrada: { amount: number; postedAt: Date }, alvo: { amount: number; data: Date }) {
  const mesmoValor = Math.abs(Math.abs(alvo.amount) - Math.abs(entrada.amount)) < CENTAVO;
  const d = dias(entrada.postedAt, alvo.data);
  if (mesmoValor && d === 0) return { confidence: 98, motivo: "mesmo valor, mesmo dia" };
  if (mesmoValor && d <= 3) return { confidence: 85, motivo: `mesmo valor, ${d} ${d === 1 ? "dia" : "dias"} de diferença` };
  if (mesmoValor && d <= 10) return { confidence: 60, motivo: `mesmo valor, ${d} dias de diferença` };
  return null;
}

/**
 * O que no sistema pode ser esta linha do banco.
 *
 * Entrada positiva procura DINHEIRO QUE ENTROU (pagamento de cliente, receita
 * avulsa); negativa procura dinheiro que saiu (despesa paga). Procurar nos
 * dois lados encheria a tela de sugestões absurdas — e cada sugestão errada
 * gasta a atenção que a linha difícil precisa.
 */
export async function sugerirMatches(entryId: string): Promise<Sugestao[]> {
  const e = await prisma.bankStatementEntry.findUnique({
    where: { id: entryId },
    select: { id: true, accountId: true, amount: true, postedAt: true, description: true },
  });
  if (!e) return [];

  const valor = n(e.amount);
  const de = new Date(e.postedAt.getTime() - 10 * 86_400_000);
  const ate = new Date(e.postedAt.getTime() + 10 * 86_400_000);

  const jaCasados = new Set(
    (
      await prisma.reconciliationMatch.findMany({
        where: { entry: { accountId: e.accountId } },
        select: { targetType: true, targetId: true },
      })
    ).map((m) => `${m.targetType}:${m.targetId}`)
  );

  const out: Sugestao[] = [];

  if (valor > 0) {
    const pagamentos = await prisma.payment.findMany({
      where: {
        status: "CONFIRMED",
        paidAt: { gte: de, lte: ate },
        OR: [{ accountId: e.accountId }, { accountId: null }],
      },
      select: {
        id: true, amount: true, paidAt: true,
        billing: { select: { description: true, client: { select: { name: true } } } },
      },
      take: 200,
    });
    for (const p of pagamentos) {
      if (jaCasados.has(`PAYMENT:${p.id}`)) continue;
      const c = confiancaDe({ amount: valor, postedAt: e.postedAt }, { amount: n(p.amount), data: p.paidAt });
      if (!c) continue;
      out.push({
        targetType: "PAYMENT", targetId: p.id,
        descricao: `${p.billing.client.name} — ${p.billing.description}`,
        data: p.paidAt, amount: n(p.amount), ...c,
      });
    }

    const receitas = await prisma.income.findMany({
      where: { status: "RECEIVED", receivedAt: { gte: de, lte: ate }, billingId: null },
      select: { id: true, amount: true, receivedAt: true, description: true },
      take: 200,
    });
    for (const r of receitas) {
      if (jaCasados.has(`INCOME:${r.id}`)) continue;
      const c = confiancaDe({ amount: valor, postedAt: e.postedAt }, { amount: n(r.amount), data: r.receivedAt });
      if (!c) continue;
      out.push({
        targetType: "INCOME", targetId: r.id,
        descricao: r.description || "Receita avulsa",
        data: r.receivedAt, amount: n(r.amount), ...c,
      });
    }
  } else {
    const despesas = await prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { in: ["pago", "pendente"] },
        date: { gte: de, lte: ate },
      },
      select: { id: true, amount: true, date: true, description: true },
      take: 300,
    });
    for (const d of despesas) {
      if (jaCasados.has(`TRANSACTION:${d.id}`)) continue;
      const c = confiancaDe({ amount: valor, postedAt: e.postedAt }, { amount: n(d.amount), data: d.date });
      if (!c) continue;
      out.push({
        targetType: "TRANSACTION", targetId: d.id,
        descricao: d.description,
        data: d.date, amount: -n(d.amount), ...c,
      });
    }
  }

  // Movimento de reserva vale para os dois sentidos: transferir para o caixa
  // de impostos sai da conta e volta como entrada no resgate.
  const reservas = await prisma.cashBoxMovement.findMany({
    where: { date: { gte: de, lte: ate }, cashBox: { accountId: e.accountId } },
    select: { id: true, amount: true, date: true, description: true, type: true },
    take: 100,
  });
  for (const m of reservas) {
    if (jaCasados.has(`CASHBOX_MOVEMENT:${m.id}`)) continue;
    const assinado = m.type === "IN" ? -n(m.amount) : n(m.amount);
    if (Math.sign(assinado) !== Math.sign(valor)) continue;
    const c = confiancaDe({ amount: valor, postedAt: e.postedAt }, { amount: assinado, data: m.date });
    if (!c) continue;
    out.push({
      targetType: "CASHBOX_MOVEMENT", targetId: m.id,
      descricao: m.description || (m.type === "IN" ? "Guardado na reserva" : "Resgate da reserva"),
      data: m.date, amount: assinado, ...c,
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Confirmação e estado
// ---------------------------------------------------------------------------

/**
 * Recalcula o estado de uma linha A PARTIR dos matches. Ponto único.
 *
 * `emRevisao` é a "proposta de ajuste" de 02 §4.4: alguém confirmou a
 * conciliação sabendo que sobra diferença, e a diferença fica escrita na
 * linha em vez de sumir.
 */
export async function recalcularEstado(
  entryId: string,
  opts: { emRevisao?: string | null } = {}
): Promise<{ state: ReconciliationState; diferenca: number }> {
  const e = await prisma.bankStatementEntry.findUnique({
    where: { id: entryId },
    select: { id: true, amount: true, state: true, note: true },
  });
  if (!e) throw new Error("Linha do extrato não encontrada.");

  const matches = await prisma.reconciliationMatch.findMany({
    where: { entryId },
    select: { amount: true },
  });
  const soma = Math.round(matches.reduce((s, m) => s + n(m.amount), 0) * 100) / 100;
  const valor = n(e.amount);
  const diferenca = Math.round((valor - soma) * 100) / 100;

  let state: ReconciliationState;
  if (opts.emRevisao) state = "REVIEW";
  else if (matches.length === 0) state = e.state === "IGNORED" ? "IGNORED" : "UNMATCHED";
  else if (Math.abs(diferenca) < CENTAVO) state = "MATCHED";
  else state = "PARTIAL";

  await prisma.bankStatementEntry.update({
    where: { id: entryId },
    data: {
      state,
      note: opts.emRevisao ?? (state === "MATCHED" || state === "UNMATCHED" ? null : e.note),
    },
  });
  return { state, diferenca };
}

export type EntradaDeMatch = {
  entryId: string;
  alvos: { targetType: AlvoDeMatch; targetId: string; amount: number; confidence?: number }[];
  /** Confirmar mesmo com diferença, escrevendo o porquê (proposta de ajuste). */
  aceitarDiferenca?: string | null;
};

/**
 * Substitui os matches de uma linha e recalcula o estado.
 *
 * Substituição, não acréscimo, pela mesma razão do rateio: a tela é uma
 * decisão sobre a linha inteira, e somar duas versões da mesma decisão
 * conciliaria o dobro do que o banco movimentou.
 */
export async function conciliar(
  input: EntradaDeMatch
): Promise<
  | { ok: true; state: ReconciliationState; diferenca: number }
  | { ok: false; error: string }
> {
  const e = await prisma.bankStatementEntry.findUnique({
    where: { id: input.entryId },
    select: { id: true, amount: true },
  });
  if (!e) return { ok: false, error: "Linha do extrato não encontrada." };

  const chaves = input.alvos.map((a) => `${a.targetType}:${a.targetId}`);
  if (new Set(chaves).size !== chaves.length)
    return { ok: false, error: "O mesmo lançamento aparece duas vezes nesta conciliação." };
  if (input.alvos.some((a) => a.amount === 0))
    return { ok: false, error: "Um lançamento com valor zero não concilia nada." };

  const soma = Math.round(input.alvos.reduce((s, a) => s + a.amount, 0) * 100) / 100;
  const valor = n(e.amount);
  const diferenca = Math.round((valor - soma) * 100) / 100;

  const { contextFromRequest } = await import("@/lib/engines/context");
  const { auditEvent } = await import("@/lib/audit");
  const ctx = await contextFromRequest();

  await prisma.$transaction(async (tx) => {
    await tx.reconciliationMatch.deleteMany({ where: { entryId: e.id } });
    if (input.alvos.length > 0) {
      await tx.reconciliationMatch.createMany({
        data: input.alvos.map((a) => ({
          entryId: e.id,
          targetType: a.targetType,
          targetId: a.targetId,
          amount: a.amount,
          confidence: a.confidence ?? 0,
          confirmedAt: new Date(),
          confirmedBy: ctx.actorEmail,
        })),
      });
    }
    await auditEvent(tx as any, "BankStatementEntry", e.id, "CREATE", {
      ...ctx,
      reason:
        input.alvos.length === 0
          ? "Conciliação desfeita."
          : `Conciliado com ${input.alvos.length} ${input.alvos.length === 1 ? "lançamento" : "lançamentos"}; diferença ${diferenca.toFixed(2)}.`,
    });
  });

  const r = await recalcularEstado(e.id, {
    emRevisao:
      Math.abs(diferenca) >= CENTAVO && input.aceitarDiferenca
        ? `${input.aceitarDiferenca} (diferença de ${diferenca.toFixed(2)})`
        : null,
  });
  return { ok: true, ...r };
}

// ---------------------------------------------------------------------------
// F5.3 — conciliação automática e entrada Open Finance
// ---------------------------------------------------------------------------

export type ResultadoAutomatico = {
  examinadas: number;
  conciliadas: number;
  /** O que ficou para gente, com o porquê — a fila mostra, nunca esconde. */
  deixadas: { entryId: string; descricao: string; motivo: string }[];
};

/**
 * CONCILIAÇÃO AUTOMÁTICA (F5.3 · ref. 02 §4.4; 03 roadmap Fase 5).
 *
 * Só concilia sozinha quando a resposta é ÓBVIA: exatamente UM candidato,
 * mesmo valor, no máximo 3 dias de distância (confiança ≥ 85). DOIS
 * candidatos é decisão humana — o automático que escolhe "o mais provável"
 * entre dois lançamentos iguais é o automático que concilia o lançamento
 * errado e deixa o certo sobrando no fim do mês, com a diferença apontando
 * para o lugar errado. Diferença de valor idem. E a regra de sempre continua:
 * NUNCA cria lançamento — linha sem par continua sem par, à vista.
 */
export async function conciliarAutomaticamente(
  accountId: string,
  competence: Competence
): Promise<ResultadoAutomatico> {
  const linhas = await linhasDaConta(accountId, competence);
  const pendentes = linhas.filter((l) => l.state === "UNMATCHED");
  const out: ResultadoAutomatico = { examinadas: pendentes.length, conciliadas: 0, deixadas: [] };

  for (const l of pendentes) {
    const sugestoes = await sugerirMatches(l.id);
    if (sugestoes.length === 0) {
      out.deixadas.push({ entryId: l.id, descricao: l.description, motivo: "Nenhum lançamento parecido no sistema." });
      continue;
    }
    if (sugestoes.length > 1) {
      out.deixadas.push({
        entryId: l.id, descricao: l.description,
        motivo: `${sugestoes.length} lançamentos possíveis — escolha humana.`,
      });
      continue;
    }
    const s = sugestoes[0];
    if (s.confidence < 85) {
      out.deixadas.push({ entryId: l.id, descricao: l.description, motivo: `Candidato distante demais (${s.motivo}).` });
      continue;
    }
    const r = await conciliar({
      entryId: l.id,
      alvos: [{ targetType: s.targetType, targetId: s.targetId, amount: s.amount, confidence: s.confidence }],
    });
    if (r.ok && r.state === "MATCHED") out.conciliadas += 1;
    else
      out.deixadas.push({
        entryId: l.id, descricao: l.description,
        motivo: r.ok ? `Sobrou diferença de ${r.diferenca.toFixed(2)}.` : r.error,
      });
  }
  return out;
}

export type MovimentoDoBanco = {
  /** Id do movimento NA ORIGEM (Open Finance sempre tem). */
  externalId: string | null;
  postedAt: Date;
  /** Sinal do banco: positivo entrou, negativo saiu. */
  amount: number;
  description: string;
  balanceAfter: number | null;
};

/**
 * ENTRADA DE MOVIMENTOS SEM ARQUIVO (F5.3 — Open Finance).
 *
 * O mesmo caminho da importação de extrato, sem o arquivo: dedupe pelo MESMO
 * hash (reconexão de banco reenvia a mesma janela de dias — é o caso normal,
 * não a exceção), extrato com origem marcada, e a conciliação automática
 * rodando em seguida nas competências afetadas. O que ela não resolver cai
 * na trilha de conciliação do Modo Fila, como sempre.
 */
export async function registrarMovimentosDoBanco(
  accountId: string,
  movimentos: MovimentoDoBanco[],
  origem = "openfinance"
): Promise<
  | { ok: true; statementId: string | null; importadas: number; duplicadas: number; conciliadas: number }
  | { ok: false; error: string }
> {
  const conta = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!conta) return { ok: false, error: "Conta não encontrada." };

  const validos = movimentos.filter(
    (m) => Number.isFinite(m.amount) && m.amount !== 0 && !Number.isNaN(m.postedAt.getTime())
  );
  if (validos.length === 0) return { ok: false, error: "Nenhum movimento legível no lote." };

  const comHash = validos.map((m) => ({ ...m, hash: hashDaLinha(accountId, m) }));
  const existentes = new Set(
    (
      await prisma.bankStatementEntry.findMany({
        where: { accountId, hash: { in: comHash.map((l) => l.hash) } },
        select: { hash: true },
      })
    ).map((e) => e.hash)
  );
  const vistos = new Set<string>();
  const novas = comHash.filter((l) => {
    if (existentes.has(l.hash) || vistos.has(l.hash)) return false;
    vistos.add(l.hash);
    return true;
  });

  let statementId: string | null = null;
  if (novas.length > 0) {
    const datas = novas.map((m) => m.postedAt.getTime());
    const statement = await prisma.bankStatement.create({
      data: {
        accountId,
        fileName: `${origem} · ${new Intl.DateTimeFormat("pt-BR").format(new Date())}`,
        format: origem.toUpperCase(),
        periodStart: new Date(Math.min(...datas)),
        periodEnd: new Date(Math.max(...datas)),
      },
      select: { id: true },
    });
    statementId = statement.id;
    await prisma.bankStatementEntry.createMany({
      data: novas.map((l) => ({
        statementId: statement.id,
        accountId,
        externalId: l.externalId,
        hash: l.hash,
        postedAt: l.postedAt,
        amount: l.amount,
        description: l.description,
        balanceAfter: l.balanceAfter,
      })),
    });
  }

  // A conciliação automática roda por competência afetada — inclusive quando
  // nada novo entrou: o par pode ter sido lançado DEPOIS da última entrada.
  const competencias = [...new Set(validos.map((m) => competenceOf(m.postedAt)))];
  let conciliadas = 0;
  for (const c of competencias) {
    const r = await conciliarAutomaticamente(accountId, c as Competence);
    conciliadas += r.conciliadas;
  }

  return {
    ok: true,
    statementId,
    importadas: novas.length,
    duplicadas: validos.length - novas.length,
    conciliadas,
  };
}

/**
 * Marca a linha como "não é do sistema" — tarifa já lançada em outro lugar,
 * movimento entre contas próprias, estorno do banco.
 *
 * IGNORAR EXIGE MOTIVO. Uma linha ignorada some do trabalho e continua
 * contando como conciliada; sem motivo escrito, ninguém consegue reconstruir
 * seis meses depois por que o extrato foi dado por fechado.
 */
export async function ignorarLinha(entryId: string, motivo: string) {
  const texto = (motivo ?? "").trim();
  if (texto.length < 5) return { ok: false as const, error: "Escreva por que esta linha é ignorada." };

  const { contextFromRequest } = await import("@/lib/engines/context");
  const { auditEvent } = await import("@/lib/audit");
  const ctx = await contextFromRequest({ reason: texto });

  await prisma.$transaction(async (tx) => {
    await tx.reconciliationMatch.deleteMany({ where: { entryId } });
    await tx.bankStatementEntry.update({
      where: { id: entryId },
      data: { state: "IGNORED", note: texto },
    });
    await auditEvent(tx as any, "BankStatementEntry", entryId, "DELETE", ctx);
  });
  return { ok: true as const };
}

/** Devolve a linha para a fila de trabalho. */
export async function reabrirLinha(entryId: string) {
  await prisma.bankStatementEntry.update({
    where: { id: entryId },
    data: { state: "UNMATCHED", note: null },
  });
  await recalcularEstado(entryId);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// O quanto do mês está conciliado (fechamento · 01 §5.3 item 8; 01 §7.6)
// ---------------------------------------------------------------------------

/**
 * Mínimo de conciliação por conta relevante.
 *
 * 03 §57 prevê isto como PARÂMETRO de fechamento, em Configurações. Enquanto
 * a tela de parâmetros não existe, a constante mora aqui, com o nome à vista —
 * é melhor um número explícito num lugar só do que um número mágico repetido
 * em três telas.
 */
export const MINIMO_CONCILIADO = 95;

export type SituacaoDaConta =
  /** Sem movimento no mês: 19.37 manda só confirmar saldo. */
  | "PARADA"
  /** Teve movimento e ninguém importou o extrato. */
  | "SEM_EXTRATO"
  | "ABAIXO_DO_MINIMO"
  | "OK";

export type ContaConciliada = {
  accountId: string;
  nome: string;
  movimentosNoSistema: number;
  linhas: number;
  resolvidas: number;
  pendentes: number;
  percentual: number | null;
  situacao: SituacaoDaConta;
  /** Saldo que o banco declarou no último extrato do mês, quando há. */
  saldoDoBanco: number | null;
  saldoDoSistema: number;
};

export type ResumoDaConciliacao = {
  competence: Competence;
  contas: ContaConciliada[];
  /** Contas que tiveram movimento e não estão no mínimo. */
  pendentes: number;
  percentualGeral: number | null;
};

export async function resumoDaConciliacao(
  competence: Competence
): Promise<ResumoDaConciliacao> {
  const [y, m] = competence.split("-").map(Number);
  const inicio = new Date(y, m - 1, 1);
  const fim = new Date(y, m, 1);

  const contas = await prisma.account.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, balance: true },
  });
  if (contas.length === 0)
    return { competence, contas: [], pendentes: 0, percentualGeral: null };

  const ids = contas.map((c) => c.id);
  const [despesas, pagamentos, receitas, linhas, extratos] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids }, date: { gte: inicio, lt: fim } },
      _count: true,
    }),
    prisma.payment.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids }, paidAt: { gte: inicio, lt: fim } },
      _count: true,
    }),
    prisma.income.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids }, receivedAt: { gte: inicio, lt: fim } },
      _count: true,
    }),
    prisma.bankStatementEntry.groupBy({
      by: ["accountId", "state"],
      where: { accountId: { in: ids }, postedAt: { gte: inicio, lt: fim } },
      _count: true,
    }),
    prisma.bankStatement.findMany({
      where: { accountId: { in: ids }, periodEnd: { gte: inicio, lt: fim } },
      orderBy: { periodEnd: "desc" },
      select: { accountId: true, closingBalance: true },
    }),
  ]);

  const contar = (
    grupos: { accountId: string | null; _count: number }[],
    id: string
  ) => grupos.find((g) => g.accountId === id)?._count ?? 0;

  // MATCHED e IGNORED contam como resolvidas: ignorar com motivo é uma
  // decisão tomada, não uma pendência escondida (o motivo fica na linha e na
  // trilha). PARTIAL e REVIEW continuam pendentes de propósito — "quase
  // conciliado" é o estado em que a diferença mora.
  const RESOLVIDAS = new Set(["MATCHED", "IGNORED"]);

  const saida: ContaConciliada[] = contas.map((c) => {
    const movimentos =
      contar(despesas as any, c.id) + contar(pagamentos as any, c.id) + contar(receitas as any, c.id);
    const doExtrato = linhas.filter((l) => l.accountId === c.id);
    const total = doExtrato.reduce((s, l) => s + l._count, 0);
    const resolvidas = doExtrato
      .filter((l) => RESOLVIDAS.has(l.state))
      .reduce((s, l) => s + l._count, 0);
    const percentual = total > 0 ? Math.round((resolvidas / total) * 1000) / 10 : null;

    let situacao: SituacaoDaConta;
    if (total === 0 && movimentos === 0) situacao = "PARADA";
    else if (total === 0) situacao = "SEM_EXTRATO";
    else if ((percentual ?? 0) < MINIMO_CONCILIADO) situacao = "ABAIXO_DO_MINIMO";
    else situacao = "OK";

    return {
      accountId: c.id,
      nome: c.name,
      movimentosNoSistema: movimentos,
      linhas: total,
      resolvidas,
      pendentes: total - resolvidas,
      percentual,
      situacao,
      saldoDoBanco:
        extratos.find((e) => e.accountId === c.id && e.closingBalance != null)?.closingBalance != null
          ? n(extratos.find((e) => e.accountId === c.id && e.closingBalance != null)!.closingBalance!)
          : null,
      saldoDoSistema: n(c.balance),
    };
  });

  const totalLinhas = saida.reduce((s, c) => s + c.linhas, 0);
  const totalResolvidas = saida.reduce((s, c) => s + c.resolvidas, 0);

  return {
    competence,
    contas: saida,
    pendentes: saida.filter((c) => c.situacao === "SEM_EXTRATO" || c.situacao === "ABAIXO_DO_MINIMO")
      .length,
    percentualGeral:
      totalLinhas > 0 ? Math.round((totalResolvidas / totalLinhas) * 1000) / 10 : null,
  };
}

/** As linhas de uma conta no mês, com os matches já resolvidos para a tela. */
export async function linhasDaConta(accountId: string, competence: Competence) {
  const [y, m] = competence.split("-").map(Number);
  const entradas = await prisma.bankStatementEntry.findMany({
    where: {
      accountId,
      postedAt: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) },
    },
    orderBy: [{ postedAt: "asc" }, { createdAt: "asc" }],
    include: { matches: true },
  });
  return entradas.map((e) => {
    const soma = Math.round(e.matches.reduce((s, mm) => s + n(mm.amount), 0) * 100) / 100;
    return {
      id: e.id,
      postedAt: e.postedAt,
      amount: n(e.amount),
      description: e.description,
      state: e.state,
      note: e.note,
      conciliado: soma,
      diferenca: Math.round((n(e.amount) - soma) * 100) / 100,
      matches: e.matches.map((mm) => ({
        id: mm.id,
        targetType: mm.targetType as AlvoDeMatch,
        targetId: mm.targetId,
        amount: n(mm.amount),
      })),
    };
  });
}
