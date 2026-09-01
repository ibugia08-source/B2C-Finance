"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import { registrarAtividade, type CampoDeAtividade } from "@/lib/services/sdr-activity";

/**
 * Um toque = uma chamada (F4.3 · cenário S2).
 *
 * Sem `revalidatePath` no caminho quente: a tela já soma na hora (otimista) e
 * revalidar a cada toque faria seis idas ao servidor por minuto travarem o
 * botão no celular — o oposto dos 30 segundos que a spec pede.
 */
export async function registrarAtividadeAction(
  sdr: string,
  campo: CampoDeAtividade,
  delta: number,
  agencyId?: string
) {
  await requirePermission("comercial.operar");
  return registrarAtividade(sdr, campo, delta, { agencyId });
}

/** Recarrega os painéis que leem a atividade — chamada ao SAIR da tela. */
export async function sincronizarAtividade() {
  await requirePermission("comercial.visualizar");
  revalidatePath("/atividade");
  revalidatePath("/funil");
  return { ok: true as const };
}
