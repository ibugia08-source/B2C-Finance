"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/viewer";

const CreateSchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Senha mínima de 6 caracteres"),
  role: z.enum(["ADMIN", "USER"]),
  active: z.boolean(),
  personId: z.string().nullable().optional(),
});

const UpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().optional().nullable(),
  role: z.enum(["ADMIN", "USER"]),
  active: z.boolean(),
  personId: z.string().nullable().optional(),
});

export async function createUser(formData: FormData) {
  await requireAdmin();
  const parsed = CreateSchema.parse({
    name: String(formData.get("name") || ""),
    email: String(formData.get("email") || "").trim().toLowerCase(),
    password: String(formData.get("password") || ""),
    role: String(formData.get("role") || "USER"),
    active: formData.get("active") !== "false",
    personId: (formData.get("personId") as string) || null,
  });

  const exists = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (exists) throw new Error("Já existe um usuário com este e-mail.");

  const passwordHash = await bcrypt.hash(parsed.password, 10);

  const user = await prisma.user.create({
    data: {
      name: parsed.name,
      email: parsed.email,
      passwordHash,
      role: parsed.role,
      active: parsed.active,
    },
  });

  if (parsed.personId) {
    // Garante 1:1 — desfaz vínculo anterior dessa Person
    await prisma.person.update({
      where: { id: parsed.personId },
      data: { userId: user.id },
    });
  }

  revalidatePath("/usuarios");
  revalidatePath("/pessoas");
}

export async function updateUser(formData: FormData) {
  await requireAdmin();
  const parsed = UpdateSchema.parse({
    id: String(formData.get("id") || ""),
    name: String(formData.get("name") || ""),
    email: String(formData.get("email") || "").trim().toLowerCase(),
    password: (formData.get("password") as string) || null,
    role: String(formData.get("role") || "USER"),
    active: formData.get("active") !== "false",
    personId: (formData.get("personId") as string) || null,
  });

  const data: any = {
    name: parsed.name,
    email: parsed.email,
    role: parsed.role,
    active: parsed.active,
  };
  if (parsed.password) {
    data.passwordHash = await bcrypt.hash(parsed.password, 10);
  }

  await prisma.user.update({ where: { id: parsed.id }, data });

  // Sincroniza vínculo com Person:
  // 1. desvincula qualquer Person que apontava para esse user mas não é a selecionada
  await prisma.person.updateMany({
    where: { userId: parsed.id, NOT: parsed.personId ? { id: parsed.personId } : undefined },
    data: { userId: null },
  });
  // 2. vincula a Person selecionada
  if (parsed.personId) {
    await prisma.person.update({
      where: { id: parsed.personId },
      data: { userId: parsed.id },
    });
  }

  revalidatePath("/usuarios");
  revalidatePath("/pessoas");
}

export async function deleteUser(id: string) {
  await requireAdmin();
  // Solta vínculo de Person, se houver
  await prisma.person.updateMany({ where: { userId: id }, data: { userId: null } });
  await prisma.user.delete({ where: { id } });
  revalidatePath("/usuarios");
  revalidatePath("/pessoas");
}

export async function linkPersonToUser(personId: string, userId: string | null) {
  await requireAdmin();
  if (userId) {
    // Desfaz vínculo anterior do mesmo user a outra pessoa
    await prisma.person.updateMany({
      where: { userId, NOT: { id: personId } },
      data: { userId: null },
    });
  }
  await prisma.person.update({
    where: { id: personId },
    data: { userId },
  });
  revalidatePath("/pessoas");
  revalidatePath(`/pessoas/${personId}`);
  revalidatePath("/usuarios");
}
