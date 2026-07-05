"use server";
import { prisma } from "@/lib/prisma";
import { getViewer } from "@/lib/auth/viewer";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseBRL } from "@/lib/format";

const AccountCardSchema = z.object({
  id: z.string().optional(),
  cardId: z.string().min(1, "Conta obrigatória"),
  name: z.string().min(1, "Nome obrigatório"),
  kind: z.enum(["fisico", "virtual"]).default("fisico"),
  lastDigits: z.string().optional().nullable(),
  limit: z.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
});

export async function saveAccountCard(formData: FormData) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const parsed = AccountCardSchema.parse({
    id: formData.get("id") || undefined,
    cardId: formData.get("cardId"),
    name: formData.get("name"),
    kind: formData.get("kind") || "fisico",
    lastDigits: (formData.get("lastDigits") as string)?.trim() || null,
    limit: parseBRL(String(formData.get("limit") || "0")),
    notes: (formData.get("notes") as string) || null,
  });

  const data = {
    cardId: parsed.cardId,
    name: parsed.name,
    kind: parsed.kind,
    lastDigits: parsed.lastDigits,
    limit: parsed.limit,
    notes: parsed.notes,
  };

  if (parsed.id) {
    await prisma.accountCard.update({ where: { id: parsed.id }, data });
  } else {
    await prisma.accountCard.create({ data });
  }
  revalidatePath(`/cartoes/${parsed.cardId}`);
  revalidatePath("/cartoes");
}

export async function deleteAccountCard(id: string) {
  await getViewer(); // sessão obrigatória (dados escopados por dono)
  const existing = await prisma.accountCard.findUnique({ where: { id } });
  await prisma.accountCard.delete({ where: { id } });
  if (existing) {
    revalidatePath(`/cartoes/${existing.cardId}`);
    revalidatePath("/cartoes");
  }
}
