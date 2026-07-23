"use server";
import { MONEY_EPSILON } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/viewer";
import { revalidateFinance } from "@/lib/revalidate";
import { z } from "zod";
import { parseBRL, parseDateBR } from "@/lib/format";

const TYPES = [
  "PERSONAL",
  "EMERGENCY",
  "INVESTMENT",
  "COMPANY",
  "GOAL",
  "OTHER",
] as const;

const Schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  currentAmount: z.number().nonnegative(),
  targetAmount: z.number().nullable().optional(),
  type: z.enum(TYPES),
  accountId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function saveCashBox(formData: FormData) {
  await requirePermission("caixa.editar");
  const targetRaw = String(formData.get("targetAmount") || "").trim();
  const parsed = Schema.parse({
    id: formData.get("id") || undefined,
    name: String(formData.get("name") || ""),
    currentAmount: parseBRL(String(formData.get("currentAmount") || "0")),
    targetAmount: targetRaw ? parseBRL(targetRaw) : null,
    type: String(formData.get("type") || "PERSONAL"),
    accountId: (formData.get("accountId") as string) || null,
    notes: (formData.get("notes") as string) || null,
  });

  const data = {
    name: parsed.name,
    currentAmount: parsed.currentAmount,
    targetAmount: parsed.targetAmount ?? null,
    type: parsed.type,
    accountId: parsed.accountId,
    notes: parsed.notes,
  };

  if (parsed.id) {
    await prisma.cashBox.update({ where: { id: parsed.id }, data });
  } else {
    await prisma.cashBox.create({ data });
  }

  revalidateFinance();
}

export async function deleteCashBox(id: string) {
  await requirePermission("caixa.excluir");
  await prisma.cashBox.delete({ where: { id } });
  revalidateFinance();
}

const MoveSchema = z.object({
  cashBoxId: z.string().min(1),
  type: z.enum(["IN", "OUT"]),
  amount: z.number().positive(),
  date: z.date(),
  description: z.string().nullable().optional(),
});

export async function registerCashMovement(formData: FormData) {
  await requirePermission("caixa.lancar");
  const date =
    parseDateBR(String(formData.get("date") || "")) ?? new Date();

  const parsed = MoveSchema.parse({
    cashBoxId: String(formData.get("cashBoxId") || ""),
    type: String(formData.get("type") || "IN"),
    amount: parseBRL(String(formData.get("amount") || "0")),
    date,
    description: (formData.get("description") as string) || null,
  });

  const box = await prisma.cashBox.findUnique({ where: { id: parsed.cashBoxId } });
  if (!box) throw new Error("Caixa não encontrado");

  const delta = parsed.type === "IN" ? parsed.amount : -parsed.amount;
  const next = box.currentAmount + delta;

  await prisma.$transaction([
    prisma.cashBoxMovement.create({
      data: {
        cashBoxId: parsed.cashBoxId,
        type: parsed.type,
        amount: parsed.amount,
        date: parsed.date,
        description: parsed.description,
      },
    }),
    prisma.cashBox.update({
      where: { id: parsed.cashBoxId },
      data: { currentAmount: next },
    }),
  ]);

  revalidateFinance();
}

/**
 * Lança (parte do) RESULTADO POSITIVO do mês ao Caixa operacional (Dashboard).
 * Cria um movimento IN marcado com [resultado:YYYY-MM] para rastrear quanto de
 * cada mês já foi lançado e evitar duplicidade. Reutiliza um caixa "Caixa
 * operacional" (type COMPANY); cria se não existir.
 */
const MONTHS_PT_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export async function launchResultToCash(input: {
  year: number;
  month: number; // 1-12
  amount: number;
  cashBoxId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePermission("caixa.lancar");
  try {
    const { resultLaunchTag, getResultLaunchedForMonth } = await import(
      "@/lib/services/dashboard-main"
    );
    const { getDashboardMainMetrics } = await import("@/lib/services/dashboard-main");

    const year = Math.trunc(input.year);
    const month = Math.trunc(input.month);
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, error: "Informe um valor válido." };
    if (month < 1 || month > 12) return { ok: false, error: "Mês inválido." };

    // Resultado real do mês (fonte central) e quanto já foi lançado.
    const period = {
      key: "custom" as const,
      start: new Date(year, month - 1, 1),
      end: new Date(year, month, 1),
      label: "",
    };
    const [metrics, alreadyLaunched] = await Promise.all([
      getDashboardMainMetrics(period),
      getResultLaunchedForMonth(year, month),
    ]);
    const resultado = metrics.current.resultado;
    if (resultado <= 0)
      return { ok: false, error: "O resultado do mês não é positivo." };

    const disponivel = resultado - alreadyLaunched;
    if (disponivel <= 0)
      return { ok: false, error: "Todo o resultado deste mês já foi lançado ao caixa." };
    if (amount > disponivel + MONEY_EPSILON)
      return {
        ok: false,
        error: `Valor acima do disponível para lançar (${disponivel.toFixed(2)}).`,
      };

    // Caixa de destino: informado, ou "Caixa operacional" (cria se faltar).
    let boxId = input.cashBoxId;
    if (!boxId) {
      const existing = await prisma.cashBox.findFirst({
        where: { type: "COMPANY", name: "Caixa operacional" },
      });
      boxId = existing?.id;
      if (!boxId) {
        const created = await prisma.cashBox.create({
          data: { name: "Caixa operacional", type: "COMPANY", currentAmount: 0 },
        });
        boxId = created.id;
      }
    }
    const box = await prisma.cashBox.findUnique({ where: { id: boxId } });
    if (!box) return { ok: false, error: "Caixa de destino não encontrado." };

    const label = `${MONTHS_PT_FULL[month - 1]}/${year}`;
    await prisma.$transaction([
      prisma.cashBoxMovement.create({
        data: {
          cashBoxId: boxId,
          type: "IN",
          amount,
          description: `Resultado do mês ${label} ${resultLaunchTag(year, month)}`,
        },
      }),
      prisma.cashBox.update({
        where: { id: boxId },
        data: { currentAmount: box.currentAmount + amount },
      }),
    ]);

    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao lançar ao caixa." };
  }
}

export async function deleteCashMovement(id: string) {
  await requirePermission("caixa.excluir");
  const mov = await prisma.cashBoxMovement.findUnique({ where: { id } });
  if (!mov) return;
  const delta = mov.type === "IN" ? -mov.amount : mov.amount;
  const box = await prisma.cashBox.findUnique({ where: { id: mov.cashBoxId } });
  if (!box) return;

  await prisma.$transaction([
    prisma.cashBoxMovement.delete({ where: { id } }),
    prisma.cashBox.update({
      where: { id: mov.cashBoxId },
      data: { currentAmount: box.currentAmount + delta },
    }),
  ]);
  revalidateFinance();
}
