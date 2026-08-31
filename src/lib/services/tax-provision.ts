import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { toNumber as n } from "@/lib/format";
import type { Competence } from "@/lib/competence";

/**
 * PROVISÃO TRIBUTÁRIA E RESERVA (F3.3 · ref. 01 §3.8).
 *
 * "Eventos independentes." A frase da spec é a regra inteira, e é a que mais
 * se erra na prática:
 *
 *   PROVISÃO  reconhece a OBRIGAÇÃO — despesa tributária contra impostos a
 *             pagar. Entra no resultado.
 *   RESERVA   segrega o CAIXA — reserva contra conta operacional. NÃO é
 *             despesa; o dinheiro continua sendo da empresa.
 *
 * Quem trata as duas como uma só conta o imposto DUAS VEZES no resultado: uma
 * como despesa tributária e outra como saída de caixa. O erro é invisível no
 * extrato (o dinheiro realmente saiu da conta) e só aparece quando o lucro do
 * ano não bate com o que o contador apurou.
 *
 * E o sistema NUNCA executa a transferência (§3.8): ele calcula, sugere e
 * espera. Mover dinheiro entre contas é decisão de quem assina.
 */

export type SugestaoDeProvisao = {
  legalEntityId: string;
  legalEntityName: string;
  competence: string;
  /** Faturamento apurado no mês. */
  base: number;
  /** Alíquota efetiva da entidade, em porcentagem. */
  aliquota: number;
  /** Imposto calculado. */
  valor: number;
  /** Já existe provisão gravada para este mês? */
  jaProvisionado: boolean;
  /** Já foi lançada no razão? */
  jaLancada: boolean;
  /** A transferência para a reserva já foi feita? */
  reservaFeita: boolean;
  /** Sem alíquota configurada não há o que calcular — e isso é dito. */
  semAliquota: boolean;
};

/** Alíquota efetiva da entidade, lida de taxSettings. */
function aliquotaDe(taxSettings: unknown): number | null {
  if (!taxSettings || typeof taxSettings !== "object") return null;
  const v = (taxSettings as any).aliquotaEfetiva ?? (taxSettings as any).effectiveRate;
  const num = Number(v);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export async function sugerirProvisoes(
  competence: Competence | string
): Promise<SugestaoDeProvisao[]> {
  const workspaceId = await currentWorkspaceId();
  const [ano, mes] = competence.split("-").map(Number);

  const entidades = await runWithoutScope(async () =>
    prisma.legalEntity.findMany({
      where: { workspaceId },
      orderBy: { legalName: "asc" },
      select: { id: true, legalName: true, tradeName: true, taxSettings: true },
    })
  );

  const provisoes = await prisma.taxProvision.findMany({ where: { competence } });
  const porEntidade = new Map(provisoes.map((p) => [p.legalEntityId, p]));

  // BASE = faturamento reconhecido no mês, por entidade. Hoje há uma
  // entidade só (19.15), então a base é o faturamento do mês inteiro; quando
  // houver mais de uma, o recorte é por agência da entidade.
  const faturado = await prisma.billing.aggregate({
    where: { competence, status: { not: "CANCELED" } },
    _sum: { amount: true },
  });
  const base = n(faturado._sum.amount);
  void ano; void mes;

  return entidades.map((e) => {
    const aliquota = aliquotaDe(e.taxSettings);
    const existente = porEntidade.get(e.id);
    return {
      legalEntityId: e.id,
      legalEntityName: e.tradeName ?? e.legalName,
      competence,
      base,
      aliquota: aliquota ?? 0,
      valor: aliquota ? Math.round(base * aliquota) / 100 : 0,
      jaProvisionado: !!existente,
      jaLancada: !!existente?.postedAt,
      reservaFeita: !!existente?.reserveDoneAt,
      semAliquota: aliquota == null,
    };
  });
}

/**
 * Grava a provisão e a lança no razão.
 *
 * A gravação e o lançamento andam juntos: uma provisão gravada e não lançada
 * é uma obrigação que existe no sistema e não existe no resultado — a pior
 * das duas metades.
 */
export async function provisionar(
  competence: string,
  legalEntityId: string,
  quem: string | null
): Promise<{ ok: true; valor: number } | { ok: false; error: string }> {
  const sugestoes = await sugerirProvisoes(competence);
  const s = sugestoes.find((x) => x.legalEntityId === legalEntityId);
  if (!s) return { ok: false, error: "Entidade não encontrada." };
  if (s.semAliquota)
    return {
      ok: false,
      error: "Esta entidade não tem alíquota efetiva configurada — sem ela não há o que provisionar.",
    };
  if (s.valor <= 0)
    return { ok: false, error: "Não houve faturamento neste mês; não há imposto a provisionar." };

  const workspaceId = await currentWorkspaceId();
  const { post } = await import("@/lib/accounting/engine");

  const provisao = await prisma.taxProvision.upsert({
    where: { legalEntityId_competence: { legalEntityId, competence } },
    create: {
      legalEntityId,
      competence,
      baseAmount: s.base,
      rate: s.aliquota,
      amount: s.valor,
      reserveSuggested: s.valor,
    },
    update: { baseAmount: s.base, rate: s.aliquota, amount: s.valor, reserveSuggested: s.valor },
  });

  const r = await post({
    eventType: "TAX_PROVISIONED",
    sourceType: "TaxProvision",
    sourceId: provisao.id,
    competence: competence as Competence,
    amount: s.valor,
    context: { workspaceId },
  });
  if (!r.ok) return { ok: false, error: r.error };

  await prisma.taxProvision.update({
    where: { id: provisao.id },
    data: { postedAt: r.posted ? new Date() : null },
  });

  void quem;
  return { ok: true, valor: s.valor };
}

/**
 * Registra que a transferência para a reserva FOI FEITA por alguém.
 *
 * O sistema não move o dinheiro — ele anota que a pessoa moveu. A diferença
 * importa: transferência automática entre contas bancárias é o tipo de coisa
 * que, quando dá errado, dá errado no dia do vencimento.
 */
export async function marcarReservaFeita(
  competence: string,
  legalEntityId: string,
  quem: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = await prisma.taxProvision.findUnique({
    where: { legalEntityId_competence: { legalEntityId, competence } },
  });
  if (!p) return { ok: false, error: "Provisão não encontrada." };
  await prisma.taxProvision.update({
    where: { id: p.id },
    data: { reserveDoneAt: new Date(), reserveDoneBy: quem },
  });
  return { ok: true };
}
