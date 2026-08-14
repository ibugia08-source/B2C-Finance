"use server";
import { prisma } from "@/lib/prisma";
import { revalidateAgency } from "@/lib/revalidate";
import { z } from "zod";
import { ContractStatus, ContractType, RecurrenceType } from "@prisma/client";
import { requirePermission } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, clean } from "@/lib/format";
import {
  generateBillingsForContract,
  generateBillingsForAllActive,
} from "@/lib/services/contract-metrics";
import type { ActionResult } from "./clients";

const money = (v: FormDataEntryValue | null): number => parseBRL(String(v ?? "0"));
const date = (v: FormDataEntryValue | null): Date | null => {
  const raw = clean(v);
  return raw == null ? null : parseDateBR(raw);
};

/** Meses de vigência (inclusivo por mês). */
function countMonths(start: Date, end: Date): number {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) +
    1
  );
}

const ContractSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1, "Selecione o cliente."),
  title: z.string().trim().min(1, "Informe o título do contrato."),
  type: z.nativeEnum(ContractType),
  status: z.nativeEnum(ContractStatus),
  recurrence: z.nativeEnum(RecurrenceType),
  monthlyValue: z.number().nonnegative(),
  totalValue: z.number().nonnegative(),
  setupFee: z.number().nonnegative().nullable(),
  startDate: z.date({ invalid_type_error: "Informe a data de início." }),
  endDate: z.date().nullable(),
  renewalDate: z.date().nullable(),
  billingDay: z.number().int().min(1, "Dia entre 1 e 31.").max(31, "Dia entre 1 e 31."),
  autoRenew: z.boolean().default(false),
  notes: z.string().trim().nullable(),
  services: z
    .array(z.object({ serviceId: z.string(), unitPrice: z.number().nonnegative() }))
    .default([]),
});

export async function saveContract(formData: FormData): Promise<ActionResult> {
  await requirePermission("contratos.editar");
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

    const parsed = ContractSchema.parse({
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
    });

    if (parsed.endDate && parsed.endDate < parsed.startDate) {
      return { ok: false, error: "Data de fim anterior ao início." };
    }

    // ===== Modalidade define a forma do dinheiro =====
    // TCV = valor CHEIO único: sem recorrência, sem mensal derivado, sem rateio.
    //       A cobrança entra uma única vez no mês da venda/renovação.
    // MRR = mensal recorrente: deriva total⇄mensal pelo prazo quando faltar um
    //       (ex.: R$ 5.100 / 3 meses → 1.700/mês).
    let { monthlyValue, totalValue } = parsed;
    let recurrence = parsed.recurrence;
    if (parsed.type === "TCV") {
      recurrence = "NONE"; // trava anti-rateio: TCV nunca gera cobrança mensal
      monthlyValue = 0; // TCV não tem mensalidade recorrente
    } else if (parsed.endDate) {
      const months = countMonths(parsed.startDate, parsed.endDate);
      if (totalValue === 0 && monthlyValue > 0) totalValue = monthlyValue * months;
      else if (monthlyValue === 0 && totalValue > 0)
        monthlyValue = Number((totalValue / months).toFixed(2));
    } else if (totalValue === 0 && monthlyValue > 0) {
      totalValue = monthlyValue * 12; // MRR sem fim: total anualizado de referência
    }

    // Cliente pertence ao dono atual? (findFirst é escopado)
    const owned = await prisma.client.findFirst({
      where: { id: parsed.clientId },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    const data = {
      clientId: parsed.clientId,
      title: parsed.title,
      type: parsed.type,
      status: parsed.status,
      recurrence,
      monthlyValue,
      totalValue,
      setupFee: parsed.setupFee,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      renewalDate: parsed.renewalDate,
      billingDay: parsed.billingDay,
      autoRenew: parsed.autoRenew,
      notes: parsed.notes,
    };

    let contractId = parsed.id;
    if (contractId) {
      const existing = await prisma.contract.findUnique({ where: { id: contractId } });
      if (!existing) return { ok: false, error: "Contrato não encontrado." };
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          ...data,
          canceledAt:
            parsed.status === "CANCELED" ? existing.canceledAt ?? new Date() : null,
        },
      });
      await prisma.contractService.deleteMany({ where: { contractId } });
    } else {
      const created = await prisma.contract.create({ data });
      contractId = created.id;
    }
    if (parsed.services.length > 0) {
      await prisma.contractService.createMany({
        data: parsed.services.map((s) => ({
          contractId: contractId!,
          serviceId: s.serviceId,
          unitPrice: s.unitPrice,
        })),
      });
    }

    revalidateContracts(parsed.clientId);
    return { ok: true, id: contractId };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o contrato.",
    };
  }
}

/** Encerra o contrato (fim natural da vigência). */
export async function endContract(id: string): Promise<ActionResult> {
  await requirePermission("contratos.editar");
  try {
    const c = await prisma.contract.findUnique({ where: { id } });
    if (!c) return { ok: false, error: "Contrato não encontrado." };
    await prisma.contract.update({
      where: { id },
      data: { status: "ENDED", endDate: c.endDate ?? new Date() },
    });
    revalidateContracts(c.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao encerrar o contrato." };
  }
}

/** Cancela o contrato (interrupção antes do fim). */
export async function cancelContract(id: string): Promise<ActionResult> {
  await requirePermission("contratos.editar");
  try {
    const c = await prisma.contract.findUnique({ where: { id } });
    if (!c) return { ok: false, error: "Contrato não encontrado." };
    await prisma.contract.update({
      where: { id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
    revalidateContracts(c.clientId);
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
