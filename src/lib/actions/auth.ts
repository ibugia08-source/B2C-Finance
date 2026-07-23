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

// ===== Proteção contra força bruta =====
// Após MAX_FAILED_LOGINS erros seguidos, a conta trava por LOCK_MINUTES.
// O contador zera no primeiro login correto. Complementa o rate limit por IP
// do middleware (este aqui é por CONTA — funciona mesmo com IPs rotativos).
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// Hash de senha inexistente: quando o e-mail não está cadastrado, comparamos
// contra este hash para o tempo de resposta ser igual ao de senha errada —
// sem isso, o atacante descobre quais e-mails existem pelo tempo (enumeração).
const DUMMY_HASH = "$2b$10$rlGxwdGy5pj4m4czEH2/cOCPTvw.TONEQSEXmcGWeWT.Fs1RdxBL.";

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: String(formData.get("email") || "").trim().toLowerCase(),
    password: String(formData.get("password") || ""),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    return {
      error: `Muitas tentativas de login. Tente novamente em ${mins} minuto${mins === 1 ? "" : "s"}.`,
    };
  }

  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.active || !ok) {
    if (user && user.active) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED_LOGINS
            ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : { failedLogins: failed },
      });
    }
    return { error: "E-mail ou senha incorretos" };
  }

  if (user.failedLogins > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
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
