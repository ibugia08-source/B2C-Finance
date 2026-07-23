"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

const LoginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(1, "Informe a senha"),
});

export type LoginState = { error?: string } | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: String(formData.get("email") || "").trim().toLowerCase(),
    password: String(formData.get("password") || ""),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.active) {
    return { error: "E-mail ou senha incorretos" };
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    return { error: "E-mail ou senha incorretos" };
  }

  const token = createSessionToken({
    uid: user.id,
    role: user.role ?? "USER",
    // Workspace: membro da equipe enxerga os dados do dono da conta.
    // Sem vínculo → o próprio usuário é o dono (comportamento original).
    own: user.workspaceOwnerId ?? user.id,
  });

  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 dias
  });

  redirect("/dashboard");
}

export async function logoutAction() {
  cookies().delete(SESSION_COOKIE);
  redirect("/login");
}
