import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { type Competence } from "@/lib/competence";
import { distribuirPorPeso } from "@/lib/allocations/split";
import {
  margemDeContribuicaoDe, type MargemDeContribuicao,
} from "@/lib/services/contribution-margin";

/**
 * MARGEM TOTALMENTE ALOCADA (F5.5 · ref. 01 §7.6 "Margem totalmente alocada
 * (futura, via Allocation)").
 *
 * A margem de contribuição (F3.4) para de propósito antes do overhead — e o
 * aviso dela diz isso em toda tela. Esta é a segunda metade: folha, impostos
 * e as despesas gerais que não têm dono DISTRIBUÍDOS sobre os clientes, para
 * responder "com o custo TODO dentro, quem dá lucro?".
 *
 * TRÊS decisões definem o número, e as três estão escritas:
 *
 *  1. O POOL de overhead é composto e MOSTRADO por parte: despesas gerais
 *     (sem cliente e sem rateio manual), folha da competência e impostos
 *     provisionados. Um número composto que não mostra a composição é um
 *     número em que ninguém confia.
 *  2. A BASE de distribuição é a RECEITA reconhecida de cada cliente — a
 *     base padrão de custeio quando não há medição melhor, DECLARADA na
 *     tela. Cliente sem receita no período não absorve overhead (não há
 *     peso para dar a ele).
 *  3. NADA É GRAVADO. O rateio manual (F3.4) grava Allocation porque é
 *     DECISÃO sobre uma despesa concreta; o overhead é LEITURA derivada que
 *     muda toda vez que o mês anda. A distribuição usa a MESMA aritmética
 *     do motor de rateio (distribuirPorPeso: fecha no centavo, resto na
 *     maior fatia) — "via Allocation" na regra, sem inventar fato auditável.
 */

export type MargemFinalDoCliente = {
  clientId: string;
  cliente: string;
  receita: number;
  custosDiretos: number;
  custosRateados: number;
  margemDeContribuicao: number;
  overheadAlocado: number;
  margemFinal: number;
  margemFinalPercentual: number | null;
};

export type PoolDeOverhead = {
  despesasGerais: number;
  folha: number;
  impostos: number;
  total: number;
};

export type MargemTotalmenteAlocada = {
  competence: string;
  linhas: MargemFinalDoCliente[];
  pool: PoolDeOverhead;
  baseDeDistribuicao: "Receita reconhecida do período";
  /** Overhead que ficou sem destino (só quando não há receita nenhuma). */
  naoDistribuido: number;
  contribuicao: MargemDeContribuicao;
};

export async function margemTotalmenteAlocada(
  competences: Competence[]
): Promise<MargemTotalmenteAlocada> {
  const contribuicao = await margemDeContribuicaoDe(competences);
  const ordenadas = [...competences].sort();
  const [y0, m0] = ordenadas[0].split("-").map(Number);
  const [y1, m1] = ordenadas[ordenadas.length - 1].split("-").map(Number);
  const start = new Date(y0, m0 - 1, 1);
  const end = new Date(y1, m1, 1);

  const [despesasSemDono, alocacoes, folhas, impostos] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { not: "cancelado" },
        date: { gte: start, lt: end },
        clientId: null,
      },
      select: { id: true, amount: true },
    }),
    prisma.allocation.findMany({
      where: { competence: { in: ordenadas }, dimensionType: "CLIENT" },
      select: { sourceId: true, amount: true },
    }),
    prisma.payroll.findMany({
      where: { competence: { in: ordenadas } },
      select: { items: { select: { amount: true } } },
    }),
    prisma.taxProvision.findMany({
      where: { competence: { in: ordenadas } },
      select: { amount: true },
    }),
  ]);

  // Despesa geral = sem cliente E sem rateio manual. A parte já rateada a
  // clientes NÃO volta para o pool — estaria sendo cobrada duas vezes.
  const rateadoPorOrigem = new Map<string, number>();
  for (const a of alocacoes) {
    rateadoPorOrigem.set(a.sourceId, (rateadoPorOrigem.get(a.sourceId) ?? 0) + n(a.amount));
  }
  let despesasGerais = 0;
  for (const d of despesasSemDono) {
    const sobra = n(d.amount) - (rateadoPorOrigem.get(d.id) ?? 0);
    if (sobra > 0) despesasGerais += sobra;
  }

  const folha = folhas.reduce(
    (s, f) => s + f.items.reduce((si, i) => si + n(i.amount), 0),
    0
  );
  const impostosTotal = impostos.reduce((s, i) => s + n(i.amount), 0);

  const arred = (v: number) => Math.round(v * 100) / 100;
  const pool: PoolDeOverhead = {
    despesasGerais: arred(despesasGerais),
    folha: arred(folha),
    impostos: arred(impostosTotal),
    total: arred(despesasGerais + folha + impostosTotal),
  };

  // Distribuição pela MESMA aritmética do motor de rateio: fecha no centavo.
  const comReceita = contribuicao.linhas.filter((l) => l.receita > 0);
  const fatias =
    pool.total > 0 && comReceita.length > 0
      ? distribuirPorPeso(
          pool.total,
          comReceita.map((l) => ({ id: l.clientId, peso: l.receita }))
        )
      : [];
  const overheadDe = new Map(fatias.map((f) => [f.id, f.amount]));

  const linhas: MargemFinalDoCliente[] = contribuicao.linhas
    .map((l) => {
      const overhead = overheadDe.get(l.clientId) ?? 0;
      const final = arred(l.margem - overhead);
      return {
        clientId: l.clientId,
        cliente: l.cliente,
        receita: l.receita,
        custosDiretos: l.custosDiretos,
        custosRateados: l.custosRateados,
        margemDeContribuicao: l.margem,
        overheadAlocado: overhead,
        margemFinal: final,
        margemFinalPercentual: l.receita > 0 ? Math.round((final / l.receita) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => a.margemFinal - b.margemFinal);

  return {
    competence: contribuicao.competence,
    linhas,
    pool,
    baseDeDistribuicao: "Receita reconhecida do período",
    naoDistribuido: fatias.length === 0 ? pool.total : 0,
    contribuicao,
  };
}
