import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { competenceOf, type Competence } from "@/lib/competence";
import { diasUteis } from "@/lib/commercial/atividade";
import {
  ESCOPOS, METRICAS_DE_META, ROTULO_DO_ESCOPO,
  type EscopoDaMeta, type MetaCadastrada, type MetricaDeMeta,
} from "@/lib/commercial/metas";

// Reexportados para quem já importava daqui. A TELA importa do módulo neutro
// — ver o cabeçalho de lib/commercial/metas.ts.
export { ESCOPOS, METRICAS_DE_META, ROTULO_DO_ESCOPO };
export type { EscopoDaMeta, MetaCadastrada, MetricaDeMeta };

/**
 * METAS COMERCIAIS (F4.5 · ref. 02 §5.4).
 *
 * Uma meta por (mês, escopo, métrica). O escopo é por NOME para pessoas e por
 * id para agência — decisão 19.11: usuário de login não é vinculado a pessoa
 * da equipe, então "Bianca" é o identificador que a casa usa.
 *
 * O QUE ESTE MÓDULO NÃO FAZ: inventar meta. Sem linha cadastrada, o painel
 * mostra o número SEM alvo. Uma meta chutada pelo sistema (média dos últimos
 * meses, por exemplo) seria pior que nenhuma: ela vira o alvo oficial sem
 * ninguém ter decidido, e depois cobra-se em cima dela.
 */

export async function metasDoMes(competence: Competence): Promise<MetaCadastrada[]> {
  const linhas = await prisma.commercialGoal.findMany({
    where: { competence },
    orderBy: [{ scopeType: "asc" }, { scopeId: "asc" }, { metric: "asc" }],
  });
  return linhas.map((l) => {
    const m = METRICAS_DE_META.find((x) => x.id === l.metric);
    return {
      id: l.id,
      competence: l.competence,
      scopeType: l.scopeType as EscopoDaMeta,
      scopeId: l.scopeId,
      metric: l.metric as MetricaDeMeta,
      rotuloDaMetrica: m?.rotulo ?? l.metric,
      target: n(l.target),
      unidade: (m?.unidade ?? "quantidade") as "quantidade" | "dinheiro",
    };
  });
}

export async function definirMeta(input: {
  competence: Competence;
  scopeType: EscopoDaMeta;
  scopeId: string;
  metric: MetricaDeMeta;
  target: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ESCOPOS.includes(input.scopeType)) return { ok: false, error: "Escopo inválido." };
  if (!METRICAS_DE_META.some((m) => m.id === input.metric))
    return { ok: false, error: "Métrica inválida." };
  if (!(input.target > 0))
    return { ok: false, error: "Meta zerada não é meta — para desligar, apague a linha." };
  if (input.scopeType !== "AGENCY" && !input.scopeId.trim())
    return { ok: false, error: "Informe de quem é a meta." };

  await prisma.commercialGoal.upsert({
    where: {
      competence_scopeType_scopeId_metric: {
        competence: input.competence,
        scopeType: input.scopeType,
        scopeId: input.scopeId.trim(),
        metric: input.metric,
      },
    },
    create: { ...input, scopeId: input.scopeId.trim() },
    update: { target: input.target },
  });
  return { ok: true };
}

export async function apagarMeta(id: string) {
  await prisma.commercialGoal.delete({ where: { id } });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Painel do closer (02 §5.4)
// ---------------------------------------------------------------------------

export type PainelDoCloser = {
  closer: string;
  competence: Competence;
  vendas: number;
  valorVendido: number;
  metaDeVendas: number | null;
  metaDeValor: number | null;
  /** Oportunidades abertas por etapa. */
  porEtapa: { etapa: string; titulo: string; quantidade: number; valor: number }[];
  /** Ganhas ÷ (ganhas + perdidas) no mês. */
  conversao: number | null;
  perdidasNoMes: number;
  /** O que precisa de ação hoje. */
  paradas: { id: string; titulo: string; dias: number; valor: number }[];
  /** Vendas ganhas que ainda não viraram cliente. */
  semHandoff: { id: string; titulo: string; valor: number }[];
  diasUteisNoMes: number;
  diasUteisDecorridos: number;
};

export async function painelDoCloser(
  closer: string,
  hoje: Date = new Date()
): Promise<PainelDoCloser> {
  const competence = competenceOf(hoje);
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);

  const [ganhas, perdidas, abertas, metas] = await Promise.all([
    prisma.opportunity.findMany({
      where: { closer, stage: "GANHA", wonAt: { gte: inicio, lt: fim } },
      select: { id: true, title: true, amount: true, createdClientId: true },
    }),
    prisma.opportunity.count({
      where: { closer, stage: "PERDIDA", lostAt: { gte: inicio, lt: fim } },
    }),
    prisma.opportunity.findMany({
      where: { closer, stage: { notIn: ["GANHA", "PERDIDA"] } },
      select: {
        id: true, title: true, amount: true, stage: true, createdAt: true,
        events: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
      },
    }),
    prisma.commercialGoal.findMany({
      where: { competence, scopeType: "CLOSER", scopeId: closer },
      select: { metric: true, target: true },
    }),
  ]);

  const { ETAPAS_DO_FUNIL, DIAS_PARA_PARADA } = await import("@/lib/commercial/funil");
  const alvo = new Map(metas.map((m) => [m.metric, n(m.target)]));
  const valorVendido = Math.round(ganhas.reduce((s, g) => s + n(g.amount), 0) * 100) / 100;
  const { total, decorridos } = diasUteis(hoje);

  const porEtapa = ETAPAS_DO_FUNIL.filter((e) => !e.terminal).map((e) => {
    const minhas = abertas.filter((o) => o.stage === e.id);
    return {
      etapa: e.id,
      titulo: e.titulo,
      quantidade: minhas.length,
      valor: Math.round(minhas.reduce((s, o) => s + n(o.amount), 0) * 100) / 100,
    };
  });

  const paradas = abertas
    .map((o) => {
      const desde = o.events[0]?.changedAt ?? o.createdAt;
      return {
        id: o.id,
        titulo: o.title,
        dias: Math.max(0, Math.floor((hoje.getTime() - desde.getTime()) / 86_400_000)),
        valor: n(o.amount),
      };
    })
    .filter((o) => o.dias >= DIAS_PARA_PARADA)
    .sort((a, b) => b.dias - a.dias);

  const decididas = ganhas.length + perdidas;

  return {
    closer,
    competence,
    vendas: ganhas.length,
    valorVendido,
    metaDeVendas: alvo.get("vendas") ?? null,
    metaDeValor: alvo.get("valor") ?? null,
    porEtapa,
    // Conversão sobre o que foi DECIDIDO no mês. Dividir pelo total do funil
    // misturaria vendas que ainda nem foram trabalhadas e faria a taxa cair
    // sempre que entrasse lead novo — que é o contrário do que ela mede.
    conversao: decididas > 0 ? Math.round((ganhas.length / decididas) * 1000) / 10 : null,
    perdidasNoMes: perdidas,
    paradas,
    semHandoff: ganhas
      .filter((g) => !g.createdClientId)
      .map((g) => ({ id: g.id, titulo: g.title, valor: n(g.amount) })),
    diasUteisNoMes: total,
    diasUteisDecorridos: decorridos,
  };
}

/**
 * Leads que pararam de andar — as "retomadas" do painel do SDR (02 §5.4).
 *
 * Lead trabalhado e depois esquecido é o desperdício mais comum de um funil:
 * o custo de aquisição já foi pago e o contato ainda está morno.
 */
export async function leadsParaRetomar(
  sdr: string,
  hoje: Date = new Date(),
  diasSemToque = 7
) {
  const limite = new Date(hoje.getTime() - diasSemToque * 86_400_000);
  const leads = await prisma.lead.findMany({
    where: { sdr, status: { in: ["CONTACTED", "QUALIFIED", "SCHEDULED"] } },
    select: {
      id: true, name: true, company: true, status: true, createdAt: true,
      interactions: { orderBy: { happenedAt: "desc" }, take: 1, select: { happenedAt: true } },
    },
  });
  return leads
    .map((l) => {
      const ultimo = l.interactions[0]?.happenedAt ?? l.createdAt;
      return {
        id: l.id,
        nome: l.company ? `${l.company} — ${l.name}` : l.name,
        status: l.status,
        ultimoToque: ultimo,
        diasSemToque: Math.floor((hoje.getTime() - ultimo.getTime()) / 86_400_000),
      };
    })
    .filter((l) => l.ultimoToque < limite)
    .sort((a, b) => b.diasSemToque - a.diasSemToque);
}
