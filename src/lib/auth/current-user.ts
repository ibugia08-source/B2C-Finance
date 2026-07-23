import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import type { PermissionOverride } from "@/lib/permissions";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  /** Papel/função (catálogo em src/lib/permissions.ts). */
  role: string;
  /** Ajustes finos de permissão (diferenças vs. o padrão do papel). */
  permissions: PermissionOverride[];
  /** Dono do workspace (null → o próprio usuário é o dono). */
  workspaceOwnerId: string | null;
};

/**
 * Lê a sessão do cookie e devolve o usuário ativo correspondente.
 * Retorna null quando não há sessão válida ou o usuário foi desativado.
 *
 * Memoizado por request (React.cache): layout + página + actions dentro da
 * mesma renderização compartilham 1 única consulta ao banco (o include de
 * permissions vem junto, sem query extra).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    include: { permissions: { select: { permission: true, enabled: true } } },
  });
  if (!user || !user.active) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role ?? "USER",
    permissions: user.permissions,
    workspaceOwnerId: user.workspaceOwnerId,
  };
});
