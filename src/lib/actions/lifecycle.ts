"use server";
import { revalidateAgency } from "@/lib/revalidate";
import { requirePermission } from "@/lib/auth/viewer";
import { pausarCliente, reativarCliente, retomarCliente } from "@/lib/services/lifecycle";

/** Ações de ciclo de vida (F1.16): pausar, retomar, reativar. */

// Pausar/retomar/reativar muda quem é receita ativa e quem entra no livro
// de renovações: além das telas do cliente, derruba os caches do Dashboard,
// Renovações e métricas (antes só /clientes e /cobrancas eram revalidados e
// o Dashboard seguia mostrando o cliente com o status antigo por até 5 min).
function revalidar(clientId: string) {
  revalidateAgency({ clientId });
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
