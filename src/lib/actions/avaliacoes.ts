"use server";
import { tryPermission } from "@/lib/auth/viewer";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCompetence, type Competence } from "@/lib/competence";
import { carregarGrade, confirmarLinha, confirmarSemMudanca } from "@/lib/services/avaliacao-mensal";
import type { SalvarAvaliacao } from "@/lib/avaliacao-meta";
import { revalidatePath } from "next/cache";

export type AvaliacaoResult = { ok: true; gravadas?: number } | { ok: false; error: string };

const NEGADO: AvaliacaoResult = {
  ok: false,
  error: "Você não tem permissão para avaliar clientes.",
};

/** Confirma UMA linha da grade. */
export async function salvarAvaliacao(
  competence: string,
  dados: SalvarAvaliacao
): Promise<AvaliacaoResult> {
  if (!(await tryPermission("clientes.editar"))) return NEGADO;
  if (!isCompetence(competence)) return { ok: false, error: "Competência inválida." };
  try {
    const u = await getCurrentUser();
    await confirmarLinha(competence as Competence, dados, u?.email ?? null);
    revalidatePath("/avaliacoes");
    return { ok: true, gravadas: 1 };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao salvar a avaliação." };
  }
}

/**
 * "Confirmar todos os sem mudança" — o gesto que faz o custo alvo de 10
 * minutos por gestor existir (02 §4.1).
 */
export async function confirmarTodosSemMudanca(
  competence: string
): Promise<AvaliacaoResult> {
  if (!(await tryPermission("clientes.editar"))) return NEGADO;
  if (!isCompetence(competence)) return { ok: false, error: "Competência inválida." };
  try {
    const u = await getCurrentUser();
    const linhas = await carregarGrade(competence as Competence);
    const gravadas = await confirmarSemMudanca(competence as Competence, linhas, u?.email ?? null);
    revalidatePath("/avaliacoes");
    return { ok: true, gravadas };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao confirmar em lote." };
  }
}
