import { computePeriodMetrics, type PeriodMetricKey } from "@/lib/metrics/engine";
import { METRIC_REGISTRY } from "@/lib/metrics/registry";
import { lerFotografia, indicadoresDa } from "@/lib/snapshots/read";
import { periodoDe } from "@/lib/services/closing-period";
import { prisma } from "@/lib/prisma";

/**
 * COMPARATIVO DE PERÍODOS (F2.5 · ref. 02 §5.3, §7.8).
 *
 * "Duas colunas com deltas na coluna central."
 *
 * A REGRA QUE FAZ ESTA TELA VALER ALGUMA COISA: mês FECHADO é lido da
 * FOTOGRAFIA, não recalculado. Recalcular um mês fechado com o código de hoje
 * responde "quanto agosto valeria pelas regras de agora", que é uma pergunta
 * diferente de "quanto agosto valeu" — e é a errada para comparar. Se a
 * fórmula de uma métrica mudou de versão no meio, comparar recalculado com
 * recalculado esconde exatamente a mudança que interessa.
 *
 * Por isso cada lado do comparativo declara DE ONDE veio o número, e o
 * comparativo avisa quando os dois lados foram medidos com réguas diferentes.
 */

export type LadoComparativo = {
  competence: string;
  fonte: "fotografia" | "cálculo";
  /** Versão do dicionário de métricas usada naquele lado. */
  versaoMetricas: number;
  valores: Record<string, number | null>;
};

export type LinhaComparativo = {
  chave: string;
  rotulo: string;
  /** BRL | PCT | QTD — decide a formatação na tela. */
  formato: "BRL" | "PCT" | "QTD";
  a: number | null;
  b: number | null;
  delta: number | null;
  /** Variação relativa; null quando o lado A é zero ou nulo. */
  variacao: number | null;
  /** Subir é bom para esta linha? (despesa que sobe não é boa notícia) */
  subirEhBom: boolean;
};

export type Comparativo = {
  a: LadoComparativo;
  b: LadoComparativo;
  linhas: LinhaComparativo[];
  /** Os dois lados foram medidos com a mesma régua? */
  mesmaRegua: boolean;
  estabilidade: { a: Record<string, number>; b: Record<string, number> };
};

/** Linhas do comparativo — as de 02 §5.3 que já têm fonte. */
const LINHAS: { chave: PeriodMetricKey; formato: "BRL" | "PCT" | "QTD"; subirEhBom: boolean }[] = [
  { chave: "faturamento_total", formato: "BRL", subirEhBom: true },
  { chave: "mrr_oficial", formato: "BRL", subirEhBom: true },
  { chave: "recebido_competencia", formato: "BRL", subirEhBom: true },
  { chave: "em_aberto", formato: "BRL", subirEhBom: false },
  { chave: "vencido", formato: "BRL", subirEhBom: false },
  { chave: "resultado_mes", formato: "BRL", subirEhBom: true },
  { chave: "margem_gerencial", formato: "PCT", subirEhBom: true },
  { chave: "percentual_realizacao", formato: "PCT", subirEhBom: true },
  { chave: "percentual_folha", formato: "PCT", subirEhBom: false },
  { chave: "clientes_ativos", formato: "QTD", subirEhBom: true },
  { chave: "novos_clientes", formato: "QTD", subirEhBom: true },
  { chave: "churn_quantidade", formato: "QTD", subirEhBom: false },
  { chave: "churn_valor", formato: "BRL", subirEhBom: false },
  { chave: "ticket_medio", formato: "BRL", subirEhBom: true },
];

async function lerLado(competence: string): Promise<LadoComparativo> {
  const periodo = await periodoDe(competence);
  if (periodo.estado === "CLOSED") {
    const foto = await lerFotografia(competence);
    if (foto) {
      return {
        competence,
        fonte: "fotografia",
        versaoMetricas: foto.metricVersion,
        valores: indicadoresDa(foto),
      };
    }
  }
  const [ano, mes] = competence.split("-").map(Number);
  const metricas = await computePeriodMetrics({
    start: new Date(ano, mes - 1, 1),
    end: new Date(ano, mes, 1),
  } as any);
  const { METRIC_REGISTRY_VERSION } = await import("@/lib/metrics/registry");
  const valores: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(metricas)) {
    valores[k] = (v as any)?.value ?? null;
  }
  return { competence, fonte: "cálculo", versaoMetricas: METRIC_REGISTRY_VERSION, valores };
}

/** Leitura da carteira no mês: quantos em cada nível de estabilidade. */
async function estabilidadeDe(competence: string): Promise<Record<string, number>> {
  const linhas = await prisma.avaliacaoMensal.groupBy({
    by: ["estabilidade"],
    where: { competence, confirmedAt: { not: null } },
    _count: { _all: true },
  });
  const saida: Record<string, number> = {};
  for (const l of linhas) saida[l.estabilidade ?? "sem leitura"] = l._count._all;
  return saida;
}

export async function compararPeriodos(
  competenceA: string,
  competenceB: string
): Promise<Comparativo> {
  const [a, b, estA, estB] = await Promise.all([
    lerLado(competenceA),
    lerLado(competenceB),
    estabilidadeDe(competenceA),
    estabilidadeDe(competenceB),
  ]);

  const linhas: LinhaComparativo[] = LINHAS.map((l) => {
    const def = METRIC_REGISTRY.find((m) => m.key === l.chave);
    const va = a.valores[l.chave] ?? null;
    const vb = b.valores[l.chave] ?? null;
    const delta = va != null && vb != null ? vb - va : null;
    return {
      chave: l.chave,
      rotulo: def?.name ?? l.chave,
      formato: l.formato,
      a: va,
      b: vb,
      delta,
      variacao: delta != null && va != null && va !== 0 ? delta / Math.abs(va) : null,
      subirEhBom: l.subirEhBom,
    };
  });

  return {
    a, b, linhas,
    mesmaRegua: a.versaoMetricas === b.versaoMetricas,
    estabilidade: { a: estA, b: estB },
  };
}
