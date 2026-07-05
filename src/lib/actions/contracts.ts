"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ContractStatus, ContractType, RecurrenceType } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, formatBRL } from "@/lib/format";
import {
  generateBillingsForContract,
  generateBillingsForAllActive,
} from "@/lib/services/contract-metrics";
import type { ActionResult } from "./clients";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}
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
  planId: z.string().nullable(),
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
  billingDay: z.number().int().min(1, "Dia entre 1 e 28.").max(28, "Dia entre 1 e 28."),
  autoRenew: z.boolean().default(false),
  notes: z.string().trim().nullable(),
  services: z
    .array(z.object({ serviceId: z.string(), unitPrice: z.number().nonnegative() }))
    .default([]),
});

export async function saveContract(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
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
      planId: clean(formData.get("planId")),
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

    // ===== Derivação MRR ⇄ TCV (ex.: R$ 5.100 / 3 meses → 1.700/mês) =====
    let { monthlyValue, totalValue } = parsed;
    if (parsed.endDate) {
      const months = countMonths(parsed.startDate, parsed.endDate);
      if (totalValue === 0 && monthlyValue > 0) totalValue = monthlyValue * months;
      else if (monthlyValue === 0 && totalValue > 0)
        monthlyValue = Number((totalValue / months).toFixed(2));
    } else if (totalValue === 0 && monthlyValue > 0) {
      totalValue = monthlyValue * 12; // TCV anualizado p/ contrato sem fim
    }

    // Cliente pertence ao dono atual? (findFirst é escopado)
    const owned = await prisma.client.findFirst({
      where: { id: parsed.clientId },
      select: { id: true },
    });
    if (!owned) return { ok: false, error: "Cliente não encontrado." };

    const data = {
      clientId: parsed.clientId,
      planId: parsed.planId,
      title: parsed.title,
      type: parsed.type,
      status: parsed.status,
      recurrence: parsed.recurrence,
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
  await requireAdmin();
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
  await requireAdmin();
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

/**
 * Renova o contrato por N meses:
 * estende endDate/renewalDate a partir do maior entre hoje e o fim atual,
 * soma o novo período ao TCV e reativa o contrato.
 */
export async function renewContract(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const months = Math.max(1, parseInt(String(formData.get("months") ?? "12"), 10) || 12);
    const c = await prisma.contract.findUnique({ where: { id } });
    if (!c) return { ok: false, error: "Contrato não encontrado." };

    const base = c.endDate && c.endDate > new Date() ? c.endDate : new Date();
    const newEnd = new Date(base);
    newEnd.setMonth(newEnd.getMonth() + months);

    await prisma.contract.update({
      where: { id },
      data: {
        status: "ACTIVE",
        endDate: c.endDate ? newEnd : null, // contrato sem fim continua sem fim
        renewalDate: newEnd,
        totalValue: Number(c.totalValue) + Number(c.monthlyValue) * months,
        canceledAt: null,
      },
    });
    revalidateContracts(c.clientId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao renovar o contrato." };
  }
}

/**
 * Renovação pela CARTEIRA (lista de clientes): estende o contrato com o novo
 * ciclo (prazo, valor, forma e modalidade de pagamento) e lança o efeito
 * financeiro — TCV paga o valor cheio de novo no mês da renovação; MRR segue
 * gerando as cobranças mensais do novo período. Cliente volta a ATIVO.
 */
export async function renewClientContract(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const id = String(formData.get("contractId") ?? "");
    const months = Math.max(1, parseInt(String(formData.get("months") ?? "12"), 10) || 12);
    const totalRaw = String(formData.get("totalValue") ?? "").trim();
    const paymentMethod = String(formData.get("paymentMethod") ?? "").trim() || null;
    const paymentMode = String(formData.get("paymentMode") ?? "").trim() || null;
    const details = String(formData.get("details") ?? "").trim() || null;

    const c = await prisma.contract.findUnique({ where: { id } });
    if (!c) return { ok: false, error: "Contrato não encontrado." };

    const total = totalRaw ? parseBRL(totalRaw) : Number(c.totalValue) || Number(c.monthlyValue) * months;
    if (!(total > 0)) return { ok: false, error: "Informe o valor do novo ciclo." };

    const today = new Date();
    const base = c.endDate && c.endDate > today ? c.endDate : today;
    const newEnd = new Date(base);
    newEnd.setMonth(newEnd.getMonth() + months);
    const monthly = c.type === "MRR" ? Math.round((total / months) * 100) / 100 : Number(c.monthlyValue);

    const renewNote = `Renovado em ${today.toLocaleDateString("pt-BR")}: ${months} mês(es), ${formatBRL(total)}` +
      (paymentMethod ? `, ${paymentMethod}` : "") + (paymentMode ? ` (${paymentMode})` : "") +
      (details ? ` — ${details}` : "");

    await prisma.contract.update({
      where: { id },
      data: {
        status: "ACTIVE",
        endDate: newEnd,
        renewalDate: newEnd,
        totalValue: Number(c.totalValue) + total,
        monthlyValue: monthly,
        paymentMethod,
        paymentMode,
        canceledAt: null,
        notes: [c.notes, renewNote].filter(Boolean).join("\n"),
      },
    });

    if (c.type === "TCV" || c.recurrence === "NONE") {
      // TCV renovado paga o valor CHEIO de novo no mês da renovação
      const due = new Date(today.getFullYear(), today.getMonth(), Math.min(c.billingDay, 28));
      if (due < today) due.setMonth(due.getMonth() + 1);
      await prisma.billing.create({
        data: {
          clientId: c.clientId,
          contractId: c.id,
          description: `${c.title} — renovação ${String(due.getMonth() + 1).padStart(2, "0")}/${due.getFullYear()}`,
          competenceMonth: due.getMonth() + 1,
          competenceYear: due.getFullYear(),
          amount: total,
          dueDate: due,
          revenueType: "TCV",
          status: "PENDING",
        },
      });
    } else {
      // MRR: gera as cobranças mensais do novo período (idempotente)
      await generateBillingsForContract(c.id);
    }

    // cliente marcado como renovado (volta a ATIVO)
    await prisma.client.update({
      where: { id: c.clientId },
      data: { status: "ACTIVE", churnedAt: null },
    });

    revalidateContracts(c.clientId);
    revalidatePath("/clientes");
    revalidatePath("/cobrancas");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao renovar o contrato." };
  }
}

export async function deleteContract(id: string): Promise<ActionResult> {
  await requireAdmin();
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
  await requireAdmin();
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
  await requireAdmin();
  try {
    const r = await generateBillingsForAllActive();
    revalidateContracts();
    return { ok: true, created: r.created };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao gerar cobranças." };
  }
}

function revalidateContracts(clientId?: string) {
  revalidatePath("/contratos");
  revalidatePath("/clientes");
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/dashboard");
}
