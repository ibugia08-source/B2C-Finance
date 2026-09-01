"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/viewer";
import {
  criarOportunidade, moverEtapa, type EntradaDeOportunidade,
} from "@/lib/services/pipeline";
import { converterLead, criarLead, type EntradaDeLead } from "@/lib/services/leads";
import type { EtapaDoFunil } from "@/lib/commercial/funil";

/**
 * Ações do funil (F4.2).
 *
 * Marcar GANHA exige permissão própria (`comercial.registrar_venda`): é o
 * gesto que fecha receita e, na F4.4, dispara a criação de cliente, contrato
 * e cobranças. Mover entre as outras etapas é operação de rotina.
 */

export async function moverEtapaAction(
  opportunityId: string,
  para: EtapaDoFunil,
  motivo?: string
) {
  await requirePermission(para === "GANHA" ? "comercial.registrar_venda" : "comercial.operar");
  const r = await moverEtapa(opportunityId, para, { motivo });
  revalidar();
  return r;
}

export async function criarOportunidadeAction(input: EntradaDeOportunidade) {
  await requirePermission("comercial.operar");
  const r = await criarOportunidade(input);
  revalidar();
  return r;
}

export async function criarLeadAction(input: EntradaDeLead) {
  await requirePermission("comercial.operar");
  const r = await criarLead(input);
  revalidar();
  return r.ok ? { ok: true as const, id: r.lead.id } : r;
}

export async function converterLeadAction(leadId: string, clientIdEscolhido?: string | null) {
  await requirePermission("comercial.registrar_venda");
  const r = await converterLead(leadId, { clientIdEscolhido });
  revalidar();
  revalidatePath("/clientes");
  return r;
}

function revalidar() {
  revalidatePath("/funil");
  revalidatePath("/funil/leads");
  revalidatePath("/dashboard");
}
