"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import { pausarCliente, reativarCliente, retomarCliente } from "@/lib/services/lifecycle";

/** Ações de ciclo de vida (F1.16): pausar, retomar, reativar. */

function revalidar(clientId: string) {
  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  revalidatePath("/cobrancas");
}

export async function pausarClienteAction(clientId: string, motivo?: string) {
  await requirePermission("clientes.editar");
  const r = await pausarCliente(clientId, { motivo: motivo ?? null });
  revalidar(clientId);
  return r;
}

export async function retomarClienteAction(clientId: string, motivo?: string) {
  await requirePermission("clientes.editar");
  const r = await retomarCliente(clientId, motivo ?? null);
  revalidar(clientId);
  return r;
}

export async function reativarClienteAction(clientId: string, motivo?: string) {
  await requirePermission("clientes.editar");
  const r = await reativarCliente(clientId, motivo ?? null);
  revalidar(clientId);
  return r;
}
