"use server";
import { requirePermission } from "@/lib/auth/viewer";
import { analisarConversao } from "@/lib/services/leads";

/**
 * Prévia da conversão (F4.2). Só leitura — é o que a tela mostra ANTES de
 * alguém confirmar, e por isso não muda nada.
 */
export async function analisarConversaoAction(leadId: string) {
  await requirePermission("comercial.visualizar");
  return analisarConversao(leadId);
}
