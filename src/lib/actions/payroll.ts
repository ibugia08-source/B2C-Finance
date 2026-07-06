"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EmployeeType, PayrollItemKind, PayrollStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/auth/viewer";
import { parseBRL, parseDateBR, parseMonthParam } from "@/lib/format";
import type { ActionResult } from "./clients";

function clean(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}
const n = (v: unknown): number => (v == null ? 0 : Number(v));

function revalidatePayroll() {
  revalidatePath("/folha");
  revalidatePath("/despesas");
  revalidatePath("/dashboard");
}

// ---------- Colaboradores ----------

const EmployeeSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Informe o nome."),
  role: z.string().trim().nullable(),
  type: z.nativeEnum(EmployeeType),
  baseSalary: z.number().nonnegative(),
  startedAt: z.date().nullable(),
  active: z.boolean().default(true),
  notes: z.string().trim().nullable(),
});

export async function saveEmployee(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = EmployeeSchema.parse({
      id: clean(formData.get("id")) ?? undefined,
      name: String(formData.get("name") ?? "").trim(),
      role: clean(formData.get("role")),
      type: (clean(formData.get("type")) ?? "PJ") as EmployeeType,
      baseSalary: parseBRL(String(formData.get("baseSalary") ?? "0")),
      startedAt: (() => {
        const raw = clean(formData.get("startedAt"));
        return raw == null ? null : parseDateBR(raw);
      })(),
      active: formData.get("active") !== "false",
      notes: clean(formData.get("notes")),
    });
    const { id, ...data } = parsed;
    if (id) {
      const existing = await prisma.employee.findUnique({ where: { id } });
      if (!existing) return { ok: false, error: "Colaborador não encontrado." };
      await prisma.employee.update({
        where: { id },
        data: { ...data, endedAt: parsed.active ? null : existing.endedAt ?? new Date() },
      });
    } else {
      await prisma.employee.create({ data });
    }
    revalidatePayroll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao salvar o colaborador." };
  }
}

export async function deleteEmployee(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const inUse = await prisma.payrollItem.count({ where: { employeeId: id } });
    if (inUse > 0) {
      return {
        ok: false,
        error: "Colaborador tem itens de folha. Desative-o em vez de excluir.",
      };
    }
    await prisma.employee.deleteMany({ where: { id } });
    revalidatePayroll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o colaborador." };
  }
}

// ---------- Folha (run mensal) ----------

/**
 * Garante a folha do mês: cria em DRAFT com um item SALARY por colaborador
 * ativo (idempotente — não duplica itens existentes).
 */
export async function ensurePayroll(
  month: number,
  year: number
): Promise<ActionResult & { runId?: string }> {
  await requireAdmin();
  try {
    let run = await prisma.payroll.findFirst({ where: { month, year } });
    if (!run) {
      run = await prisma.payroll.create({ data: { month, year } });
    }
    if (run.status === "DRAFT") {
      const [employees, existing] = await Promise.all([
        prisma.employee.findMany({ where: { active: true } }),
        prisma.payrollItem.findMany({
          where: { payrollId: run.id, kind: "SALARY" },
          select: { employeeId: true },
        }),
      ]);
      const has = new Set(existing.map((e) => e.employeeId));
      const toCreate = employees
        .filter((e) => !has.has(e.id) && n(e.baseSalary) > 0)
        .map((e) => ({
          payrollId: run!.id,
          employeeId: e.id,
          kind: "SALARY" as PayrollItemKind,
          amount: e.baseSalary,
          notes: "Salário base",
        }));
      if (toCreate.length > 0) {
        await prisma.payrollItem.createMany({ data: toCreate });
      }
    }

    // Comissões PENDENTES da competência entram na folha automaticamente.
    // A transição PENDING → APPROVED garante que nunca entram duas vezes.
    if (run.status !== "PAID") {
      const pending = await prisma.commission.findMany({
        where: { month, year, status: "PENDING" },
        include: { client: { select: { name: true } } },
      });
      for (const c of pending) {
        await prisma.$transaction([
          prisma.payrollItem.create({
            data: {
              payrollId: run.id,
              employeeId: c.employeeId,
              kind: "COMMISSION",
              amount: c.amount,
              notes:
                [c.client?.name ? `Comissão — ${c.client.name}` : "Comissão", c.notes]
                  .filter(Boolean)
                  .join(" · "),
            },
          }),
          prisma.commission.update({
            where: { id: c.id },
            data: { status: "APPROVED" },
          }),
        ]);
      }
    }
    revalidatePayroll();
    return { ok: true, runId: run.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao gerar a folha." };
  }
}

// ---------- Comissões ----------

const CommissionSchema = z.object({
  employeeId: z.string().min(1, "Selecione o colaborador."),
  amount: z.number().positive("Valor deve ser maior que zero."),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  clientId: z.string().nullable(),
  basisAmount: z.number().nullable(),
  rate: z.number().nullable(), // fração 0–1
  notes: z.string().trim().nullable(),
});

/**
 * Registra uma comissão atribuída a um colaborador na competência.
 * Valor direto OU base × percentual (o valor é derivado quando não informado).
 * Entra na folha automaticamente ao gerar/atualizar a folha do mês.
 */
export async function saveCommission(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const comp = parseMonthParam(String(formData.get("competencia") ?? "")); // "YYYY-MM"
    if (!comp) return { ok: false, error: "Competência inválida — confira o mês/ano." };
    const { year: y, month: m } = comp;
    const basis = clean(formData.get("basisAmount"));
    const ratePct = clean(formData.get("rate")); // % (ex.: "10")
    const amountRaw = clean(formData.get("amount"));

    const basisAmount = basis ? parseBRL(basis) : null;
    const rate = ratePct ? parseBRL(ratePct) / 100 : null;
    const amount =
      amountRaw != null
        ? parseBRL(amountRaw)
        : basisAmount != null && rate != null
          ? Math.round(basisAmount * rate * 100) / 100
          : 0;

    const parsed = CommissionSchema.parse({
      employeeId: String(formData.get("employeeId") ?? ""),
      amount,
      month: m,
      year: y,
      clientId: clean(formData.get("clientId")),
      basisAmount,
      rate,
      notes: clean(formData.get("notes")),
    });
    await prisma.commission.create({ data: parsed });
    revalidatePayroll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao registrar a comissão." };
  }
}

/** Exclui comissão ainda não incluída na folha (PENDING). */
export async function deleteCommission(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const c = await prisma.commission.findUnique({ where: { id } });
    if (!c) return { ok: false, error: "Comissão não encontrada." };
    if (c.status !== "PENDING")
      return {
        ok: false,
        error: "Comissão já incluída na folha — remova o item da folha correspondente.",
      };
    await prisma.commission.deleteMany({ where: { id } });
    revalidatePayroll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir a comissão." };
  }
}

const ItemSchema = z.object({
  payrollId: z.string().min(1),
  employeeId: z.string().min(1, "Selecione o colaborador."),
  kind: z.nativeEnum(PayrollItemKind),
  amount: z.number().positive("Valor deve ser maior que zero."),
  notes: z.string().trim().nullable(),
});

export async function addPayrollItem(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const parsed = ItemSchema.parse({
      payrollId: String(formData.get("payrollId") ?? ""),
      employeeId: String(formData.get("employeeId") ?? ""),
      kind: (clean(formData.get("kind")) ?? "BONUS") as PayrollItemKind,
      amount: parseBRL(String(formData.get("amount") ?? "0")),
      notes: clean(formData.get("notes")),
    });
    const run = await prisma.payroll.findUnique({ where: { id: parsed.payrollId } });
    if (!run) return { ok: false, error: "Folha não encontrada." };
    if (run.status === "PAID")
      return { ok: false, error: "Folha paga não pode ser alterada." };
    await prisma.payrollItem.create({ data: parsed });
    revalidatePayroll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao adicionar o item." };
  }
}

export async function deletePayrollItem(id: string): Promise<ActionResult> {
  await requireAdmin();
  try {
    const item = await prisma.payrollItem.findUnique({
      where: { id },
      include: { payroll: { select: { status: true } } },
    });
    if (!item) return { ok: false, error: "Item não encontrado." };
    if (item.payroll.status === "PAID")
      return { ok: false, error: "Folha paga não pode ser alterada." };
    await prisma.payrollItem.deleteMany({ where: { id } });
    revalidatePayroll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao remover o item." };
  }
}

/**
 * Avança o status da folha. Ao marcar como PAGA, cria a DESPESA
 * correspondente (expenseType=PAYROLL, status pago) — é assim que a folha
 * entra no resultado sem contagem dupla.
 */
export async function setPayrollStatus(
  runId: string,
  status: string
): Promise<ActionResult> {
  await requireAdmin();
  try {
    const s = z.nativeEnum(PayrollStatus).parse(status);
    const run = await prisma.payroll.findUnique({
      where: { id: runId },
      include: { items: true },
    });
    if (!run) return { ok: false, error: "Folha não encontrada." };
    if (run.status === "PAID" && s !== "PAID")
      return { ok: false, error: "Folha paga não pode voltar de status." };

    if (s === "PAID" && run.status !== "PAID") {
      const total = run.items.reduce(
        (sum, i) => sum + n(i.amount) * (i.kind === "DEDUCTION" ? -1 : 1),
        0
      );
      if (total <= 0) return { ok: false, error: "Folha sem itens (total zero)." };
      const paidAt = new Date();
      await prisma.$transaction([
        prisma.payroll.update({ where: { id: runId }, data: { status: s, paidAt } }),
        prisma.transaction.create({
          data: {
            date: paidAt,
            description: `Folha de pagamento ${String(run.month).padStart(2, "0")}/${run.year}`,
            amount: total,
            type: "despesa",
            origin: "pix",
            status: "pago",
            belongsTo: "empresa",
            expenseType: "PAYROLL",
            hash: null,
          },
        }),
        // comissões da competência quitadas junto com a folha
        prisma.commission.updateMany({
          where: { month: run.month, year: run.year, status: "APPROVED" },
          data: { status: "PAID", paidAt },
        }),
      ]);
    } else {
      await prisma.payroll.update({ where: { id: runId }, data: { status: s } });
    }
    revalidatePayroll();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.issues?.[0]?.message ?? e?.message ?? "Falha ao atualizar a folha." };
  }
}
