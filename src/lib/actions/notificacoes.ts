"use server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { marcarLida, marcarTodasLidas } from "@/lib/services/notifications";

/** Ações da central de notificações (F1.19). */

export async function marcarLidaAction(id: string) {
  const viewer = await getViewer();
  const r = await marcarLida(viewer.id, id);
  revalidatePath("/notificacoes");
  return r;
}

export async function marcarTodasLidasAction() {
  const viewer = await getViewer();
  const r = await marcarTodasLidas(viewer.id);
  revalidatePath("/notificacoes");
  return r;
}
