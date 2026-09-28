"use server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/viewer";
import { revalidateAgency, revalidateFinance } from "@/lib/revalidate";
import type { ActionResult } from "./clients";
import { renovarCliente } from "@/lib/engines/renewal-engine";
import { domainContextFor } from "@/lib/auth/domain-session";
import {
  currentYearMonth, expectationInMonth, monthIndex, parseCompetenceKey,
} from "@/lib/renewal-expectation";

/** Fluxo completo de renovação — ver engines/renewal-engine.ts (renovarCliente). */
export async function renewClientFlow(
  formData: FormData
): Promise<ActionResult & { renewalId?: string }> {
  const viewer = await requirePermission("contratos.editar");
  try {
    // Formulário → entrada; o fluxo inteiro está em engines/renewal-engine
    // (o mesmo que a API vai usar).
    const campo = (k: string) => {
      const v = formData.get(k);
      return v == null ? null : String(v);
    };
    const r = await renovarCliente(await domainContextFor(viewer), {
      clientId: campo("clientId"),
      competence: campo("competence"),
      contractId: campo("contractId"),
      details: campo("details"),
      forCompetence: campo("forCompetence"),
      launch: campo("launch"),
      modality: campo("modality"),
      monthlyValue: campo("monthlyValue"),
      months: campo("months"),
      paidAmount: campo("paidAmount"),
      payStatus: campo("payStatus"),
      paymentDay: campo("paymentDay"),
      paymentMethod: campo("paymentMethod"),
      totalValue: campo("totalValue"),
    });
    if (!r.ok) return r;
    revalidateAgency({ clientId: r.clientId, contractId: r.contractId ?? null });
    revalidateFinance();
    return { ok: true, id: r.id, renewalId: r.renewalId, ...(r.warning ? { warning: r.warning } : {}) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao renovar o contrato." };
  }
}

/**
 * Agenda (ou reagenda) manualmente a EXPECTATIVA de renovação de um cliente
 * para um mês — o "Agendar renovação" da Gestão do Mês e do módulo
 * Renovações. Grava Client.expectedRenewalAt no mês escolhido, no dia do
 * ciclo do cliente (dia da entrada).
 */
export async function scheduleClientRenewal(
  clientId: string,
  competence: string
): Promise<ActionResult> {
  await requirePermission("clientes.editar");
  try {
    const ym = parseCompetenceKey(competence);
    if (!ym) return { ok: false, error: "Mês inválido." };
    // Sem agendar no passado distante: o módulo mostra o mês corrente e os
    // próximos; mês anterior ainda é permitido (renovação atrasada).
    if (monthIndex(ym) < monthIndex(currentYearMonth()) - 1)
      return { ok: false, error: "Escolha o mês atual ou um mês futuro." };
    const client = await prisma.client.findFirst({
      where: { id: clientId },
      select: { id: true, startedAt: true },
    });
    if (!client) return { ok: false, error: "Cliente não encontrado." };
    await prisma.client.update({
      where: { id: clientId },
      data: { expectedRenewalAt: expectationInMonth(ym, client.startedAt) },
    });
    revalidateAgency({ clientId });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao agendar a renovação." };
  }
}
