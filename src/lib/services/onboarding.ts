import { prisma } from "@/lib/prisma";
import {
  ONBOARDING_TEMPLATE, type QuadroOnboarding, type TarefaOnboarding,
} from "@/lib/onboarding-meta";

/**
 * ONBOARDING (F1.18 · ref. 01 §4.11, 02 §4.2).
 *
 * "Cliente manual também inicia": o onboarding não é privilégio de quem
 * entrou pelo funil comercial. Quem cadastra um cliente na Carteira
 * também precisa da mesma lista de pendências — senão metade da carteira
 * fica sem implantação registrada e o board vira ficção.
 *
 * IDEMPOTENTE: iniciar duas vezes não duplica tarefa. A chave é o
 * templateKey por relação, e a tarefa que já existe é respeitada, com o
 * que já foi concluído nela.
 */

const DIA = 24 * 60 * 60 * 1000;

function prazo(inicio: Date, offsetDays: number): Date {
  return new Date(inicio.getTime() + offsetDays * DIA);
}

/** Cria as tarefas do template que ainda não existem para a relação. */
export async function iniciarOnboarding(
  relationshipId: string,
  inicio?: Date
): Promise<{ criadas: number }> {
  const rel = await prisma.clientAgencyRelationship.findUnique({
    where: { id: relationshipId },
    select: { id: true, startedAt: true, createdAt: true, onboardingStatus: true },
  });
  if (!rel) throw new Error("Relação não encontrada.");

  const base = inicio ?? rel.startedAt ?? rel.createdAt;
  const existentes = await prisma.onboardingTask.findMany({
    where: { relationshipId },
    select: { templateKey: true },
  });
  const jaTem = new Set(existentes.map((t) => t.templateKey));

  const faltando = ONBOARDING_TEMPLATE.filter((t) => !jaTem.has(t.key));
  if (faltando.length === 0) return { criadas: 0 };

  await prisma.onboardingTask.createMany({
    data: faltando.map((t, i) => ({
      relationshipId,
      title: t.title,
      description: t.description ?? null,
      position: ONBOARDING_TEMPLATE.indexOf(t),
      offsetDays: t.offsetDays,
      dueAt: prazo(base, t.offsetDays),
      templateKey: t.key,
    })),
  });

  if (rel.onboardingStatus === "NOT_STARTED") {
    await prisma.clientAgencyRelationship.update({
      where: { id: relationshipId },
      data: { onboardingStatus: "IN_PROGRESS" },
    });
  }
  return { criadas: faltando.length };
}

export async function carregarQuadro(relationshipId: string): Promise<QuadroOnboarding | null> {
  const rel = await prisma.clientAgencyRelationship.findUnique({
    where: { id: relationshipId },
    select: {
      id: true,
      onboardingStatus: true,
      startedAt: true,
      onboarding: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true, title: true, description: true, templateKey: true,
          offsetDays: true, dueAt: true, doneAt: true, doneBy: true,
        },
      },
    },
  });
  if (!rel) return null;

  const hoje = new Date();
  const obrigatorias = new Set(
    ONBOARDING_TEMPLATE.filter((t) => t.required).map((t) => t.key)
  );

  const tarefas: TarefaOnboarding[] = rel.onboarding.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    templateKey: t.templateKey,
    offsetDays: t.offsetDays,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    doneAt: t.doneAt ? t.doneAt.toISOString() : null,
    doneBy: t.doneBy,
    required: t.templateKey ? obrigatorias.has(t.templateKey) : false,
    atrasada: !t.doneAt && !!t.dueAt && t.dueAt < hoje,
  }));

  return {
    relationshipId: rel.id,
    status: rel.onboardingStatus,
    iniciadoEm: rel.startedAt ? rel.startedAt.toISOString() : null,
    tarefas,
    concluidas: tarefas.filter((t) => t.doneAt).length,
    total: tarefas.length,
    obrigatoriasPendentes: tarefas.filter((t) => t.required && !t.doneAt).length,
  };
}

export async function marcarTarefa(
  taskId: string,
  concluida: boolean,
  por: string | null
) {
  return prisma.onboardingTask.update({
    where: { id: taskId },
    data: {
      doneAt: concluida ? new Date() : null,
      doneBy: concluida ? por : null,
    },
  });
}

/**
 * Encerra o onboarding.
 *
 * 01 §4.11: "sair de Onboarding exige obrigatórias completas OU exceção
 * com motivo". A exceção não é uma porta dos fundos — ela é registrada
 * como EXCEPTION, e não como COMPLETE, para que a diferença entre "fez
 * tudo" e "seguiu mesmo faltando" continue visível depois.
 */
export async function concluirOnboarding(
  relationshipId: string,
  opts: { motivoExcecao?: string | null } = {}
): Promise<{ ok: true; status: string } | { ok: false; error: string; pendentes: number }> {
  const quadro = await carregarQuadro(relationshipId);
  if (!quadro) return { ok: false, error: "Relação não encontrada.", pendentes: 0 };

  if (quadro.obrigatoriasPendentes > 0 && !opts.motivoExcecao?.trim()) {
    return {
      ok: false,
      error: `Faltam ${quadro.obrigatoriasPendentes} tarefa(s) obrigatória(s). Conclua ou informe o motivo da exceção.`,
      pendentes: quadro.obrigatoriasPendentes,
    };
  }

  const status = quadro.obrigatoriasPendentes > 0 ? "EXCEPTION" : "COMPLETE";
  await prisma.clientAgencyRelationship.update({
    where: { id: relationshipId },
    data: { onboardingStatus: status },
  });
  return { ok: true, status };
}
