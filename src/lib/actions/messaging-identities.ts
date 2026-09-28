"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { domainContextFor } from "@/lib/auth/domain-session";
import {
  desvincularWhatsApp,
  reativarWhatsApp,
  vincularWhatsApp,
} from "@/lib/services/messaging-identities";

/**
 * VÍNCULOS DE WHATSAPP (Configurações → Integrações → WhatsApp). A regra —
 * só administrador, usuário do workspace e ativo, um número por usuário
 * ativo, auditoria — mora em lib/services/messaging-identities.
 */

const PAGINA = "/configuracoes/integracoes/whatsapp";

export async function vincularWhatsAppAction(formData: FormData) {
  const ctx = await domainContextFor(await getViewer());
  const r = await vincularWhatsApp(ctx, {
    userId: String(formData.get("userId") ?? ""),
    telefone: String(formData.get("telefone") ?? ""),
  });
  if (r.ok) revalidatePath(PAGINA);
  return r;
}

export async function desvincularWhatsAppAction(id: string) {
  const r = await desvincularWhatsApp(await domainContextFor(await getViewer()), id);
  if (r.ok) revalidatePath(PAGINA);
  return r;
}

export async function reativarWhatsAppAction(id: string) {
  const r = await reativarWhatsApp(await domainContextFor(await getViewer()), id);
  if (r.ok) revalidatePath(PAGINA);
  return r;
}
