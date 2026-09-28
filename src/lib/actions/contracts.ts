"use server";
import { prisma } from "@/lib/prisma";
import { revalidateAgency } from "@/lib/revalidate";
import { ContractStatus, ContractType, RecurrenceType } from "@prisma/client";
import { requirePermission } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, clean } from "@/lib/format";
import {
  generateBillingsForContract,
  generateBillingsForAllActive,
} from "@/lib/services/contract-metrics";
import type { ActionResult } from "./clients";
import {
  cancelarContrato, encerrarContrato, salvarContrato, type ContractInput,
} from "@/lib/services/contract-service";
import { domainContextFor } from "@/lib/auth/domain-session";

const money = (v: FormDataEntryValue | null): number => parseBRL(String(v ?? "0"));
const date = (v: FormDataEntryValue | null): Date | null => {
  const raw = clean(v);
  return raw == null ? null : parseDateBR(raw);
};

export async function saveContract(formData: FormData): Promise<ActionResult> {
  const viewer = await requirePermission("contratos.editar");
  try {
    // Serviços selecionados: inputs services=<id> + price_<id>=valor
    const services = formData
      .getAll("services")
      .map(String)
      .filter(Boolean)
      .map((serviceId) => ({
        serviceId,
        unitPrice: parseBRL(String(formData.get(`price_${serviceId}`) ?? "0")),
      }));

    // Formulário → entrada tipada; regra em services/contract-service.
    const input: ContractInput = {
      id: clean(formData.get("id")) ?? undefined,
      clientId: String(formData.get("clientId") ?? ""),
      title: String(formData.get("title") ?? "").trim(),
      type: (clean(formData.get("type")) ?? "MRR") as ContractType,
      status: (clean(formData.get("status")) ?? "ACTIVE") as ContractStatus,
      recurrence: (clean(formData.get("recurrence")) ?? "MONTHLY") as RecurrenceType,
      monthlyValue: money(formData.get("monthlyValue")),
      totalValue: money(formData.get("totalValue")),
      setupFee: (() => {
        const raw = clean(formData.get("setupFee"));
        return raw == null ? null : parseBRL(raw);
      })(),
      startDate: date(formData.get("startDate")) ?? (undefined as any),
      endDate: date(formData.get("endDate")),
      renewalDate: date(formData.get("renewalDate")),
      billingDay: parseInt(String(formData.get("billingDay") ?? "5"), 10) || 5,
      autoRenew: formData.get("autoRenew") === "on",
      notes: clean(formData.get("notes")),
      services,
    };
    const r = await salvarContrato(await domainContextFor(viewer), input);
    if (!r.ok) return r;
    revalidateContracts(r.clientId!);
    return { ok: true, id: r.id };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o contrato.",
    };
  }
}

/** Encerra o contrato (fim natural da vigência). */
export async function endContract(id: string): Promise<ActionResult> {
  const viewer = await requirePermission("contratos.editar");
  try {
    const r = await encerrarContrato(await domainContextFor(viewer), id);
    if (!r.ok) return r;
    revalidateContracts(r.clientId!);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao encerrar o contrato." };
  }
}

/** Cancela o contrato (interrupção antes do fim). */
export async function cancelContract(id: string): Promise<ActionResult> {
  const viewer = await requirePermission("contratos.editar");
  try {
    const r = await cancelarContrato(await domainContextFor(viewer), id);
    if (!r.ok) return r;
    revalidateContracts(r.clientId!);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao cancelar o contrato." };
  }
}

// A renovação de contrato vive SOMENTE em src/lib/actions/renewals.ts
// (renewClientFlow) — fluxo completo com modalidade, lançamento em
// competência escolhida e histórico em ClientRenewal. O renewContract
// legado (estendia sem registrar ClientRenewal nem atualizar o cadastro)
// foi removido na auditoria de 2026-08-13; recuperável no git se preciso.

export async function deleteContract(id: string): Promise<ActionResult> {
  await requirePermission("contratos.excluir");
  try {
    const billings = await prisma.billing.count({ where: { contractId: id } });
    if (billings > 0) {
      return {
        ok: false,
        error: `Contrato tem ${billings} cobrança(s). Encerre ou cancele em vez de excluir.`,
      };
    }
    const c = await prisma.contract.findUnique({ where: { id } });
    if (!c) return { ok: false, error: "Contrato não encontrado." };
    await prisma.contractService.deleteMany({ where: { contractId: id } });
    await prisma.contract.deleteMany({ where: { id } });
    revalidateContracts(c.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o contrato." };
  }
}

/** Gera as cobranças pendentes de UM contrato. */
export async function generateContractBillings(id: string): Promise<ActionResult & { created?: number }> {
  await requirePermission("recebimentos.gerar_cobranca");
  try {
    const r = await generateBillingsForContract(id);
    revalidateContracts();
    return { ok: true, created: r.created };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao gerar cobranças." };
  }
}

/** Gera as cobranças do mês para todos os contratos vigentes. */
export async function generateAllBillings(): Promise<ActionResult & { created?: number }> {
  await requirePermission("recebimentos.gerar_cobranca");
  try {
    const r = await generateBillingsForAllActive();
    revalidateContracts();
    return { ok: true, created: r.created };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao gerar cobranças." };
  }
}

function revalidateContracts(clientId?: string) {
  revalidateAgency({ clientId });
}
