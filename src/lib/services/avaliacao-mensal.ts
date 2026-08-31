import { prisma } from "@/lib/prisma";
import { addMonths, type Competence } from "@/lib/competence";
import { toNumber as n } from "@/lib/format";
import type { LinhaAvaliacao, SalvarAvaliacao } from "@/lib/avaliacao-meta";

// Reexportados para quem já importa do serviço; a definição mora no
// módulo neutro, que o componente de cliente pode importar sem arrastar
// o Prisma junto.
export type { LinhaAvaliacao, SalvarAvaliacao };
export { ADS_STATUS, ESTABILIDADE, RISCO, UPSELL } from "@/lib/avaliacao-meta";

/**
 * AVALIAÇÃO MENSAL EM GRADE (F1.17 · ref. 01 §4.13, 02 §4.1).
 *
 * "Pré-preenchida com o mês anterior; confirmar tudo em 1 clique +
 * ajustar exceções. Custo alvo: 10 min/gestor/mês."
 *
 * O custo alvo é a especificação de verdade. Uma grade que obriga a
 * escolher quatro campos em sessenta clientes leva uma hora e não é
 * preenchida — vira dado morto. Por isso a linha JÁ CHEGA respondida com
 * o mês anterior, e o trabalho do gestor é só corrigir o que mudou.
 *
 * O RISCO é SUGERIDO pelo sistema (2+ cobranças vencidas, 01 §4.13), mas
 * não imposto: quem conhece o cliente pode discordar. A sugestão aparece
 * marcada como sugestão, e a escolha do gestor prevalece.
 */

export async function carregarGrade(competence: Competence): Promise<LinhaAvaliacao[]> {
  const anterior = addMonths(competence, -1);
  const hoje = new Date();

  const relacoes = await prisma.clientAgencyRelationship.findMany({
    where: { lifecycleStatus: { in: ["ACTIVE", "ONBOARDING"] } },
    select: {
      id: true,
      clientId: true,
      client: { select: { name: true } },
      managers: {
        where: { validTo: null },
        select: { manager: { select: { name: true } } },
      },
      avaliacoes: {
        where: { competence: { in: [competence, anterior] } },
        select: {
          competence: true, estabilidade: true, ads: true, risco: true,
          upsell: true, observacao: true, confirmedAt: true,
        },
      },
    },
  });

  const ids = relacoes.map((r) => r.id);
  // Vencidas em aberto por relação — a base da sugestão de risco.
  const vencidas = ids.length
    ? await prisma.billing.groupBy({
        by: ["relationshipId"],
        where: {
          relationshipId: { in: ids },
          status: { notIn: ["PAID", "CANCELED"] },
          dueDate: { lt: hoje },
        },
        _count: { _all: true },
        _sum: { amount: true },
      })
    : [];
  const porRelacao = new Map(
    vencidas.map((v) => [v.relationshipId!, { n: v._count._all, valor: n(v._sum.amount) }])
  );

  return relacoes
    .map((r): LinhaAvaliacao => {
      const doMes = r.avaliacoes.find((a) => a.competence === competence);
      const doAnterior = r.avaliacoes.find((a) => a.competence === anterior);
      const base = doMes ?? doAnterior ?? null;
      const atraso = porRelacao.get(r.id);
      const qtd = atraso?.n ?? 0;

      // 01 §4.13: risco sugerido por 2+ cobranças vencidas.
      const riscoSugerido = qtd >= 2 ? "Alto" : qtd === 1 ? "Médio" : null;

      return {
        relationshipId: r.id,
        clientId: r.clientId,
        clientName: r.client.name,
        gestores: r.managers.map((m) => m.manager.name),
        estabilidade: base?.estabilidade ?? null,
        ads: base?.ads ?? null,
        risco: base?.risco ?? riscoSugerido,
        upsell: base?.upsell ?? null,
        observacao: doMes?.observacao ?? null,
        confirmada: !!doMes?.confirmedAt,
        herdada: !doMes && !!doAnterior,
        riscoSugerido,
        motivoSugestao:
          qtd >= 2
            ? `${qtd} cobranças vencidas em aberto`
            : qtd === 1
              ? "1 cobrança vencida em aberto"
              : null,
        vencidas: qtd,
        saldoVencido: atraso?.valor ?? 0,
      };
    })
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
}

/**
 * Grava (ou regrava) a avaliação da competência e a marca CONFIRMADA.
 *
 * Os gestores vigentes são copiados para a linha: 01 §4.3 diz que a
 * avaliação é FOTOGRAFIA e não fonte de vigência — se o gestor mudar
 * depois, a avaliação continua dizendo quem respondia naquele mês.
 */
export async function confirmarLinha(
  competence: Competence,
  dados: SalvarAvaliacao,
  confirmedBy: string | null
) {
  const rel = await prisma.clientAgencyRelationship.findUnique({
    where: { id: dados.relationshipId },
    select: {
      id: true,
      managers: { where: { validTo: null }, select: { manager: { select: { name: true } } } },
    },
  });
  if (!rel) throw new Error("Relação não encontrada.");
  const gestores = rel.managers.map((m) => m.manager.name);

  const existente = await prisma.avaliacaoMensal.findFirst({
    where: { relationshipId: dados.relationshipId, competence },
    select: { id: true },
  });

  const payload = {
    estabilidade: dados.estabilidade ?? null,
    ads: dados.ads ?? null,
    risco: dados.risco ?? null,
    upsell: dados.upsell ?? null,
    observacao: dados.observacao ?? null,
    gestores,
    confirmedAt: new Date(),
    confirmedBy,
  };

  return existente
    ? prisma.avaliacaoMensal.update({ where: { id: existente.id }, data: payload })
    : prisma.avaliacaoMensal.create({
        data: { relationshipId: dados.relationshipId, competence, ...payload },
      });
}

/**
 * "Confirmar todos os sem mudança" (02 §4.1): grava de uma vez as linhas
 * que continuam iguais ao mês anterior.
 *
 * É o gesto que faz o custo alvo de 10 minutos existir: numa carteira
 * estável, a maioria das linhas não muda, e clicar quatro vezes em cada
 * uma para dizer "continua igual" é o que faz o gestor desistir da grade.
 */
export async function confirmarSemMudanca(
  competence: Competence,
  linhas: LinhaAvaliacao[],
  confirmedBy: string | null
): Promise<number> {
  const pendentes = linhas.filter((l) => !l.confirmada);
  let gravadas = 0;
  for (const l of pendentes) {
    await confirmarLinha(
      competence,
      {
        relationshipId: l.relationshipId,
        estabilidade: l.estabilidade,
        ads: l.ads,
        risco: l.risco,
        upsell: l.upsell,
        observacao: l.observacao,
      },
      confirmedBy
    );
    gravadas++;
  }
  return gravadas;
}
