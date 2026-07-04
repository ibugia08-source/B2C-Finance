import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
};

/**
 * Lê a sessão do cookie e devolve o usuário ativo correspondente.
 * Retorna null quando não há sessão válida ou o usuário foi desativado.
 *
 * Memoizado por request (React.cache): layout + página + actions dentro da
 * mesma renderização compartilham 1 única consulta ao banco.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user || !user.active) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: (user.role as "ADMIN" | "USER") ?? "USER",
  };
});
