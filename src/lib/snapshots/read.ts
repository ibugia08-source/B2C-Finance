import { snapshotDe } from "./engine";
import { checksumByArea } from "./serialize";
import type { Competence } from "@/lib/competence";

/**
 * LEITURA DE FOTOGRAFIA (F2.4 · ref. 01 §5.4; 02 §7.8).
 *
 * "Período CLOSED lê snapshot em painéis."
 *
 * O QUE ESTE ARQUIVO NÃO FAZ, e é decisão, não omissão: a Gestão do Mês NÃO
 * passa a ler a fotografia quando o mês fecha. 01 §5.6 é explícito de que os
 * dois números coexistem e são ambos verdadeiros — "como fechou agosto"
 * mostra vencido; "saldo atual da carteira de agosto" mostra quitado, porque
 * o cliente pagou em outubro. Trocar a tela operacional pela fotografia
 * esconderia o pagamento que entrou depois, que é justamente o que a equipe
 * de cobrança precisa ver.
 *
 * Quem lê a fotografia são os PAINÉIS (o retrato do mês) e a tela de
 * fotografia. A Gestão do Mês ganha a faixa e o link, e perde os gestos.
 */

export type Fotografia = {
  id: string;
  competence: string;
  versao: number;
  fechadoPor: string | null;
  fechadoEm: Date;
  sourceCutoffAt: Date;
  schemaVersion: number;
  metricVersion: number;
  checksum: string;
  checksumPorArea: Record<string, string>;
  precisaRevalidar: boolean;
  areas: Record<string, any>;
};

export async function lerFotografia(
  competence: Competence | string
): Promise<Fotografia | null> {
  const row = await snapshotDe(competence);
  if (!row) return null;
  return {
    id: row.id,
    competence: row.competence,
    versao: row.version,
    fechadoPor: row.closedBy,
    fechadoEm: row.closedAt,
    sourceCutoffAt: row.sourceCutoffAt,
    schemaVersion: row.schemaVersion,
    metricVersion: row.metricRegistryVersion,
    checksum: row.checksum,
    checksumPorArea: (row.checksumByArea ?? {}) as Record<string, string>,
    precisaRevalidar: row.needsRevalidation,
    areas: (row.areas ?? {}) as Record<string, any>,
  };
}

/** Indicadores gravados na fotografia, prontos para os cards. */
export function indicadoresDa(f: Fotografia): Record<string, number | null> {
  const ind = f.areas.indicadores ?? {};
  const saida: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(ind as Record<string, any>)) {
    saida[k] = typeof v?.valor === "number" ? v.valor : null;
  }
  return saida;
}

/**
 * A fotografia ainda bate com o que está gravado nela?
 *
 * Recalcula o checksum a partir do próprio conteúdo. Não prova que o mês não
 * mudou (isso é o job de integridade da F2.8, que RECALCULA do zero); prova
 * que a linha não foi adulterada por fora do sistema.
 */
export function conferirChecksum(f: Fotografia): {
  ok: boolean;
  areasDivergentes: string[];
} {
  const { porArea, total } = checksumByArea(f.areas);
  const divergentes = Object.keys(porArea).filter(
    (a) => f.checksumPorArea[a] && f.checksumPorArea[a] !== porArea[a]
  );
  return { ok: total === f.checksum && divergentes.length === 0, areasDivergentes: divergentes };
}

/** Uma área existia no período retratado? (02 §7.8) */
export function areaDisponivel(f: Fotografia, area: string): boolean {
  const a = f.areas[area];
  if (a == null) return false;
  return !(typeof a === "object" && !Array.isArray(a) && (a as any).indisponivel === true);
}
