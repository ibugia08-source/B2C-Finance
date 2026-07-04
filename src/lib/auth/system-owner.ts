import { prisma } from "@/lib/prisma";

/**
 * Dono "de sistema" para contextos sem sessão (webhook do WhatsApp, cron de
 * lembretes). O agente e os lembretes agem sobre os dados do admin primário
 * (quem configurou o WhatsApp). User não é entidade privada → esta query não
 * é escopada pela extensão.
 */
export async function getPrimaryAdminId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}
