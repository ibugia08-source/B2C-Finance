import { competenciasDoPeriodo, type Competence } from "@/lib/competence";

/**
 * Ponte entre os PERÍODOS das telas (Dashboard, relatórios: [start, end)
 * montados com construtores locais) e as COMPETÊNCIAS da linha do tempo de
 * status. Indicador de carteira de um período = a situação no encerramento
 * do ÚLTIMO mês dele.
 */
export function periodReferenceCompetence(period: { start: Date; end: Date }): Competence {
  const comps = competenciasDoPeriodo(period.start, period.end);
  return comps[comps.length - 1];
}

export function periodCompetences(period: { start: Date; end: Date }): Competence[] {
  return competenciasDoPeriodo(period.start, period.end);
}

export { getStatusesForCompetences as getClientStatusesForCompetences } from "./status-history";
