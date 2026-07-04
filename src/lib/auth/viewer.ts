import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, type CurrentUser } from "./current-user";

export type Viewer = CurrentUser & { personId: string | null };

/** Person vinculada memoizada por request (1 consulta por render). */
const getPersonIdForUser = cache(async (userId: string): Promise<string | null> => {
  const person = await prisma.person.findFirst({
    where: { userId },
    select: { id: true },
  });
  return person?.id ?? null;
});

/**
 * Retorna o usuário logado + Person vinculada (quando houver).
 * Não autenticado → redirect /login (com `from`, se fornecido).
 */
export async function getViewer(from?: string): Promise<Viewer> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login${from ? `?from=${encodeURIComponent(from)}` : ""}`);

  const personId = await getPersonIdForUser(user.id);
  return { ...user, personId };
}

/**
 * Restrição admin-only para páginas de servidor.
 * Não-admin é redirecionado para /dashboard com flag de denied.
 */
export async function requireAdmin(): Promise<Viewer> {
  const v = await getViewer();
  if (v.role !== "ADMIN") redirect("/dashboard?denied=admin");
  return v;
}

/**
 * Para USER comum sem Person vinculada, devolve true para que a página
 * mostre uma mensagem de "fale com o admin".
 */
export function isUnlinkedUser(v: Viewer): boolean {
  return v.role === "USER" && !v.personId;
}
