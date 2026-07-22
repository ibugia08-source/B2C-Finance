"use server";
import { prisma } from "@/lib/prisma";
import { revalidateAgency } from "@/lib/revalidate";
import { requireAdmin } from "@/lib/auth/viewer";

/**
 * Ações da ROTINA DIÁRIA — estado por dia em RoutineItemState.
 *  - "removed": item oculto da rotina de HOJE (não altera cliente/cobrança/
 *    despesa nem status financeiro — só a lista operacional do dia).
 *  - "done": ação do checklist concluída hoje.
 * Escopo por dono é automático (extensão ownerId do prisma).
 */

type ActionResult = { ok: true } | { ok: false; error: string };

const ITEM_TYPES = ["cobranca", "pagamento", "acao"] as const;
type ItemType = (typeof ITEM_TYPES)[number];

/** Meia-noite local de hoje — chave do dia da rotina. */
function todayKey(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Remove um item (cobrança/pagamento) da rotina de hoje. Só oculta. */
export async function dismissRoutineItem(
  itemType: ItemType,
  itemKey: string,
  reason?: string | null
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    if (!ITEM_TYPES.includes(itemType)) return { ok: false, error: "Tipo inválido." };
    const key = String(itemKey ?? "").trim();
    if (!key) return { ok: false, error: "Item inválido." };

    const routineDate = todayKey();
    const existing = await prisma.routineItemState.findFirst({
      where: { routineDate, itemType, itemKey: key, status: "removed" },
      select: { id: true },
    });
    if (!existing) {
      await prisma.routineItemState.create({
        data: {
          routineDate,
          itemType,
          itemKey: key,
          status: "removed",
          reason: (reason ?? "").trim() || null,
          actorName: viewer.name,
        },
      });
    }
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao remover da rotina." };
  }
}

/** Marca/desmarca uma ação do checklist de hoje como concluída. */
export async function setRoutineActionDone(
  itemKey: string,
  done: boolean
): Promise<ActionResult> {
  const viewer = await requireAdmin();
  try {
    const key = String(itemKey ?? "").trim();
    if (!key) return { ok: false, error: "Ação inválida." };

    const routineDate = todayKey();
    const existing = await prisma.routineItemState.findFirst({
      where: { routineDate, itemType: "acao", itemKey: key, status: "done" },
      select: { id: true },
    });
    if (done && !existing) {
      await prisma.routineItemState.create({
        data: {
          routineDate,
          itemType: "acao",
          itemKey: key,
          status: "done",
          actorName: viewer.name,
        },
      });
    } else if (!done && existing) {
      await prisma.routineItemState.deleteMany({ where: { id: existing.id } });
    }
    revalidateAgency();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao atualizar a ação." };
  }
}
