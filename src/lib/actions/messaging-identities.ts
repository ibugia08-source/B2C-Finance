"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { domainContextFor } from "@/lib/auth/domain-session";
import {
  desvincularIdentidade,
  reativarIdentidade,
  vincularIdentidade,
} from "@/lib/services/messaging-identities";

/**
 * VÍNCULOS DE CANAIS (Configurações → Integrações → Canais): Telegram e
 * WhatsApp. A regra — só administrador, usuário do workspace e ativo, um
 * identificador ativo por canal, auditoria — mora em
 * lib/services/messaging-identities.
 */

const PAGINA = "/configuracoes/integracoes/canais";

export async function vincularCanalAction(formData: FormData) {
  const ctx = await domainContextFor(await getViewer());
  const canal = String(formData.get("channel") ?? "");
  const r = await vincularIdentidade(ctx, {
    userId: String(formData.get("userId") ?? ""),
    channel: canal === "WHATSAPP" ? "WHATSAPP" : canal === "TELEGRAM" ? "TELEGRAM" : (canal as never),
    externalIdentifier: String(formData.get("externalIdentifier") ?? ""),
    metadata: { username: String(formData.get("username") ?? "") || null },
  });
  if (r.ok) revalidatePath(PAGINA);
  return r;
}

export async function desvincularCanalAction(id: string) {
  const r = await desvincularIdentidade(await domainContextFor(await getViewer()), id);
  if (r.ok) revalidatePath(PAGINA);
  return r;
}

export async function reativarCanalAction(id: string) {
  const r = await reativarIdentidade(await domainContextFor(await getViewer()), id);
  if (r.ok) revalidatePath(PAGINA);
  return r;
}
