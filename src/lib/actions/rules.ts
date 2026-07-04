"use server";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBRL } from "@/lib/format";

const Schema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  priority: z.number().int().default(100),
  active: z.boolean().default(true),
  descriptionContains: z.string().optional().nullable(),
  cardId: z.string().optional().nullable(),
  amountGreaterThan: z.number().nullable().optional(),
  amountLessThan: z.number().nullable().optional(),
  categoryId: z.string().optional().nullable(),
  responsibleName: z.string().optional().nullable(),
  belongsTo: z.string().optional().nullable(),
  reimbursable: z.boolean().nullable().optional(),
  status: z.string().optional().nullable(),
});

export async function saveRule(formData: FormData) {
  const num = (k: string) => {
    const v = String(formData.get(k) || "").trim();
    if (!v) return null;
    return parseBRL(v);
  };
  const parsed = Schema.parse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    priority: Number(formData.get("priority") || 100),
    active: formData.get("active") !== "false",
    descriptionContains: (formData.get("descriptionContains") as string) || null,
    cardId: (formData.get("cardId") as string) || null,
    amountGreaterThan: num("amountGreaterThan"),
    amountLessThan: num("amountLessThan"),
    categoryId: (formData.get("categoryId") as string) || null,
    responsibleName: (formData.get("responsibleName") as string) || null,
    belongsTo: (formData.get("belongsTo") as string) || null,
    reimbursable:
      formData.get("reimbursable") === "on"
        ? true
        : formData.get("reimbursable") === "false"
          ? false
          : null,
    status: (formData.get("status") as string) || null,
  });

  if (parsed.id) {
    await prisma.categorizationRule.update({
      where: { id: parsed.id },
      data: { ...parsed, id: undefined } as any,
    });
  } else {
    await prisma.categorizationRule.create({ data: { ...parsed, id: undefined } as any });
  }
  revalidatePath("/regras");
}

export async function deleteRule(id: string) {
  await prisma.categorizationRule.delete({ where: { id } });
  revalidatePath("/regras");
}
