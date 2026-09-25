"use server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth/viewer";
import { revalidatePath } from "next/cache";
import { revalidateFinance } from "@/lib/revalidate";
import { z } from "zod";

const CategorySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  color: z.string().optional().nullable(),
  kind: z.enum(["despesa", "receita", "mista"]).default("despesa"),
});

// Category é GLOBAL (fora da extensão de dono): criar, renomear ou excluir
// mexe nas categorias de todos os lançamentos. Por isso exige a permissão de
// alterar configurações — antes bastava estar logado.
export async function saveCategory(formData: FormData) {
  await requirePermission("configuracoes.editar");
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
  revalidateFinance();
  revalidatePath("/configuracoes");
}

export async function deleteCategory(id: string) {
  await requirePermission("configuracoes.editar");
  await prisma.category.delete({ where: { id } });
  revalidateFinance();
  revalidatePath("/configuracoes");
}
