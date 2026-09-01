import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";

/**
 * NRR — NET REVENUE RETENTION (F5.4 · ref. 01 §7.5, §5 de retenção).
 *
 * A fórmula é a da spec, palavra por palavra:
 *   NRR = (MRR inicial + expansão − contração − churn MRR) / MRR inicial
 *
 * E a REGRA DE OURO é a linha 324 de 01: "NRR/expansão/contração leem TERMOS
 * VIGENTES, nunca Client.monthlyValue". O campo do cadastro é o valor de
 * HOJE; o NRR pergunta quanto valia ONTEM — e só a linha do tempo de
 * CommercialTerm sabe responder (é o cenário S12: reajuste de 1.000 para
 * 1.500 em julho tem de aparecer como expansão de 500 EM JULHO, e maio
 * continua valendo 1.000 para sempre).
 *
 * Duas escolhas que definem o número:
 *  - A BASE INICIAL é fotografada no ÚLTIMO INSTANTE do mês anterior. Termo
 *    novo que começa no dia 1º já valeria "desde o início" e a expansão
 *    sumiria da conta.
 *  - CLIENTE NOVO NO MÊS FICA FORA. NRR mede o que aconteceu com a base que
 *    JÁ EXISTIA; vender bem esconderia churn mal — que é exatamente a
 *    confusão que a métrica existe para desfazer.
 */

export type NrrDoMes = {
  competence: string;
  /** MRR da base no último instante do mês anterior. */
  inicial: number;
  expansao: number;
  contracao: number;
  churn: number;
  /** Nulo quando não há base — 0% e ∞ são leituras erradas, não neutras. */
  nrr: number | null;
  motivoDoNulo: string | null;
};

type Termo = { monthlyValue: unknown; validFrom: Date; validTo: Date | null };

/** Valor mensal vigente num instante, pela linha do tempo de termos. */
function valorEm(termos: Termo[], instante: Date): number {
  const t = termos.find(
    (t) => t.validFrom <= instante && (t.validTo == null || t.validTo > instante)
  );
  return t ? n(t.monthlyValue) : 0;
}

export async function nrrDoMes(competence: string): Promise<NrrDoMes> {
  const [y, m] = competence.split("-").map(Number);
  const inicioDoMes = new Date(y, m - 1, 1);
  const fimDoMesAnterior = new Date(inicioDoMes.getTime() - 1);
  const inicioDoProximo = new Date(y, m, 1);
  const fimDoMes = new Date(inicioDoProximo.getTime() - 1);

  const relacoes = await prisma.clientAgencyRelationship.findMany({
    where: {
      // Na base inicial: já existia antes do mês…
      startedAt: { lt: inicioDoMes },
      // …e não tinha saído antes dele.
      OR: [{ churnedAt: null }, { churnedAt: { gte: inicioDoMes } }],
    },
    select: {
      id: true,
      churnedAt: true,
      lifecycleStatus: true,
      terms: {
        where: { monthlyValue: { not: null } },
        select: { monthlyValue: true, validFrom: true, validTo: true },
        orderBy: { validFrom: "desc" },
      },
    },
  });

  let inicial = 0;
  let expansao = 0;
  let contracao = 0;
  let churn = 0;

  for (const r of relacoes) {
    const base = valorEm(r.terms, fimDoMesAnterior);
    if (base <= 0) continue; // sem termo mensal vigente = fora da base MRR
    inicial += base;

    const saiuNoMes =
      r.churnedAt != null && r.churnedAt >= inicioDoMes && r.churnedAt < inicioDoProximo;
    if (saiuNoMes) {
      churn += base;
      continue;
    }

    const final = valorEm(r.terms, fimDoMes);
    const delta = Math.round((final - base) * 100) / 100;
    if (delta > 0) expansao += delta;
    else if (delta < 0) contracao += -delta;
  }

  const arred = (v: number) => Math.round(v * 100) / 100;
  inicial = arred(inicial); expansao = arred(expansao);
  contracao = arred(contracao); churn = arred(churn);

  if (inicial <= 0) {
    return {
      competence, inicial: 0, expansao, contracao, churn,
      nrr: null,
      motivoDoNulo: "Sem base de receita recorrente no início do mês — o NRR não tem sobre o que ser medido.",
    };
  }
  return {
    competence, inicial, expansao, contracao, churn,
    nrr: Math.round(((inicial + expansao - contracao - churn) / inicial) * 1000) / 1000,
    motivoDoNulo: null,
  };
}

/** A série dos últimos `quantos` meses, terminando na competência dada. */
export async function serieDeNrr(competence: string, quantos = 6): Promise<NrrDoMes[]> {
  const [y, m] = competence.split("-").map(Number);
  const out: NrrDoMes[] = [];
  for (let i = quantos - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const c = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push(await nrrDoMes(c));
  }
  return out;
}
