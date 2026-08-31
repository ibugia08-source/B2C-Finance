import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import type { Competence } from "@/lib/competence";
import {
  permiteEvento, ROTULO_DO_PERIODO, type EstadoDePeriodo,
} from "@/lib/periods/events";

/**
 * FECHAMENTO DE COMPETÊNCIA (F2.1 · ref. 01 §5.2, §5.5; 03 §4.4).
 *
 * Competência SEM linha é ABERTA. Nada é semeado: criar 12 meses de "OPEN" na
 * migration daria a impressão de que alguém decidiu algo sobre eles, quando
 * ninguém decidiu nada. A linha nasce no primeiro gesto real de fechamento.
 *
 * O período é do WORKSPACE, não do dono — por isso todas as consultas aqui
 * rodam fora do escopo de dono, como as de Agency e Workspace.
 */

export type PeriodoInfo = {
  competence: string;
  estado: EstadoDePeriodo;
  rotulo: string;
  versao: number;
  precisaRevalidar: boolean;
  fechadoEm: Date | null;
  fechadoPor: string | null;
  reabertoEm: Date | null;
  motivoReabertura: string | null;
  /** Existe linha no banco? false = aberto por ausência, nunca tocado. */
  registrado: boolean;
};

const ABERTO_POR_AUSENCIA = (competence: string): PeriodoInfo => ({
  competence,
  estado: "OPEN",
  rotulo: ROTULO_DO_PERIODO.OPEN,
  versao: 1,
  precisaRevalidar: false,
  fechadoEm: null,
  fechadoPor: null,
  reabertoEm: null,
  motivoReabertura: null,
  registrado: false,
});

export async function periodoDe(competence: Competence | string): Promise<PeriodoInfo> {
  const workspaceId = await currentWorkspaceId();
  const row = await runWithoutScope(async () =>
    prisma.closingPeriod.findFirst({
      where: { workspaceId, scopeType: "WORKSPACE", scopeId: "", competence },
    })
  );
  if (!row) return ABERTO_POR_AUSENCIA(competence);
  return {
    competence,
    estado: row.state as EstadoDePeriodo,
    rotulo: ROTULO_DO_PERIODO[row.state as EstadoDePeriodo],
    versao: row.version,
    precisaRevalidar: row.needsRevalidation,
    fechadoEm: row.closedAt,
    fechadoPor: row.closedBy,
    reabertoEm: row.reopenedAt,
    motivoReabertura: row.reopenReason,
    registrado: true,
  };
}

/** Estados de várias competências de uma vez (cabeçalhos, painel anual). */
export async function periodosDe(competencias: string[]): Promise<Map<string, PeriodoInfo>> {
  const workspaceId = await currentWorkspaceId();
  const rows = await runWithoutScope(async () =>
    prisma.closingPeriod.findMany({
      where: {
        workspaceId, scopeType: "WORKSPACE", scopeId: "",
        competence: { in: competencias },
      },
    })
  );
  const mapa = new Map<string, PeriodoInfo>();
  for (const c of competencias) mapa.set(c, ABERTO_POR_AUSENCIA(c));
  for (const r of rows) {
    mapa.set(r.competence, {
      competence: r.competence,
      estado: r.state as EstadoDePeriodo,
      rotulo: ROTULO_DO_PERIODO[r.state as EstadoDePeriodo],
      versao: r.version,
      precisaRevalidar: r.needsRevalidation,
      fechadoEm: r.closedAt,
      fechadoPor: r.closedBy,
      reabertoEm: r.reopenedAt,
      motivoReabertura: r.reopenReason,
      registrado: true,
    });
  }
  return mapa;
}

/**
 * A GUARDA (03 §4.4): "toda mutação financeira chama
 * assertPeriodAllows(eventType, competence)".
 *
 * `competence` é SEMPRE a competência em que o evento vai POSTAR — não a de
 * origem do documento. Para um recebimento, é o mês do caixa; é essa
 * distinção que faz §5.6 funcionar (pagar em outubro uma cobrança de agosto
 * fechado é normal e permitido).
 */
export async function assertPeriodAllows(
  eventType: string,
  competence: Competence | string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = await periodoDe(competence);
  return permiteEvento(p.estado, eventType);
}

async function upsertPeriodo(
  competence: string,
  data: Record<string, unknown>
): Promise<PeriodoInfo> {
  const workspaceId = await currentWorkspaceId();
  await runWithoutScope(async () =>
    prisma.closingPeriod.upsert({
      where: {
        workspaceId_scopeType_scopeId_competence: {
          workspaceId, scopeType: "WORKSPACE", scopeId: "", competence,
        },
      },
      create: { workspaceId, scopeType: "WORKSPACE", scopeId: "", competence, ...data },
      update: data,
    })
  );
  return periodoDe(competence);
}

/** Dias 1-5: entra em fechamento; as pendências do checklist seguem. */
export async function iniciarFechamento(competence: string, quem: string | null) {
  return upsertPeriodo(competence, {
    state: "SOFT_CLOSED",
    softClosedAt: new Date(),
    softClosedBy: quem,
  });
}

export async function fecharPeriodo(competence: string, quem: string | null) {
  return upsertPeriodo(competence, {
    state: "CLOSED",
    closedAt: new Date(),
    closedBy: quem,
  });
}

/**
 * Reabrir (01 §5.5).
 *
 * Duas coisas acontecem juntas, e a segunda é a que se esquece: a versão sobe
 * E TODAS AS COMPETÊNCIAS POSTERIORES JÁ FECHADAS são marcadas
 * needsRevalidation. Os números delas foram calculados sobre um passado que
 * acabou de mudar. Elas não são apagadas nem reabertas — são MARCADAS, para
 * que quem olhar saiba que aquele fechamento merece uma segunda conferida.
 *
 * Sem essa marcação, reabrir agosto deixa setembro e outubro parecendo
 * intactos, e é assim que um erro de agosto vira três meses de relatório
 * errado sem ninguém perceber.
 */
export async function reabrirPeriodo(
  competence: string,
  motivo: string,
  quem: string | null
): Promise<{ ok: true; periodo: PeriodoInfo; marcados: number } | { ok: false; error: string }> {
  const texto = (motivo ?? "").trim();
  if (texto.length < 10) {
    return { ok: false, error: "Escreva o motivo da reabertura (pelo menos 10 caracteres)." };
  }
  const atual = await periodoDe(competence);
  if (atual.estado !== "CLOSED") {
    return { ok: false, error: `Só é possível reabrir um mês fechado. Este está ${atual.rotulo.toLowerCase()}.` };
  }

  const workspaceId = await currentWorkspaceId();
  const marcados = await runWithoutScope(async () => {
    const r = await prisma.closingPeriod.updateMany({
      where: {
        workspaceId, scopeType: "WORKSPACE", scopeId: "",
        competence: { gt: competence },
        state: "CLOSED",
      },
      data: { needsRevalidation: true },
    });
    return r.count;
  });

  const periodo = await upsertPeriodo(competence, {
    state: "REOPENED",
    version: atual.versao + 1,
    reopenedAt: new Date(),
    reopenedBy: quem,
    reopenReason: texto,
    needsRevalidation: false,
  });
  return { ok: true, periodo, marcados };
}

/** Volta ao normal (desfaz um "em fechamento" iniciado por engano). */
export async function reabrirParaOperacao(competence: string) {
  return upsertPeriodo(competence, { state: "OPEN", softClosedAt: null, softClosedBy: null });
}
