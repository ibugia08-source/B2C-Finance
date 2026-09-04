import { parseCompetence, toCompetence, type Competence } from "@/lib/competence";
import { gerarSnapshot } from "@/lib/snapshots/engine";
import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";

/**
 * FOTOGRAFIAS DA IMPORTAÇÃO (F1.14 v2 · 01 §5.7).
 *
 * Depois da confirmação, cada competência importada SEM fechamento nativo
 * ganha uma fotografia REBUILT_FROM_MIGRATION — é o que faz "como estava
 * agosto?" responder na hora, com a faixa dizendo que a origem é importada.
 *
 * Fotografia é APPEND-ONLY (gatilho no banco): "regenerar" cria outra com o
 * nome do lote; o leitor pega a mais recente. Fechamento nativo futuro
 * prevalece — a fotografia importada vira história, nunca é apagada.
 *
 * O mês corrente e futuros são PULADOS de propósito: fotografia é retrato
 * de mês encerrado, e o mês em andamento ainda vai mudar.
 */

export type ResultadoSnapshots = {
  geradas: { competencia: string; checksum: string }[];
  puladas: { competencia: string; motivo: string }[];
};

export async function gerarSnapshotsDeImportacao(
  competencias: Competence[],
  batchId: string
): Promise<ResultadoSnapshots> {
  const geradas: ResultadoSnapshots["geradas"] = [];
  const puladas: ResultadoSnapshots["puladas"] = [];
  if (competencias.length === 0) return { geradas, puladas };

  const workspaceId = await currentWorkspaceId();
  const agora = new Date();
  const corrente = toCompetence(agora.getFullYear(), agora.getMonth() + 1);

  const fechadas = await runWithoutScope(async () =>
    prisma.closingPeriod.findMany({
      where: { workspaceId, state: "CLOSED", competence: { in: competencias } },
      select: { competence: true },
    })
  );
  const nativas = new Set(fechadas.map((f) => f.competence));
  const nome = `importacao-${batchId.slice(-8)}`;

  for (const comp of competencias) {
    if (comp >= corrente) {
      puladas.push({ competencia: comp, motivo: "mês em andamento — fotografia só de mês encerrado" });
      continue;
    }
    if (nativas.has(comp)) {
      puladas.push({ competencia: comp, motivo: "tem fechamento nativo — o definitivo prevalece" });
      continue;
    }
    const r = await gerarSnapshot(comp, { kind: "REBUILT_FROM_MIGRATION", name: nome });
    geradas.push({ competencia: comp, checksum: r.checksum });
  }
  return { geradas, puladas };
}

/** O mês seguinte de uma competência (uso local em telas). */
export function proximaCompetencia(comp: Competence): Competence {
  const p = parseCompetence(comp)!;
  return p.month === 12 ? toCompetence(p.year + 1, 1) : toCompetence(p.year, p.month + 1);
}
