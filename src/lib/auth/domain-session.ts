import type { DomainContext } from "@/lib/engines/domain";
import type { CurrentUser } from "./current-user";
import { resolveOwnerId } from "./owner-scope";

/**
 * DomainContext a partir da SESSÃO do navegador — o que toda Server Action
 * usa antes de chamar uma função de domínio. O dono é o mesmo que o escopo
 * do Prisma já resolvia pelo cookie (claim `own`), então nada muda no que
 * cada usuário enxerga. A futura API monta o contexto pela chave, não aqui.
 */
export async function domainContextFor(viewer: CurrentUser): Promise<DomainContext> {
  const ownerId = (await resolveOwnerId()) ?? viewer.workspaceOwnerId ?? viewer.id;
  let correlationId: string | null = null;
  try {
    const { headers } = await import("next/headers");
    correlationId = headers().get("x-correlation-id");
  } catch {
    /* fora de requisição */
  }
  return {
    ownerId,
    principal: {
      kind: "user",
      origin: "UI",
      user: {
        id: viewer.id,
        name: viewer.name,
        email: viewer.email,
        role: viewer.role,
        permissions: viewer.permissions,
        workspaceOwnerId: viewer.workspaceOwnerId,
      },
    },
    correlationId,
  };
}
