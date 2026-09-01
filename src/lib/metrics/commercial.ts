import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { toNumber as n } from "@/lib/format";
import { currentWorkspaceId } from "@/lib/services/workspace";
import type { Competence } from "@/lib/competence";
import type { EtapaDoFunil } from "@/lib/commercial/funil";

/**
 * MÉTRICAS COMERCIAIS (F4.6 · ref. 01 §7.5).
 *
 * Todas devolvem `{ valor, motivoDoNulo }` em vez de número solto. É a regra
 * de 02 §5.5 aplicada ao lugar onde ela mais importa: um CPL de R$ 0,00
 * porque ninguém lançou o gasto em anúncios parece um resultado excelente. O
 * nulo com motivo é a única saída honesta.
 *
 * O CASO MAIS DELICADO É O ROAS, e 01 §7.5 já avisa: "a base que valoriza o
 * MRR — primeiro mês, valor contratual ou outra — é PARÂMETRO OBRIGATÓRIO".
 * Sem ela configurada, o ROAS não é calculado. Valorizar uma mensalidade de
 * R$ 2.000 pelo primeiro mês ou pelo contrato de doze meses dá dois números
 * que diferem por DOZE VEZES, e os dois se chamariam "ROAS" — a agência
 * inteira tomaria decisão de verba em cima de um número que ninguém sabe
 * qual é.
 */

export type ValorDeMetrica = {
  key: string;
  valor: number | null;
  /** Por que não deu para calcular. Vai direto para a tela. */
  motivoDoNulo: string | null;
};

export type BaseDeValoracao = "PRIMEIRO_MES" | "CONTRATO";

export const ROTULO_DA_BASE: Record<BaseDeValoracao, string> = {
  PRIMEIRO_MES: "Primeiro mês da mensalidade",
  CONTRATO: "Valor total do contrato (mensalidade × prazo)",
};

/**
 * Peso de cada etapa no pipeline ponderado.
 *
 * Números redondos e DECLARADOS de propósito: não vêm de estudo estatístico
 * nenhum, e fingir precisão em probabilidade de fechamento seria pior que
 * assumir a régua simples. Quando houver histórico suficiente, viram
 * parâmetro — e o registry já diz que hoje não são configuráveis.
 */
export const PESO_DA_ETAPA: Record<EtapaDoFunil, number> = {
  NOVA: 0.1,
  QUALIFICACAO: 0.2,
  REUNIAO: 0.4,
  PROPOSTA: 0.6,
  NEGOCIACAO: 0.8,
  GANHA: 1,
  PERDIDA: 0,
};

export async function baseDeValoracao(): Promise<BaseDeValoracao | null> {
  try {
    const id = await currentWorkspaceId();
    const w = await runWithoutScope(async () =>
      prisma.workspace.findUnique({ where: { id }, select: { commercialSettings: true } })
    );
    const cfg = (w?.commercialSettings ?? {}) as Record<string, unknown>;
    const base = cfg.baseDeValoracaoMrr;
    return base === "PRIMEIRO_MES" || base === "CONTRATO" ? base : null;
  } catch {
    return null;
  }
}

export async function definirBaseDeValoracao(base: BaseDeValoracao) {
  const id = await currentWorkspaceId();
  await runWithoutScope(async () =>
    prisma.workspace.update({
      where: { id },
      data: { commercialSettings: { baseDeValoracaoMrr: base } },
    })
  );
  return { ok: true as const };
}

export type MetricasComerciais = {
  competence: Competence;
  gastoEmAds: number;
  leads: number;
  leadsQualificados: number;
  agendamentos: number;
  reunioesRealizadas: number;
  noShows: number;
  ganhas: number;
  perdidas: number;
  novosClientes: number;
  custosComerciais: number;
  valorGanhoValorado: number;
  baseUsada: BaseDeValoracao | null;
  metricas: Record<string, ValorDeMetrica>;
};

const nulo = (key: string, motivo: string): ValorDeMetrica => ({
  key, valor: null, motivoDoNulo: motivo,
});

function divide(
  key: string,
  numerador: number,
  denominador: number,
  motivoSeZero: string,
  casas = 2
): ValorDeMetrica {
  if (denominador === 0) return nulo(key, motivoSeZero);
  const f = 10 ** casas;
  return { key, valor: Math.round((numerador / denominador) * f) / f, motivoDoNulo: null };
}

export async function metricasComerciais(
  competence: Competence
): Promise<MetricasComerciais> {
  const [ano, mes] = competence.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, 1);
  const fim = new Date(ano, mes, 1);

  const [
    gastos, leads, qualificados, atividades, ganhas, perdidas,
    novosClientes, despesasComerciais, base, metaDeValor, abertas,
  ] = await Promise.all([
    prisma.gastoAdsDiario.aggregate({
      where: { date: { gte: inicio, lt: fim } },
      _sum: { amount: true },
    }),
    prisma.lead.count({ where: { createdAt: { gte: inicio, lt: fim } } }),
    prisma.lead.count({
      where: {
        createdAt: { gte: inicio, lt: fim },
        status: { in: ["QUALIFIED", "SCHEDULED", "CONVERTED"] },
      },
    }),
    prisma.atividadeDiaria.aggregate({
      where: { date: { gte: inicio, lt: fim } },
      _sum: { agendamentos: true, reunioesRealizadas: true, noShows: true },
    }),
    prisma.opportunity.findMany({
      where: { stage: "GANHA", wonAt: { gte: inicio, lt: fim } },
      select: { amount: true, modality: true, months: true },
    }),
    prisma.opportunity.count({ where: { stage: "PERDIDA", lostAt: { gte: inicio, lt: fim } } }),
    prisma.clientAgencyRelationship.count({ where: { startedAt: { gte: inicio, lt: fim } } }),
    // "Custos comerciais definidos" (01 §7.5): mídia + o que estiver marcado
    // como despesa comercial. Sem uma marcação explícita, usamos a mídia —
    // e o CAC diz isso na tela em vez de fingir que cobriu tudo.
    prisma.transaction.aggregate({
      where: {
        type: "despesa", status: { not: "cancelado" },
        date: { gte: inicio, lt: fim }, expenseType: "ADS",
      },
      _sum: { amount: true },
    }),
    baseDeValoracao(),
    prisma.commercialGoal.aggregate({
      where: { competence, metric: "valor" },
      _sum: { target: true },
    }),
    prisma.opportunity.findMany({
      where: { stage: { notIn: ["GANHA", "PERDIDA"] } },
      select: { amount: true, stage: true },
    }),
  ]);

  const gastoEmAds = Math.round(n(gastos._sum.amount ?? 0) * 100) / 100;
  const agendamentos = atividades._sum.agendamentos ?? 0;
  const reunioes = atividades._sum.reunioesRealizadas ?? 0;
  const noShows = atividades._sum.noShows ?? 0;
  const custosComerciais = Math.round(n(despesasComerciais._sum.amount ?? 0) * 100) / 100;

  // Valoração das vendas ganhas. TCV é o próprio valor; MRR depende da BASE.
  const valorGanhoValorado = base
    ? Math.round(
        ganhas.reduce((s, g) => {
          const v = n(g.amount);
          if (g.modality !== "MRR") return s + v;
          return s + (base === "CONTRATO" ? v * (g.months ?? 12) : v);
        }, 0) * 100
      ) / 100
    : 0;

  const pipelinePonderado =
    Math.round(
      abertas.reduce((s, o) => s + n(o.amount) * (PESO_DA_ETAPA[o.stage] ?? 0), 0) * 100
    ) / 100;
  const meta = n(metaDeValor._sum.target ?? 0);

  const SEM_ADS = "Nenhum gasto de anúncio lançado no mês.";
  const SEM_LEAD = "Nenhum lead criado no mês.";
  const SEM_ATIVIDADE = "Nenhuma atividade de SDR registrada no mês.";

  const metricas: Record<string, ValorDeMetrica> = {
    cpl: leads === 0 ? nulo("cpl", SEM_LEAD) : divide("cpl", gastoEmAds, leads, SEM_LEAD),
    cpmql:
      qualificados === 0
        ? nulo("cpmql", "Nenhum lead passou da triagem no mês.")
        : divide("cpmql", gastoEmAds, qualificados, SEM_LEAD),
    custo_por_agendamento: divide(
      "custo_por_agendamento", gastoEmAds, agendamentos, SEM_ATIVIDADE
    ),
    custo_por_reuniao: divide("custo_por_reuniao", gastoEmAds, reunioes, SEM_ATIVIDADE),
    comparecimento:
      reunioes + noShows === 0
        ? nulo("comparecimento", "Nenhuma reunião marcada no mês.")
        : divide("comparecimento", reunioes * 100, reunioes + noShows, "", 1),
    conversao_reuniao: divide(
      "conversao_reuniao", ganhas.length * 100, reunioes, SEM_ATIVIDADE, 1
    ),
    cac: divide(
      "cac", custosComerciais, novosClientes, "Nenhum cliente novo no mês."
    ),
    roas: !base
      ? nulo(
          "roas",
          "Falta escolher como o MRR é valorizado (primeiro mês ou contrato). Sem isso o ROAS teria dois valores diferentes com o mesmo nome."
        )
      : gastoEmAds === 0
        ? nulo("roas", SEM_ADS)
        : divide("roas", valorGanhoValorado, gastoEmAds, SEM_ADS),
    tcv_comercial: {
      key: "tcv_comercial",
      valor:
        Math.round(
          ganhas.filter((g) => g.modality !== "MRR").reduce((s, g) => s + n(g.amount), 0) * 100
        ) / 100,
      motivoDoNulo: null,
    },
    novo_mrr: {
      key: "novo_mrr",
      valor:
        Math.round(
          ganhas.filter((g) => g.modality === "MRR").reduce((s, g) => s + n(g.amount), 0) * 100
        ) / 100,
      motivoDoNulo: null,
    },
    pipeline_coverage:
      meta === 0
        ? nulo(
            "pipeline_coverage",
            "Nenhuma meta de valor cadastrada para o mês — sem meta, não existe cobertura."
          )
        : divide("pipeline_coverage", pipelinePonderado, meta, ""),
  };

  return {
    competence,
    gastoEmAds,
    leads,
    leadsQualificados: qualificados,
    agendamentos,
    reunioesRealizadas: reunioes,
    noShows,
    ganhas: ganhas.length,
    perdidas,
    novosClientes,
    custosComerciais,
    valorGanhoValorado,
    baseUsada: base,
    metricas,
  };
}
