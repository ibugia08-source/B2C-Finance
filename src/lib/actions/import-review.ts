"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import { encerrarPendencia } from "@/lib/services/import-review";

export async function encerrarPendenciaAction(
  id: string,
  como: "RESOLVIDO" | "DESCARTADO"
) {
  const viewer = await requirePermission("importacoes.importar");
  await encerrarPendencia(id, como, viewer.name ?? null);
  revalidatePath("/importacoes");
  return { ok: true as const };
}
