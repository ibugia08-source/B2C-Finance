"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  ajustarPreferenciaDeCobranca, registrarEnvioDaRegua, registrarPromessa,
} from "@/lib/services/collection-tasks";
import type { EtapaDaRegua } from "@/lib/collection/regua";

/**
 * Ações do Modo Fila (F3.9 · 02 §7.5, §7.7).
 *
 * Cada uma responde a UMA tecla. É isso que faz os 38 itens do cenário S25
 * caberem em doze minutos — e é por isso que nenhuma delas abre formulário
 * quando pode receber o valor pronto.
 */

export async function marcarEnviadaAction(
  billingId: string,
  etapa: EtapaDaRegua,
  mensagem?: string
) {
  await requirePermission("recebimentos.gerar_cobranca");
  const r = await registrarEnvioDaRegua(billingId, etapa, { mensagem });
  revalidatePath("/fila");
  revalidatePath("/cobrancas");
  return r;
}

export async function registrarPromessaAction(
  billingId: string,
  dataISO: string,
  observacao?: string
) {
  await requirePermission("recebimentos.gerar_cobranca");
  const data = new Date(dataISO);
  const r = await registrarPromessa(billingId, data, observacao);
  revalidatePath("/fila");
  revalidatePath("/cobrancas");
  return r;
}

export async function silenciarCobrancaAction(
  clientId: string,
  ateISO: string | null,
  bloqueio?: string | null
) {
  await requirePermission("recebimentos.gerar_cobranca");
  const r = await ajustarPreferenciaDeCobranca(clientId, {
    silencioAte: ateISO ? new Date(ateISO) : null,
    ...(bloqueio !== undefined ? { bloqueio } : {}),
  });
  revalidatePath("/fila");
  revalidatePath("/clientes");
  return r;
}
