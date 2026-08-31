import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { toCompetence, type Competence } from "@/lib/competence";

/**
 * PAINEL DO GESTOR (F1.19 · ref. 02 §5.4).
 *
 * "Gestor: ativos, críticos/observação, saldo vencido dos seus,
 * renovações, evolução 6m, ações (avaliações pendentes, onboarding
 * vencido, renovações sem negociação)."
 *
 * ESCOPO — e a honestidade sobre ele: "dos seus" depende de saber quais
 * clientes são do gestor, o que hoje vem de ClientManagerAssignment
 * (F1.3). O vínculo entre o USUÁRIO que fez login e o COLABORADOR da
 * folha é feito por NOME, porque não existe campo ligando os dois. Quando
 * não há correspondência, o painel mostra a carteira INTEIRA e DIZ isso
 * no cabeçalho — mostrar tudo fingindo que é "o seu" seria pior que
 * mostrar tudo assumidamente.
 *
 * O recorte definitivo é a DECISÃO 19.11 (o gestor vê a carteira inteira
 * em leitura, ou só a dele?), e ela também decide se o fallback acima
 * deve virar uma tela vazia.
 */

export type AcaoPendente = {
  clientId: string;
  clientName: string;
  motivo: string;
  href: string;
};

export type PainelGestor = {
  /** Nome do colaborador casado, ou null se o painel está mostrando tudo. */
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

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export async function carregarPainelGestor(
  nomeUsuario: string | null,
  hoje = new Date()
): Promise<PainelGestor> {
  const competence = toCompetence(hoje.getFullYear(), hoje.getMonth() + 1) as Competence;

  // 1. Quem é este gestor na folha? Casamento por nome, sem inventar.
  const colaborador = nomeUsuario
    ? await prisma.employee.findFirst({
        where: { name: { equals: nomeUsuario.trim(), mode: "insensitive" } },
        select: { id: true, name: true },
      })
    : null;

  // `as const` no array de papéis deixa o tipo readonly, que o Prisma
  // recusa no filtro — o array mutável é o que ele espera.
  const filtroEscopo: Prisma.ClientAgencyRelationshipWhereInput = colaborador
    ? {
        managers: {
          some: {
            managerId: colaborador.id,
            validTo: null,
            role: { in: ["MANAGER_1", "MANAGER_2"] },
          },
        },
      }
    : {};

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
    escopoNome: colaborador?.name ?? null,
    escopoTotal: !colaborador,
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
