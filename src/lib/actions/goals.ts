"use server";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBRL, parseDateBR } from "@/lib/format";

const Schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: z.enum(["economia", "quitacao", "investimento", "reserva"]).default("economia"),
  targetAmount: z.number().nonnegative(),
  currentAmount: z.number().nonnegative().default(0),
  deadline: z.date().nullable().optional(),
  priority: z.number().int().min(1).max(5).default(3),
  notes: z.string().optional().nullable(),
});

export async function saveGoal(formData: FormData) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const deadlineStr = String(formData.get("deadline") || "");
  const deadline = deadlineStr ? parseDateBR(deadlineStr) : null;
  const parsed = Schema.parse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    type: formData.get("type") || "economia",
    targetAmount: parseBRL(String(formData.get("targetAmount") || "0")),
    currentAmount: parseBRL(String(formData.get("currentAmount") || "0")),
    deadline,
    priority: Number(formData.get("priority") || 3),
    notes: (formData.get("notes") as string) || null,
  });
  if (parsed.id) {
    await prisma.goal.update({
      where: { id: parsed.id },
      data: {
        name: parsed.name,
        type: parsed.type,
        targetAmount: parsed.targetAmount,
        currentAmount: parsed.currentAmount,
        deadline: parsed.deadline ?? null,
        priority: parsed.priority,
        notes: parsed.notes,
      },
    });
  } else {
    await prisma.goal.create({
      data: {
        name: parsed.name,
        type: parsed.type,
        targetAmount: parsed.targetAmount,
        currentAmount: parsed.currentAmount,
        deadline: parsed.deadline ?? null,
        priority: parsed.priority,
        notes: parsed.notes,
      },
    });
  }
  revalidatePath("/metas");
}

export async function deleteGoal(id: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  await prisma.goal.delete({ where: { id } });
  revalidatePath("/metas");
}
