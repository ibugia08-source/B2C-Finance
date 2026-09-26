import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { addMonths, competenceLabel, todayKey, type Competence } from "@/lib/competence";
import { getActiveClientsByCompetences } from "@/lib/clients/status-history";

export type PortfolioProjectionRow = {
  competence: Competence;
  label: string;
  /** "REALIZADO" = mês em curso (status vigente hoje); "PROJETADO" = futuro. */
  kind: "REALIZADO" | "PROJETADO";
  ativos: number;
  mrr: number;
  /** Alterações de status programadas que começam nesta competência. */
  programadas: number;
};

/**
 * CARTEIRA PROJETADA (26/09/2026): mês em curso + próximos meses, pelo status
 * no encerramento de cada competência na linha do tempo — que inclui as
 * alterações PROGRAMADAS. Ex.: Alpha (MRR R$ 1.500) ativo até setembro e
 * Inativo a partir de outubro → setembro inclui os R$ 1.500, outubro
 * projetado não. Valor = mensalidade atual (limitação documentada).
 */
export async function getPortfolioProjection(ahead = 6, today = todayKey()): Promise<PortfolioProjectionRow[]> {
  const atual = today.slice(0, 7);
  const comps = Array.from({ length: ahead + 1 }, (_, i) => addMonths(atual, i));
  const clientes = await prisma.client.findMany({ select: { id: true, modality: true, monthlyValue: true } });
  const ativosPorMes = await getActiveClientsByCompetences(comps, { today });
  const porComp = new Map<string, number>();
  // Todas as programadas (não só a próxima de cada cliente) contam no mês.
  const todas = await prisma.clientStatusHistory.findMany({
    where: { effectiveFrom: { gt: new Date(`${today}T00:00:00.000Z`) } },
    select: { effectiveFrom: true },
  });
  for (const p of todas) {
    const c = p.effectiveFrom.toISOString().slice(0, 7);
    porComp.set(c, (porComp.get(c) ?? 0) + 1);
  }
  return comps.map((c) => {
    const ativos = ativosPorMes.get(c) ?? new Set<string>();
    let mrr = 0;
    for (const cl of clientes) if (cl.modality === "MRR" && ativos.has(cl.id)) mrr += n(cl.monthlyValue);
    return {
      competence: c,
      label: competenceLabel(c),
      kind: c === atual ? "REALIZADO" : "PROJETADO",
      ativos: ativos.size,
      mrr: Math.round(mrr * 100) / 100,
      programadas: porComp.get(c) ?? 0,
    };
  });
}
