import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import {
  COLUNAS_DO_QUADRO, DIAS_PARA_PARADA, ETAPAS_DO_FUNIL, ORDEM_DA_ETAPA,
  type EtapaDoFunil,
} from "@/lib/commercial/funil";
import { escopoAtual } from "@/lib/services/data-scope";
import type { DataScope } from "@/lib/scope";

/**
 * O FUNIL (F4.2 · ref. 01 §4.6; 02 §4).
 *
 * A decisão que carrega o módulo: **a etapa atual é um CACHE; a verdade é a
 * lista de eventos**. `Opportunity.stage` existe para o quadro carregar
 * rápido, mas quem responde "onde esta venda estava em março?" e "quanto
 * tempo ela ficou na proposta?" é o PipelineEvent.
 *
 * Sem essa separação, o funil histórico não existe: mudar a etapa
 * sobrescreveria a anterior e o mês passado seria irrecuperável — que é
 * exatamente o que 01 §4.6 manda evitar ao pedir a tabela de eventos.
 *
 * Por isso mover etapa e gravar evento acontecem na MESMA transação, sempre.
 */

export type CardDoFunil = {
  id: string;
  titulo: string;
  cliente: string | null;
  leadId: string | null;
  closer: string | null;
  agencia: string | null;
  amount: number;
  modalidade: string;
  meses: number | null;
  stage: EtapaDoFunil;
  desdeQuando: Date;
  diasNaEtapa: number;
  parada: boolean;
  expectedCloseAt: Date | null;
};

export type ColunaDoFunil = {
  id: EtapaDoFunil;
  titulo: string;
  saidaDaEtapa: string;
  cards: CardDoFunil[];
  total: number;
};

export type Funil = {
  colunas: ColunaDoFunil[];
  /** Quantas oportunidades estão paradas há 7 dias ou mais. */
  paradas: number;
  totalEmAberto: number;
  ganhasNoMes: number;
  valorGanhoNoMes: number;
};

function whereDoEscopo(scope: DataScope) {
  return scope.kind === "AGENCY" ? { agencyId: scope.agencyId } : {};
}

export async function carregarFunil(hoje: Date = new Date()): Promise<Funil> {
  const scope = await escopoAtual();
  const inicioDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  const [abertas, ganhas] = await Promise.all([
    prisma.opportunity.findMany({
      where: { ...whereDoEscopo(scope), stage: { notIn: ["GANHA", "PERDIDA"] } },
      orderBy: [{ amount: "desc" }],
      select: {
        id: true, title: true, closer: true, amount: true, modality: true,
        months: true, stage: true, updatedAt: true, createdAt: true,
        expectedCloseAt: true, leadId: true,
        client: { select: { name: true } },
        agency: { select: { name: true } },
        events: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
      },
    }),
    prisma.opportunity.findMany({
      where: { ...whereDoEscopo(scope), stage: "GANHA", wonAt: { gte: inicioDoMes } },
      select: { amount: true },
    }),
  ]);

  const cards: CardDoFunil[] = abertas.map((o) => {
    // "Desde quando" é a data do ÚLTIMO EVENTO, não o updatedAt: editar o
    // valor da proposta não devolve a oportunidade para o começo da fila.
    const desde = o.events[0]?.changedAt ?? o.createdAt;
    const dias = Math.max(0, Math.floor((hoje.getTime() - desde.getTime()) / 86_400_000));
    return {
      id: o.id,
      titulo: o.title,
      cliente: o.client?.name ?? null,
      leadId: o.leadId,
      closer: o.closer,
      agencia: o.agency?.name ?? null,
      amount: n(o.amount),
      modalidade: o.modality,
      meses: o.months,
      stage: o.stage,
      desdeQuando: desde,
      diasNaEtapa: dias,
      parada: dias >= DIAS_PARA_PARADA,
      expectedCloseAt: o.expectedCloseAt,
    };
  });

  const colunas: ColunaDoFunil[] = COLUNAS_DO_QUADRO.map((c) => {
    const meus = cards.filter((x) => x.stage === c.id);
    return {
      id: c.id,
      titulo: c.titulo,
      saidaDaEtapa: c.saidaDaEtapa,
      cards: meus,
      total: Math.round(meus.reduce((s, x) => s + x.amount, 0) * 100) / 100,
    };
  });

  return {
    colunas,
    paradas: cards.filter((c) => c.parada).length,
    totalEmAberto: Math.round(cards.reduce((s, c) => s + c.amount, 0) * 100) / 100,
    ganhasNoMes: ganhas.length,
    valorGanhoNoMes: Math.round(ganhas.reduce((s, g) => s + n(g.amount), 0) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Mover de etapa
// ---------------------------------------------------------------------------

export type ResultadoDoMovimento =
  | { ok: true; stage: EtapaDoFunil; avancou: boolean }
  | { ok: false; error: string };

export async function moverEtapa(
  opportunityId: string,
  para: EtapaDoFunil,
  opts: { motivo?: string | null; quando?: Date } = {}
): Promise<ResultadoDoMovimento> {
  const o = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { id: true, stage: true },
  });
  if (!o) return { ok: false, error: "Oportunidade não encontrada." };
  if (o.stage === para) return { ok: true, stage: para, avancou: false };

  const motivo = (opts.motivo ?? "").trim();
  if (para === "PERDIDA" && motivo.length < 3)
    return { ok: false, error: "Escreva o motivo da perda — é a informação que mais volta depois." };

  const agora = opts.quando ?? new Date();
  const { contextFromRequest } = await import("@/lib/engines/context");
  const ctx = await contextFromRequest({ reason: motivo || null });

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.update({
      where: { id: o.id },
      data: {
        stage: para,
        // As datas terminais são exclusivas e o banco confere (CHECK): mover
        // de PERDIDA para GANHA tem de limpar a data antiga, senão a linha
        // fica com as duas e a constraint recusa.
        wonAt: para === "GANHA" ? agora : null,
        lostAt: para === "PERDIDA" ? agora : null,
        lostReason: para === "PERDIDA" ? motivo : null,
      },
    });
    await tx.pipelineEvent.create({
      data: {
        opportunityId: o.id,
        fromStage: o.stage,
        toStage: para,
        changedAt: agora,
        changedBy: ctx.actorEmail,
        reason: motivo || null,
      },
    });
  });

  return {
    ok: true,
    stage: para,
    avancou: ORDEM_DA_ETAPA[para] > ORDEM_DA_ETAPA[o.stage],
  };
}

// ---------------------------------------------------------------------------
// Tempo por etapa e reconstrução histórica
// ---------------------------------------------------------------------------

export type TempoNaEtapa = {
  etapa: EtapaDoFunil;
  titulo: string;
  /** Média de dias que a oportunidade passou nesta etapa. */
  mediaDeDias: number | null;
  /** Quantas passagens entraram na média. */
  amostras: number;
};

/**
 * Quanto tempo o funil leva em cada etapa, reconstruído dos eventos.
 *
 * Conta só as passagens FECHADAS — as que têm entrada e saída. Incluir a
 * etapa em que a oportunidade ainda está puxaria a média para baixo todo dia
 * (uma venda parada há 40 dias entraria como 0 no dia em que chegou), e a
 * métrica ficaria dizendo que o funil melhora quando ele trava.
 */
export async function tempoPorEtapa(desde?: Date): Promise<TempoNaEtapa[]> {
  const eventos = await prisma.pipelineEvent.findMany({
    where: desde ? { changedAt: { gte: desde } } : {},
    orderBy: [{ opportunityId: "asc" }, { changedAt: "asc" }],
    select: { opportunityId: true, fromStage: true, toStage: true, changedAt: true },
  });

  const soma = new Map<EtapaDoFunil, { dias: number; n: number }>();
  const entrouEm = new Map<string, { etapa: EtapaDoFunil; quando: Date }>();

  for (const e of eventos) {
    const anterior = entrouEm.get(e.opportunityId);
    if (anterior && anterior.etapa === e.fromStage) {
      const dias = (e.changedAt.getTime() - anterior.quando.getTime()) / 86_400_000;
      const atual = soma.get(anterior.etapa) ?? { dias: 0, n: 0 };
      atual.dias += Math.max(0, dias);
      atual.n += 1;
      soma.set(anterior.etapa, atual);
    }
    entrouEm.set(e.opportunityId, { etapa: e.toStage, quando: e.changedAt });
  }

  return ETAPAS_DO_FUNIL.filter((e) => !e.terminal).map((e) => {
    const s = soma.get(e.id);
    return {
      etapa: e.id,
      titulo: e.titulo,
      mediaDeDias: s && s.n > 0 ? Math.round((s.dias / s.n) * 10) / 10 : null,
      amostras: s?.n ?? 0,
    };
  });
}

/**
 * O funil COMO ELE ERA numa data passada (01 §4.6: "reconstrói pipeline
 * histórico").
 *
 * Reconstruído inteiramente dos eventos: para cada oportunidade, a última
 * mudança ANTES da data. Oportunidade criada depois da data simplesmente não
 * existe naquele retrato — é isso que faz o comparativo de dois meses ser
 * honesto em vez de mostrar o funil de hoje com outro rótulo.
 */
export async function funilEm(data: Date): Promise<Record<EtapaDoFunil, number>> {
  const oportunidades = await prisma.opportunity.findMany({
    where: { createdAt: { lte: data } },
    select: {
      id: true, stage: true, createdAt: true,
      events: {
        where: { changedAt: { lte: data } },
        orderBy: { changedAt: "desc" },
        take: 1,
        select: { toStage: true },
      },
    },
  });

  const contagem = Object.fromEntries(
    ETAPAS_DO_FUNIL.map((e) => [e.id, 0])
  ) as Record<EtapaDoFunil, number>;

  for (const o of oportunidades) {
    // Sem evento até a data, a oportunidade estava na etapa em que nasceu —
    // e o evento de criação é gravado junto, então isto é o caso do legado.
    const etapa = (o.events[0]?.toStage ?? "NOVA") as EtapaDoFunil;
    contagem[etapa] += 1;
  }
  return contagem;
}

// ---------------------------------------------------------------------------
// Criar oportunidade
// ---------------------------------------------------------------------------

export type EntradaDeOportunidade = {
  title: string;
  leadId?: string | null;
  clientId?: string | null;
  agencyId?: string | null;
  closer?: string | null;
  offerId?: string | null;
  amount: number;
  modality?: "MRR" | "TCV";
  months?: number | null;
  expectedCloseAt?: Date | null;
};

/**
 * Nasce SEMPRE com o evento de criação. Uma oportunidade sem o primeiro
 * evento é um buraco na reconstrução histórica: ela apareceria do nada na
 * etapa em que estivesse hoje.
 */
export async function criarOportunidade(input: EntradaDeOportunidade) {
  const titulo = input.title.trim();
  if (titulo.length < 2) return { ok: false as const, error: "Dê um nome à oportunidade." };
  if (!(input.amount >= 0)) return { ok: false as const, error: "Informe o valor negociado." };

  const { contextFromRequest } = await import("@/lib/engines/context");
  const ctx = await contextFromRequest();

  const o = await prisma.$transaction(async (tx) => {
    const criada = await tx.opportunity.create({
      data: {
        title: titulo,
        leadId: input.leadId ?? null,
        clientId: input.clientId ?? null,
        agencyId: input.agencyId ?? null,
        closer: input.closer ?? null,
        offerId: input.offerId ?? null,
        amount: input.amount,
        modality: (input.modality ?? "MRR") as any,
        months: input.months ?? null,
        expectedCloseAt: input.expectedCloseAt ?? null,
        stage: "NOVA",
      },
      select: { id: true },
    });
    await tx.pipelineEvent.create({
      data: {
        opportunityId: criada.id,
        fromStage: null,
        toStage: "NOVA",
        changedBy: ctx.actorEmail,
        reason: "Oportunidade criada.",
      },
    });
    return criada;
  });

  return { ok: true as const, id: o.id };
}
