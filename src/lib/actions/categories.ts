"use server";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const CategorySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  color: z.string().optional().nullable(),
  kind: z.enum(["despesa", "receita", "mista"]).default("despesa"),
});

export async function saveCategory(formData: FormData) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const parsed = CategorySchema.parse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    color: formData.get("color") || null,
    kind: formData.get("kind") || "despesa",
  });
  if (parsed.id) {
    await prisma.category.update({
      where: { id: parsed.id },
      data: { name: parsed.name, color: parsed.color, kind: parsed.kind },
    });
  } else {
    await prisma.category.create({
      data: { name: parsed.name, color: parsed.color, kind: parsed.kind },
    });
  }
  revalidatePath("/configuracoes");
}

export async function deleteCategory(id: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  await prisma.category.delete({ where: { id } });
  revalidatePath("/configuracoes");
}
