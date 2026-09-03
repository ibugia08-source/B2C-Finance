import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";

/**
 * Workspace corrente (F1.5).
 *
 * Os motores de domínio precisam do workspace para o razão, a bandeira de
 * funcionalidade e o Outbox. Hoje existe UM workspace, semeado pela
 * migration da F0.4 — a consulta é por isso simples e cacheada em memória
 * do processo. Quando houver mais de um, este é o único ponto a mudar.
 *
 * Fora de escopo por dono de propósito: Workspace não pertence a um
 * usuário, ele CONTÉM os usuários.
 */
let cache: string | null = null;

export async function currentWorkspaceId(): Promise<string> {
  if (cache) return cache;
  const w = await runWithoutScope(async () =>
    prisma.workspace.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } })
  );
  if (!w) throw new Error("Nenhum workspace configurado — rode as migrations.");
  cache = w.id;
  return cache;
}
