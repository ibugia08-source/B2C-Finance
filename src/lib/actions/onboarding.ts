"use server";
import { revalidatePath } from "next/cache";
import { tryPermission } from "@/lib/auth/viewer";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  concluirOnboarding, iniciarOnboarding, marcarTarefa,
} from "@/lib/services/onboarding";

export type OnbResult = { ok: true; info?: string } | { ok: false; error: string };

const NEGADO: OnbResult = { ok: false, error: "Você não tem permissão para alterar o onboarding." };

export async function iniciarOnboardingAction(
  relationshipId: string,
  clientId: string
): Promise<OnbResult> {
  if (!(await tryPermission("clientes.editar"))) return NEGADO;
  try {
    const { criadas } = await iniciarOnboarding(relationshipId);
    revalidatePath(`/clientes/${clientId}`);
    return {
      ok: true,
      info: criadas === 0 ? "O onboarding já estava iniciado." : `${criadas} tarefa(s) criada(s).`,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao iniciar o onboarding." };
  }
}

export async function marcarTarefaAction(
  taskId: string,
  concluida: boolean,
  clientId: string
): Promise<OnbResult> {
  if (!(await tryPermission("clientes.editar"))) return NEGADO;
  try {
    const u = await getCurrentUser();
    await marcarTarefa(taskId, concluida, u?.email ?? null);
    revalidatePath(`/clientes/${clientId}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar a tarefa." };
  }
}

export async function concluirOnboardingAction(
  relationshipId: string,
  clientId: string,
  motivoExcecao?: string | null
): Promise<OnbResult> {
  if (!(await tryPermission("clientes.editar"))) return NEGADO;
  try {
    const res = await concluirOnboarding(relationshipId, { motivoExcecao });
    if (!res.ok) return { ok: false, error: res.error };
    revalidatePath(`/clientes/${clientId}`);
    return {
      ok: true,
      info:
        res.status === "EXCEPTION"
          ? "Onboarding encerrado COM exceção — as pendências continuam visíveis."
          : "Onboarding concluído.",
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao concluir o onboarding." };
  }
}
