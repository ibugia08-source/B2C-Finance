"use server";
import { z } from "zod";
import { ClientStatus } from "@prisma/client";
import { can, tryPermission, NO_PERMISSION } from "@/lib/auth/viewer";
import { revalidateClientStatus } from "@/lib/revalidate";
import type { ActionResult } from "./clients";
import {
  StatusChangeError,
  cancelScheduledStatusChange,
  changeClientStatus,
  materializarStatusProgramados,
  type StatusCapabilities,
} from "@/lib/clients/status-history";
import { isDateKey } from "@/lib/competence";

/**
 * ALTERAÇÃO DE STATUS COM VIGÊNCIA — as actions da interface (26/09/2026).
 * A regra mora em src/lib/clients/status-history.ts; aqui só entram sessão,
 * permissão (RBAC existente) e o formato da resposta.
 */

async function capacidades(): Promise<{ viewer: Awaited<ReturnType<typeof tryPermission>>; caps: StatusCapabilities }> {
  const viewer = await tryPermission("clientes.alterar_status");
  return {
    viewer,
    caps: {
      alterar: !!viewer,
      programar: !!viewer && can(viewer, "clientes.programar_status"),
      retroativo: !!viewer && can(viewer, "clientes.alterar_status_retroativo"),
    },
  };
}

const ChangeSchema = z.object({
  clientId: z.string().min(1),
  status: z.nativeEnum(ClientStatus),
  effectiveFrom: z.string().refine(isDateKey, "Informe o início da vigência."),
  reason: z.string().trim().max(500).nullish(),
  renewalCompetence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullish(),
});

function erro(e: any, padrao: string): ActionResult {
  if (e instanceof StatusChangeError) return { ok: false, error: e.message };
  return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? padrao };
}

/** Novo status a partir de uma data (hoje, retroativa ou programada). */
export async function changeClientStatusAction(input: {
  clientId: string;
  status: string;
  effectiveFrom: string;
  reason?: string | null;
  renewalCompetence?: string | null;
}): Promise<ActionResult & { programada?: boolean; aviso?: string }> {
  const { viewer, caps } = await capacidades();
  if (!viewer) return NO_PERMISSION;
  try {
    const p = ChangeSchema.parse(input);
    const r = await changeClientStatus(
      {
        clientId: p.clientId,
        status: p.status,
        effectiveFrom: p.effectiveFrom,
        reason: p.reason ?? null,
        renewalCompetence: p.renewalCompetence ?? null,
        actor: { id: viewer.id, email: viewer.email },
      },
      caps
    );
    revalidateClientStatus(p.clientId);
    return { ok: true, programada: r.programada, ...(r.aviso ? { aviso: r.aviso } : {}) };
  } catch (e: any) {
    return erro(e, "Falha ao alterar o status.");
  }
}

/** Cancela uma alteração programada (antes de ela começar a valer). */
export async function cancelScheduledStatusChangeAction(input: {
  clientId: string;
  effectiveFrom: string;
  reason?: string | null;
}): Promise<ActionResult> {
  const { viewer, caps } = await capacidades();
  if (!viewer) return NO_PERMISSION;
  try {
    if (!isDateKey(input.effectiveFrom)) return { ok: false, error: "Data inválida." };
    await cancelScheduledStatusChange(
      {
        clientId: input.clientId,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason ?? null,
        actor: { id: viewer.id, email: viewer.email },
      },
      caps
    );
    revalidateClientStatus(input.clientId);
    return { ok: true };
  } catch (e: any) {
    return erro(e, "Falha ao cancelar a alteração programada.");
  }
}

/**
 * Status em massa com a MESMA vigência para todos. Cliente a cliente (cada
 * um na sua transação): um cliente com competência fechada não derruba os
 * outros — o resultado diz quantos mudaram e por que os demais não.
 */
export async function bulkChangeClientStatusAction(input: {
  ids: string[];
  status: string;
  effectiveFrom: string;
  reason?: string | null;
}): Promise<ActionResult & { alterados?: number; falhas?: { id: string; error: string }[] }> {
  const { viewer, caps } = await capacidades();
  if (!viewer) return NO_PERMISSION;
  try {
    const ids = z.array(z.string().min(1)).min(1, "Selecione ao menos um cliente.").max(500).parse(input.ids);
    const status = z.nativeEnum(ClientStatus).parse(input.status);
    if (!isDateKey(input.effectiveFrom)) return { ok: false, error: "Informe o início da vigência." };
    let alterados = 0;
    const falhas: { id: string; error: string }[] = [];
    for (const id of Array.from(new Set(ids))) {
      try {
        await changeClientStatus(
          {
            clientId: id,
            status,
            effectiveFrom: input.effectiveFrom,
            reason: input.reason ?? null,
            actor: { id: viewer.id, email: viewer.email },
          },
          caps
        );
        alterados++;
      } catch (e: any) {
        falhas.push({ id, error: e?.message ?? "Falha." });
        // Sem permissão vale para todos: não adianta insistir cliente a cliente.
        if (e instanceof StatusChangeError && ["SEM_PERMISSAO", "RETROATIVO", "PROGRAMAR"].includes(e.code)) {
          return { ok: false, error: e.message };
        }
      }
    }
    revalidateClientStatus();
    if (alterados === 0) return { ok: false, error: falhas[0]?.error ?? "Nenhum cliente foi alterado." };
    return { ok: true, alterados, falhas };
  } catch (e: any) {
    return erro(e, "Falha ao alterar o status em massa.");
  }
}

/**
 * Reserva do job diário: aplica AGORA as alterações programadas que já
 * começaram a valer (só as do dono logado). Idempotente.
 */
export async function applyDueScheduledStatusAction(): Promise<ActionResult & { atualizados?: number }> {
  const { viewer } = await capacidades();
  if (!viewer) return NO_PERMISSION;
  try {
    const { resolveOwnerId } = await import("@/lib/auth/owner-scope");
    const ownerId = await resolveOwnerId();
    const r = await materializarStatusProgramados(undefined, ownerId ?? null);
    revalidateClientStatus();
    if (r.falhas.length) return { ok: false, error: r.falhas[0].erro };
    return { ok: true, atualizados: r.atualizados };
  } catch (e: any) {
    return erro(e, "Falha ao aplicar as alterações programadas.");
  }
}
