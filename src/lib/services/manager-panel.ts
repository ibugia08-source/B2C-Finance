import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MONTHS_PT_SHORT, toNumber as n } from "@/lib/format";
import { toCompetence, type Competence } from "@/lib/competence";
import { isScoped, type DataScope } from "@/lib/scope";
import { nomeDoEscopo, whereDaRelacao } from "@/lib/services/data-scope";

/**
 * PAINEL DO GESTOR (F1.19 · ref. 02 §5.4).
 *
 * "Gestor: ativos, críticos/observação, saldo vencido dos seus,
 * renovações, evolução 6m, ações (avaliações pendentes, onboarding
 * vencido, renovações sem negociação)."
 *
 * ESCOPO — RESOLVIDO pela DECISÃO 19.11 em 31/08.
 *
 * A versão anterior deste arquivo casava o USUÁRIO logado com o COLABORADOR
 * da folha PELO NOME, porque não havia campo ligando os dois, e caía para a
 * carteira inteira quando não achava. Isso morreu aqui: a direção decidiu que
 * o vínculo usuário↔pessoa da folha NÃO existe — Raiane e Bianca estão nos
 * dois lugares e os registros são independentes de propósito.
 *
 * Casar por nome nunca foi um recorte de segurança, era um palpite: dois
 * "Ana Paula" na folha, ou um usuário cadastrado como "ana@" com nome
 * diferente do crachá, e o painel mostrava a carteira errada sem avisar.
 *
 * O recorte agora é o do usuário (lib/scope): a carteira inteira, ou UMA
 * agência. Vem de campo gravado e conferido, não de coincidência de texto.
 */

export type AcaoPendente = {
  clientId: string;
  clientName: string;
  motivo: string;
  href: string;
};

export type PainelGestor = {
  /** Nome da agência do recorte, ou null quando o painel mostra tudo. */
  escopoNome: string | null;
  escopoTotal: boolean;
  ativos: number;
  criticos: number;
  emObservacao: number;
  vencidoValor: number;
  vencidoClientes: number;
  renovacoesDoMes: number;
  avaliacoesPendentes: AcaoPendente[];
  onboardingVencido: AcaoPendente[];
  renovacoesSemNegociacao: AcaoPendente[];
  evolucao: { label: string; ativos: number }[];
};

const MESES = MONTHS_PT_SHORT;

export async function carregarPainelGestor(
  scope: DataScope,
  hoje = new Date()
): Promise<PainelGestor> {
  const competence = toCompetence(hoje.getFullYear(), hoje.getMonth() + 1) as Competence;

  const filtroEscopo: Prisma.ClientAgencyRelationshipWhereInput = whereDaRelacao(scope);
  const escopoNome = await nomeDoEscopo(scope);

  const relacoes = await prisma.clientAgencyRelationship.findMany({
    where: { lifecycleStatus: { in: ["ACTIVE", "ONBOARDING"] }, ...filtroEscopo },
    select: {
      id: true,
      clientId: true,
      startedAt: true,
      churnedAt: true,
      onboardingStatus: true,
      client: { select: { name: true, renewalMonth: true } },
      avaliacoes: {
        where: { competence },
        select: { estabilidade: true, risco: true, confirmedAt: true },
      },
      onboarding: {
        where: { doneAt: null, dueAt: { lt: hoje } },
        select: { id: true },
      },
    },
  });

  const ids = relacoes.map((r) => r.id);

  // 2. Vencido dos clientes deste escopo.
  const vencidas = ids.length
    ? await prisma.billing.groupBy({
        by: ["relationshipId"],
        where: {
          relationshipId: { in: ids },
          status: { notIn: ["PAID", "CANCELED"] },
          dueDate: { lt: hoje },
        },
        _sum: { amount: true, paidTotal: true },
      })
    : [];
  const vencidoValor = vencidas.reduce(
    (s, v) => s + Math.max(0, n(v._sum.amount) - n(v._sum.paidTotal)),
    0
  );

  // 3. Leitura da carteira a partir da avaliação do mês.
  let criticos = 0;
  let emObservacao = 0;
  const avaliacoesPendentes: AcaoPendente[] = [];
  const onboardingVencido: AcaoPendente[] = [];
  const renovacoesSemNegociacao: AcaoPendente[] = [];
  const mesAtual = hoje.getMonth() + 1;

  for (const r of relacoes) {
    const av = r.avaliacoes[0];
    if (av?.estabilidade === "Crítico" || av?.risco === "Alto") criticos++;
    else if (av?.estabilidade === "Observação" || av?.risco === "Médio") emObservacao++;

    if (!av?.confirmedAt) {
      avaliacoesPendentes.push({
        clientId: r.clientId,
        clientName: r.client.name,
        motivo: "sem avaliação neste mês",
        href: "/avaliacoes",
      });
    }
    if (r.onboarding.length > 0) {
      onboardingVencido.push({
        clientId: r.clientId,
        clientName: r.client.name,
        motivo: `${r.onboarding.length} tarefa(s) fora do prazo`,
        href: `/clientes/${r.clientId}?tab=onboarding`,
      });
    }
    // Renovação do mês sem sinal de negociação na avaliação.
    if (r.client.renewalMonth === mesAtual && !av?.confirmedAt) {
      renovacoesSemNegociacao.push({
        clientId: r.clientId,
        clientName: r.client.name,
        motivo: "renova este mês e ainda não foi avaliado",
        href: "/renovacoes",
      });
    }
  }

  // 4. Evolução: quantos clientes estavam ativos em cada um dos 6 meses.
  const evolucao = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - i), 1);
    const fim = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const ativos = relacoes.filter(
      (r) =>
        (!r.startedAt || r.startedAt < fim) && (!r.churnedAt || r.churnedAt >= d)
    ).length;
    return { label: MESES[d.getMonth()], ativos };
  });

  return {
    escopoNome,
    escopoTotal: !isScoped(scope),
    ativos: relacoes.length,
    criticos,
    emObservacao,
    vencidoValor,
    vencidoClientes: vencidas.length,
    renovacoesDoMes: relacoes.filter((r) => r.client.renewalMonth === mesAtual).length,
    avaliacoesPendentes: avaliacoesPendentes.slice(0, 12),
    onboardingVencido: onboardingVencido.slice(0, 12),
    renovacoesSemNegociacao: renovacoesSemNegociacao.slice(0, 12),
    evolucao,
  };
}
