"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AssetType, LiabilityType } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR } from "@/lib/format";
import type { ActionResult } from "./clients";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}
const money = (v: FormDataEntryValue | null) => parseBRL(String(v ?? "0"));
const moneyOrNull = (v: FormDataEntryValue | null) => {
  const raw = clean(v);
  return raw == null ? null : parseBRL(raw);
};

function revalidateBalance() {
  revalidatePath("/ativos");
  revalidatePath("/passivos");
  revalidatePath("/dashboard");
}

// ---------- Ativos ----------

const AssetSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Informe o nome do ativo."),
  type: z.nativeEnum(AssetType),
  value: z.number().nonnegative(),
  acquiredAt: z.date().nullable(),
  notes: z.string().trim().nullable(),
});

export async function saveAsset(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = AssetSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      name: String(formData.get("name") ?? "").trim(),
      type: (clean(formData.get("type")) ?? "OTHER") as AssetType,
      value: money(formData.get("value")),
      acquiredAt: (() => {
        const raw = clean(formData.get("acquiredAt"));
        return raw == null ? null : parseDateBR(raw);
      })(),
      notes: clean(formData.get("notes")),
    });
    const { id, ...data } = parsed;
    if (id) {
      const existing = await prisma.asset.findUnique({ where: { id } });
      if (!existing) return { ok: false, error: "Ativo não encontrado." };
      await prisma.asset.update({ where: { id }, data });
    } else {
      await prisma.asset.create({ data });
    }
    revalidateBalance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o ativo." };
  }
}

export async function deleteAsset(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await prisma.asset.deleteMany({ where: { id } });
    revalidateBalance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o ativo." };
  }
}

// ---------- Passivos ----------

const LiabilitySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Informe o nome do passivo."),
  type: z.nativeEnum(LiabilityType),
  totalValue: z.number().nonnegative(),
  remainingValue: z.number().nonnegative(),
  dueDate: z.date().nullable(),
  installments: z.number().int().positive().nullable(),
  monthlyPayment: z.number().nonnegative().nullable(),
  notes: z.string().trim().nullable(),
});

export async function saveLiability(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const totalValue = money(formData.get("totalValue"));
    const remainingRaw = moneyOrNull(formData.get("remainingValue"));
    const parsed = LiabilitySchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      name: String(formData.get("name") ?? "").trim(),
      type: (clean(formData.get("type")) ?? "OTHER") as LiabilityType,
      totalValue,
      remainingValue: remainingRaw ?? totalValue, // padrão: tudo em aberto
      dueDate: (() => {
        const raw = clean(formData.get("dueDate"));
        return raw == null ? null : parseDateBR(raw);
      })(),
      installments: (() => {
        const raw = clean(formData.get("installments"));
        return raw == null ? null : parseInt(raw, 10);
      })(),
      monthlyPayment: moneyOrNull(formData.get("monthlyPayment")),
      notes: clean(formData.get("notes")),
    });
    const { id, ...data } = parsed;
    if (id) {
      const existing = await prisma.liability.findUnique({ where: { id } });
      if (!existing) return { ok: false, error: "Passivo não encontrado." };
      await prisma.liability.update({ where: { id }, data });
    } else {
      await prisma.liability.create({ data });
    }
    revalidateBalance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o passivo." };
  }
}

export async function deleteLiability(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    await prisma.loan.updateMany({ where: { liabilityId: id }, data: { liabilityId: null } });
    await prisma.liability.deleteMany({ where: { id } });
    revalidateBalance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o passivo." };
  }
}

/** Registra amortização: reduz o saldo devedor do passivo. */
export async function amortizeLiability(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const amount = money(formData.get("amount"));
    if (amount <= 0) return { ok: false, error: "Informe o valor amortizado." };
    const l = await prisma.liability.findUnique({ where: { id } });
    if (!l) return { ok: false, error: "Passivo não encontrado." };
    await prisma.liability.update({
      where: { id },
      data: { remainingValue: Math.max(0, Number(l.remainingValue) - amount) },
    });
    revalidateBalance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao amortizar." };
  }
}

// ---------- Empréstimos ----------

const LoanSchema = z.object({
  id: z.string().optional(),
  lender: z.string().trim().min(1, "Informe o credor."),
  principal: z.number().positive("Valor deve ser maior que zero."),
  interestRate: z.number().min(0).max(1).nullable(), // 0-1 (mensal)
  installments: z.number().int().positive(),
  installmentValue: z.number().nonnegative().nullable(),
  remainingValue: z.number().nonnegative().nullable(),
  firstDueDate: z.date().nullable(),
  notes: z.string().trim().nullable(),
});

export async function saveLoan(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = LoanSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      lender: String(formData.get("lender") ?? "").trim(),
      principal: money(formData.get("principal")),
      interestRate: (() => {
        const raw = clean(formData.get("interestRate"));
        if (raw == null) return null;
        const pct = parseBRL(raw); // usuário digita % a.m. (ex.: 2,5)
        return pct / 100;
      })(),
      installments: parseInt(String(formData.get("installments") ?? "1"), 10) || 1,
      installmentValue: moneyOrNull(formData.get("installmentValue")),
      remainingValue: moneyOrNull(formData.get("remainingValue")),
      firstDueDate: (() => {
        const raw = clean(formData.get("firstDueDate"));
        return raw == null ? null : parseDateBR(raw);
      })(),
      notes: clean(formData.get("notes")),
    });

    const { id, ...data } = parsed;
    const remaining = data.remainingValue ?? data.principal;

    let loanId = id;
    if (loanId) {
      const existing = await prisma.loan.findUnique({ where: { id: loanId } });
      if (!existing) return { ok: false, error: "Empréstimo não encontrado." };
      await prisma.loan.update({
        where: { id: loanId },
        data: { ...data, remainingValue: remaining },
      });
      // Sincroniza o passivo vinculado
      if (existing.liabilityId) {
        await prisma.liability.update({
          where: { id: existing.liabilityId },
          data: {
            name: `Empréstimo — ${data.lender}`,
            totalValue: data.principal,
            remainingValue: remaining,
            installments: data.installments,
            monthlyPayment: data.installmentValue,
          },
        });
      }
    } else {
      // Todo empréstimo nasce como passivo (aparece no balanço).
      const liability = await prisma.liability.create({
        data: {
          name: `Empréstimo — ${data.lender}`,
          type: "LOAN",
          totalValue: data.principal,
          remainingValue: remaining,
          installments: data.installments,
          monthlyPayment: data.installmentValue,
          dueDate: data.firstDueDate,
        },
      });
      const created = await prisma.loan.create({
        data: { ...data, remainingValue: remaining, liabilityId: liability.id },
      });
      loanId = created.id;
    }

    revalidateBalance();
    return { ok: true, id: loanId };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o empréstimo." };
  }
}

export async function deleteLoan(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return { ok: false, error: "Empréstimo não encontrado." };
    await prisma.loan.deleteMany({ where: { id } });
    if (loan.liabilityId) {
      await prisma.liability.deleteMany({ where: { id: loan.liabilityId } });
    }
    revalidateBalance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o empréstimo." };
  }
}
