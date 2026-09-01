import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { competenceOf, type Competence } from "@/lib/competence";
import { distribuirPorPeso, naoAlocado, type Fatia } from "@/lib/allocations/split";
import type { AllocationDimension, AllocationMethod } from "@prisma/client";

/**
 * MOTOR DE RATEIO (F3.4 · ref. 01 §4.7, §6.5; 02 §4.4).
 *
 * O rateio NÃO cria nem apaga despesa: ele distribui uma despesa que já
 * existe, já está reconhecida por competência e já postou no razão. É por
 * isso que este arquivo não chama o AccountingEngine em lugar nenhum — e a
 * consequência precisa estar clara para quem lê os números: **o DRE não muda
 * quando o rateio muda**. O que muda é a margem de contribuição de cada
 * cliente. Quem espera ver o resultado do mês mexer depois de ratear a fatura
 * de mídia está lendo a tela errada.
 *
 * O QUE É "RATEIO OBRIGATÓRIO" (a definição vale para o fechamento inteiro):
 * despesa de MÍDIA — `expenseType = ADS`. É o custo que só significa alguma
 * coisa quando se sabe de qual cliente ele é; o resto do overhead é rateio
 * futuro ("margem totalmente alocada", 01 §7.4) e não trava fechamento.
 *
 * NÃO ALOCADO É PRIMEIRA CLASSE (01 §4.7). Sobra não é erro: é a parte da
 * mídia que a agência gastou em campanha própria, teste ou prospecção. O que
 * seria erro é a sobra sumir da tela — daí "aceito como não alocado" ser uma
 * resposta legítima do checklist de fechamento, ao lado de "rateado".
 */

export const SOURCE_TRANSACTION = "TRANSACTION";

export type LinhaDeRateio = {
  id: string;
  dimensionType: AllocationDimension;
  dimensionId: string;
  nome: string;
  amount: number;
  percentage: number | null;
  method: AllocationMethod;
  ruleId: string | null;
  ruleName: string | null;
};

export type RateioDaOrigem = {
  sourceId: string;
  descricao: string;
  data: Date;
  competence: Competence;
  total: number;
  alocado: number;
  naoAlocado: number;
  linhas: LinhaDeRateio[];
};

/** Competência do CUSTO. A compra é a despesa (01 §4.8), então vale a data. */
export function competenciaDaDespesa(t: { date: Date }): Competence {
  return competenceOf(t.date);
}

// ---------------------------------------------------------------------------
// Nomes das dimensões
// ---------------------------------------------------------------------------

/**
 * Traduz os ids das três dimensões para nomes de tela de uma vez só.
 *
 * Em bloco porque a tela de rateio mostra dezenas de linhas: resolver nome a
 * nome faria uma consulta por fatia.
 */
export async function nomesDasDimensoes(
  linhas: { dimensionType: AllocationDimension; dimensionId: string }[]
): Promise<Map<string, string>> {
  const por = (t: AllocationDimension) =>
    [...new Set(linhas.filter((l) => l.dimensionType === t).map((l) => l.dimensionId))];
  const [clientes, agencias, servicos] = await Promise.all([
    por("CLIENT").length
      ? prisma.client.findMany({ where: { id: { in: por("CLIENT") } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    por("AGENCY").length
      ? prisma.agency.findMany({ where: { id: { in: por("AGENCY") } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    por("SERVICE").length
      ? prisma.service.findMany({ where: { id: { in: por("SERVICE") } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const m = new Map<string, string>();
  for (const c of clientes) m.set(`CLIENT:${c.id}`, c.name);
  for (const a of agencias) m.set(`AGENCY:${a.id}`, a.name);
  for (const s of servicos) m.set(`SERVICE:${s.id}`, s.name);
  return m;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** O rateio de UMA despesa, com o não alocado calculado. */
export async function rateioDaOrigem(sourceId: string): Promise<RateioDaOrigem | null> {
  const t = await prisma.transaction.findUnique({
    where: { id: sourceId },
    select: { id: true, description: true, amount: true, date: true },
  });
  if (!t) return null;

  const alocacoes = await prisma.allocation.findMany({
    where: { sourceType: SOURCE_TRANSACTION, sourceId },
    orderBy: { amount: "desc" },
    include: { rule: { select: { name: true } } },
  });
  const nomes = await nomesDasDimensoes(alocacoes);

  const linhas: LinhaDeRateio[] = alocacoes.map((a) => ({
    id: a.id,
    dimensionType: a.dimensionType,
    dimensionId: a.dimensionId,
    nome: nomes.get(`${a.dimensionType}:${a.dimensionId}`) ?? "(removido)",
    amount: n(a.amount),
    percentage: a.percentage == null ? null : n(a.percentage),
    method: a.method,
    ruleId: a.ruleId,
    ruleName: a.rule?.name ?? null,
  }));

  const total = n(t.amount);
  const alocado = linhas.reduce((s, l) => s + l.amount, 0);
  return {
    sourceId: t.id,
    descricao: t.description,
    data: t.date,
    competence: competenciaDaDespesa(t),
    total,
    alocado: Math.round(alocado * 100) / 100,
    naoAlocado: naoAlocado(total, linhas),
    linhas,
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export type EntradaDeRateio = {
  sourceId: string;
  linhas: {
    dimensionType: AllocationDimension;
    dimensionId: string;
    amount: number;
    percentage?: number | null;
    method?: AllocationMethod;
    ruleId?: string | null;
  }[];
  motivo?: string | null;
};

/**
 * Grava o rateio de uma despesa SUBSTITUINDO o que havia.
 *
 * Substituição em vez de acréscimo porque a tela é uma distribuição, não uma
 * lista: quem reabre e muda 40/60 para 50/50 está corrigindo a mesma decisão,
 * e somar as duas versões daria 200% da fatura.
 *
 * Pipeline de 03 §4.1: permissão -> guarda de período -> validação -> escrita
 * -> trilha. Sem razão contábil, porque rateio não posta (ver cabeçalho).
 */
export async function salvarRateio(
  input: EntradaDeRateio
): Promise<{ ok: true; linhas: number; naoAlocado: number } | { ok: false; error: string }> {
  const { guardPermission, guardPeriod } = await import("@/lib/engines/guards");

  const perm = await guardPermission("rateios.editar");
  if (!perm.ok) return perm;

  const t = await prisma.transaction.findUnique({
    where: { id: input.sourceId },
    select: { id: true, amount: true, date: true, type: true, status: true },
  });
  if (!t) return { ok: false, error: "Despesa não encontrada." };
  if (t.type !== "despesa") return { ok: false, error: "Só despesa entra em rateio." };
  if (t.status === "cancelado")
    return { ok: false, error: "Despesa cancelada não entra em rateio." };

  const competence = competenciaDaDespesa(t);

  // O rateio reescreve a margem de contribuição daquela competência. Num mês
  // fechado isso é mudar um número que já foi publicado — passa pela mesma
  // porta de todo o resto: reabrir com justificativa.
  const periodo = await guardPeriod("ALLOCATION_CHANGED", competence);
  if (!periodo.ok) return periodo;

  const total = n(t.amount);
  for (const l of input.linhas) {
    if (!(l.amount > 0))
      return { ok: false, error: "Toda linha do rateio precisa de um valor maior que zero." };
  }
  const chaves = input.linhas.map((l) => `${l.dimensionType}:${l.dimensionId}`);
  if (new Set(chaves).size !== chaves.length)
    return { ok: false, error: "A mesma dimensão aparece duas vezes no rateio." };

  const soma = Math.round(input.linhas.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  if (soma > total + 0.005)
    return {
      ok: false,
      error: `O rateio soma ${soma.toFixed(2)} e a despesa é de ${total.toFixed(2)}.`,
    };

  const { auditEvent } = await import("@/lib/audit");
  const { contextFromRequest } = await import("@/lib/engines/context");
  const ctx = await contextFromRequest({ reason: input.motivo ?? null });

  await prisma.$transaction(async (tx) => {
    await tx.allocation.deleteMany({
      where: { sourceType: SOURCE_TRANSACTION, sourceId: t.id },
    });
    if (input.linhas.length > 0) {
      await tx.allocation.createMany({
        data: input.linhas.map((l) => ({
          sourceType: SOURCE_TRANSACTION,
          sourceId: t.id,
          dimensionType: l.dimensionType,
          dimensionId: l.dimensionId,
          amount: l.amount,
          percentage: l.percentage ?? Number(((l.amount / total) * 100).toFixed(6)),
          method: l.method ?? "MANUAL",
          ruleId: l.ruleId ?? null,
          competence,
        })),
      });
    }
    // A trilha guarda a DECISÃO, não cada fatia: "rateei em 3 linhas e
    // deixei R$ 240 sem dono" é a frase que responde a pergunta seis meses
    // depois; três linhas com valores soltos, não.
    await auditEvent(tx as any, "Allocation", t.id, "CREATE", {
      ...ctx,
      reason:
        input.motivo ??
        `Rateio de ${input.linhas.length} ${input.linhas.length === 1 ? "linha" : "linhas"}; não alocado ${(total - soma).toFixed(2)}.`,
    });
  });

  return {
    ok: true,
    linhas: input.linhas.length,
    naoAlocado: Math.round((total - soma) * 100) / 100,
  };
}

/**
 * Distribui uma despesa por PESOS e grava. `pesos` vazio limpa o rateio.
 *
 * O peso é o gesto real da tela ("estes cinco clientes, este por 2"): a
 * conversão para centavos que fecham exatamente é do módulo puro.
 */
export async function ratearPorPeso(
  sourceId: string,
  dimensionType: AllocationDimension,
  pesos: { id: string; peso: number }[],
  opts: { valor?: number; motivo?: string } = {}
) {
  const t = await prisma.transaction.findUnique({
    where: { id: sourceId },
    select: { amount: true },
  });
  if (!t) return { ok: false as const, error: "Despesa não encontrada." };

  const total = opts.valor ?? n(t.amount);
  const fatias: Fatia[] = pesos.length === 0 ? [] : distribuirPorPeso(total, pesos);
  return salvarRateio({
    sourceId,
    motivo: opts.motivo,
    linhas: fatias.map((f) => ({
      dimensionType,
      dimensionId: f.id,
      amount: f.amount,
      percentage: f.percentage,
      method: "PROPORTIONAL" as AllocationMethod,
    })),
  });
}

// ---------------------------------------------------------------------------
// A competência inteira: o que precisa de rateio, o que já tem
// ---------------------------------------------------------------------------

/** Faixa de datas de uma competência (a despesa é datada, não competenciada). */
function faixa(competence: Competence) {
  const [y, m] = competence.split("-").map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

export type DespesaParaRatear = RateioDaOrigem & {
  categoria: string | null;
  cartao: string | null;
};

/**
 * As despesas de MÍDIA da competência, com o rateio de cada uma.
 *
 * Só mídia (`expenseType = ADS`) porque é o rateio que a spec chama de
 * obrigatório. Trazer todas as despesas aqui transformaria a tela num segundo
 * "Contas a pagar" e enterraria as dez linhas que realmente precisam de
 * decisão.
 */
export async function despesasParaRatear(
  competence: Competence
): Promise<DespesaParaRatear[]> {
  const { start, end } = faixa(competence);
  const despesas = await prisma.transaction.findMany({
    where: {
      type: "despesa",
      expenseType: "ADS",
      status: { not: "cancelado" },
      date: { gte: start, lt: end },
    },
    orderBy: [{ amount: "desc" }],
    select: {
      id: true, description: true, amount: true, date: true,
      category: { select: { name: true } },
      card: { select: { name: true } },
    },
  });
  if (despesas.length === 0) return [];

  const alocacoes = await prisma.allocation.findMany({
    where: { sourceType: SOURCE_TRANSACTION, sourceId: { in: despesas.map((d) => d.id) } },
    include: { rule: { select: { name: true } } },
  });
  const nomes = await nomesDasDimensoes(alocacoes);

  const porOrigem = new Map<string, typeof alocacoes>();
  for (const a of alocacoes) {
    const lista = porOrigem.get(a.sourceId) ?? [];
    lista.push(a);
    porOrigem.set(a.sourceId, lista);
  }

  return despesas.map((d) => {
    const linhas: LinhaDeRateio[] = (porOrigem.get(d.id) ?? [])
      .map((a) => ({
        id: a.id,
        dimensionType: a.dimensionType,
        dimensionId: a.dimensionId,
        nome: nomes.get(`${a.dimensionType}:${a.dimensionId}`) ?? "(removido)",
        amount: n(a.amount),
        percentage: a.percentage == null ? null : n(a.percentage),
        method: a.method,
        ruleId: a.ruleId,
        ruleName: a.rule?.name ?? null,
      }))
      .sort((x, y) => y.amount - x.amount);
    const total = n(d.amount);
    const alocado = Math.round(linhas.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    return {
      sourceId: d.id,
      descricao: d.description,
      data: d.date,
      competence,
      total,
      alocado,
      naoAlocado: naoAlocado(total, linhas),
      linhas,
      categoria: d.category?.name ?? null,
      cartao: d.card?.name ?? null,
    };
  });
}

export type ResumoDoRateio = {
  competence: Competence;
  /** Quantas despesas de mídia existem na competência. */
  despesas: number;
  totalMidia: number;
  alocado: number;
  naoAlocado: number;
  /** Despesas sem NENHUMA linha de rateio — as que ninguém olhou ainda. */
  semNenhumRateio: number;
  /** % do valor de mídia com dono. Null quando não há mídia no mês. */
  percentualConcluido: number | null;
};

/**
 * O número que o fechamento e a rotina semanal perguntam: quanto da mídia
 * deste mês tem dono?
 *
 * Mede VALOR, não quantidade de linhas: cinco faturas pequenas resolvidas e
 * a fatura de R$ 40 mil intocada dariam "83% pronto" numa contagem por
 * quantidade — e é exatamente o mês em que a margem por cliente não vale nada.
 */
export async function resumoDoRateio(competence: Competence): Promise<ResumoDoRateio> {
  const despesas = await despesasParaRatear(competence);
  const totalMidia = Math.round(despesas.reduce((s, d) => s + d.total, 0) * 100) / 100;
  const alocado = Math.round(despesas.reduce((s, d) => s + d.alocado, 0) * 100) / 100;
  return {
    competence,
    despesas: despesas.length,
    totalMidia,
    alocado,
    naoAlocado: Math.round((totalMidia - alocado) * 100) / 100,
    semNenhumRateio: despesas.filter((d) => d.linhas.length === 0).length,
    percentualConcluido:
      totalMidia > 0 ? Math.round((alocado / totalMidia) * 1000) / 10 : null,
  };
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

type RegraCarregada = {
  id: string;
  name: string;
  descriptionContains: string | null;
  categoryId: string | null;
  expenseType: string | null;
  dimensionType: AllocationDimension;
  dimensionId: string;
};

function casa(
  regra: RegraCarregada,
  d: { description: string; categoryId: string | null; expenseType: string | null }
): boolean {
  // Regra sem NENHUMA condição casaria com tudo — e mandaria a mídia inteira
  // da agência para um cliente só, calada. Não casa nada, de propósito.
  const temCondicao =
    !!regra.descriptionContains || !!regra.categoryId || !!regra.expenseType;
  if (!temCondicao) return false;

  if (regra.descriptionContains) {
    const alvo = d.description.toLowerCase();
    if (!alvo.includes(regra.descriptionContains.toLowerCase())) return false;
  }
  if (regra.categoryId && regra.categoryId !== d.categoryId) return false;
  if (regra.expenseType && regra.expenseType !== d.expenseType) return false;
  return true;
}

export type ResultadoDasRegras = {
  aplicadas: number;
  valor: number;
  /** Despesas que nenhuma regra reconheceu — a "distribuição manual do resto". */
  semRegra: number;
};

/**
 * Aplica as regras às despesas de mídia da competência que AINDA NÃO TÊM
 * rateio nenhum.
 *
 * "Ainda não têm rateio nenhum" é a trava que importa: a regra nunca
 * sobrescreve decisão de gente. Quem distribuiu uma fatura à mão em três
 * clientes não vai encontrar isso desfeito porque alguém rodou as regras
 * de novo no dia seguinte.
 *
 * A regra manda 100% para uma dimensão (ver o modelo). Campanha que atende
 * dois clientes não é caso de regra: é caso de distribuição manual.
 */
export async function aplicarRegras(
  competence: Competence
): Promise<ResultadoDasRegras> {
  const { start, end } = faixa(competence);
  const regras = (await prisma.allocationRule.findMany({
    where: { active: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, name: true, descriptionContains: true, categoryId: true,
      expenseType: true, dimensionType: true, dimensionId: true,
    },
  })) as RegraCarregada[];

  const despesas = await prisma.transaction.findMany({
    where: {
      type: "despesa",
      expenseType: "ADS",
      status: { not: "cancelado" },
      date: { gte: start, lt: end },
    },
    select: {
      id: true, description: true, amount: true, categoryId: true, expenseType: true,
    },
  });
  if (despesas.length === 0 || regras.length === 0)
    return { aplicadas: 0, valor: 0, semRegra: despesas.length };

  const jaRateadas = new Set(
    (
      await prisma.allocation.findMany({
        where: { sourceType: SOURCE_TRANSACTION, sourceId: { in: despesas.map((d) => d.id) } },
        select: { sourceId: true },
      })
    ).map((a) => a.sourceId)
  );

  let aplicadas = 0;
  let valor = 0;
  let semRegra = 0;

  for (const d of despesas) {
    if (jaRateadas.has(d.id)) continue;
    const regra = regras.find((r) => casa(r, d));
    if (!regra) {
      semRegra++;
      continue;
    }
    const total = n(d.amount);
    const r = await salvarRateio({
      sourceId: d.id,
      motivo: `Regra "${regra.name}".`,
      linhas: [
        {
          dimensionType: regra.dimensionType,
          dimensionId: regra.dimensionId,
          amount: total,
          percentage: 100,
          method: "RULE",
          ruleId: regra.id,
        },
      ],
    });
    if (r.ok) {
      aplicadas++;
      valor += total;
    }
  }

  return { aplicadas, valor: Math.round(valor * 100) / 100, semRegra };
}
