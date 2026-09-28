import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditEvent, auditUpdate } from "@/lib/audit";
import { hasPermission, ROLE_LABEL, isKnownRole } from "@/lib/permissions";
import { type DomainContext, domainUser, inDomain } from "@/lib/engines/domain";
import {
  ROTULO_DO_CANAL, metadadosDoCanal, normalizarIdentificador, variantesDoIdentificador, type Canal,
} from "@/lib/messaging/channels";
import { parseDataScope } from "@/lib/scope";
import { podeGerenciarIntegracoes, podeVerIntegracoes } from "./service-accounts";

/**
 * IDENTIDADE DE MENSAGERIA (28/09/2026; multicanal em 29/09/2026) —
 * canal + identificador externo → usuário. Canais: TELEGRAM (Telegram User
 * ID) e WHATSAPP (telefone). Ver lib/messaging/channels.
 *
 * Quem vincula: administrador (`integracoes.gerenciar`), pela tela
 * Configurações → Integrações → Canais. Quem consulta: a integração (n8n)
 * via POST /api/v1/integrations/resolve-identity — só pelo IDENTIFICADOR; o
 * usuário nunca é informado por quem chama.
 *
 * Regras:
 *  · o usuário precisa ser do workspace (dono ou membro) e estar ativo;
 *  · um identificador ativo responde por UM usuário, por canal (índice único parcial);
 *  · desvincular desativa (a linha fica para auditoria) e libera o identificador;
 *  · metadados (username, nome) são só exibição — nunca identidade.
 */

type Falha = { ok: false; error: string; code: "SEM_PERMISSAO" | "NAO_ENCONTRADO" | "INVALIDO" | "DUPLICADO" };
const SEM_PERMISSAO: Falha = { ok: false, code: "SEM_PERMISSAO", error: "Só o administrador pode vincular canais (Telegram, WhatsApp)." };

const ERRO_DE_FORMATO: Record<Canal, string> = {
  WHATSAPP: "Telefone inválido: informe DDD e número (com código do país se não for do Brasil).",
  TELEGRAM: "Telegram User ID inválido: são só números (ex.: 123456789). O @username não serve como identificação.",
};
const DESCRICAO: Record<Canal, string> = { WHATSAPP: "Este número", TELEGRAM: "Este Telegram" };

function gestor(ctx: DomainContext) {
  return podeGerenciarIntegracoes(ctx) ? domainUser(ctx) : null;
}

const auditCtx = (ctx: DomainContext, reason: string) => {
  const u = domainUser(ctx);
  return { origin: "UI" as const, reason, actorId: u?.id ?? null, actorEmail: u?.email ?? null, correlationId: ctx.correlationId ?? null };
};

/** Usuários do workspace (dono + membros), para o vínculo e a tela. */
export async function usuariosDoWorkspace(ownerId: string) {
  return prisma.user.findMany({
    where: { OR: [{ id: ownerId }, { workspaceOwnerId: ownerId }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
}

export async function listarIdentidades(ctx: DomainContext) {
  if (!podeVerIntegracoes(ctx)) return [];
  return inDomain(ctx, async () =>
    await prisma.messagingIdentity.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, channel: true, externalIdentifier: true, isActive: true, createdAt: true,
        deactivatedAt: true, lastResolvedAt: true, metadata: true,
        user: { select: { id: true, name: true, email: true, role: true, active: true } },
      },
    })
  );
}

/** Vincula canal + identificador a um usuário do workspace (só administrador). */
export async function vincularIdentidade(
  ctx: DomainContext,
  entrada: {
    userId: string;
    channel: Canal;
    externalIdentifier: string;
    metadata?: { username?: string | null; firstName?: string | null; lastName?: string | null } | null;
  }
): Promise<{ ok: true; id: string; externalIdentifier: string } | Falha> {
  const u = gestor(ctx);
  if (!u) return SEM_PERMISSAO;
  const canal = entrada.channel;
  if (canal !== "WHATSAPP" && canal !== "TELEGRAM") return { ok: false, code: "INVALIDO", error: "Canal inválido." };
  const id = normalizarIdentificador(canal, entrada.externalIdentifier);
  if (!id) return { ok: false, code: "INVALIDO", error: ERRO_DE_FORMATO[canal] };
  const usuario = (await usuariosDoWorkspace(ctx.ownerId)).find((x) => x.id === entrada.userId);
  if (!usuario) return { ok: false, code: "NAO_ENCONTRADO", error: "Usuário não encontrado neste workspace." };
  if (!usuario.active) return { ok: false, code: "INVALIDO", error: "Usuário inativo não pode ser vinculado." };
  const metadata = metadadosDoCanal(canal, entrada.metadata);

  return inDomain(ctx, async () => {
    // O identificador (em qualquer forma equivalente) já responde por alguém?
    const existente = await prisma.messagingIdentity.findFirst({
      where: { channel: canal, isActive: true, externalIdentifier: { in: variantesDoIdentificador(canal, id) } },
      select: { user: { select: { name: true } } },
    });
    if (existente) {
      return { ok: false as const, code: "DUPLICADO" as const, error: `${DESCRICAO[canal]} já está vinculado a ${existente.user.name}. Desvincule antes.` };
    }
    try {
      const criado = await prisma.$transaction(async (tx) => {
        const r = await tx.messagingIdentity.create({
          data: {
            ownerId: ctx.ownerId, userId: usuario.id, channel: canal, externalIdentifier: id, createdById: u.id,
            ...(metadata ? { metadata } : {}),
          },
          select: { id: true },
        });
        await auditEvent(tx, "MessagingIdentity", r.id, "CREATE", auditCtx(ctx, `${ROTULO_DO_CANAL[canal]} vinculado a ${usuario.name}`));
        return r;
      });
      return { ok: true as const, id: criado.id, externalIdentifier: id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return { ok: false as const, code: "DUPLICADO" as const, error: `${DESCRICAO[canal]} já está vinculado a outro usuário.` };
      }
      throw e;
    }
  });
}

/** Atalho do WhatsApp (mesma regra). */
export const vincularWhatsApp = (ctx: DomainContext, entrada: { userId: string; telefone: string }) =>
  vincularIdentidade(ctx, { userId: entrada.userId, channel: "WHATSAPP", externalIdentifier: entrada.telefone });

async function mudarAtivo(ctx: DomainContext, id: string, ativo: boolean): Promise<{ ok: true } | Falha> {
  const u = gestor(ctx);
  if (!u) return SEM_PERMISSAO;
  return inDomain(ctx, async () => {
    const atual = await prisma.messagingIdentity.findFirst({
      where: { id },
      select: { id: true, isActive: true, externalIdentifier: true, channel: true, user: { select: { active: true, name: true } } },
    });
    if (!atual) return { ok: false as const, code: "NAO_ENCONTRADO" as const, error: "Vínculo não encontrado." };
    if (atual.isActive === ativo) return { ok: true as const };
    if (ativo) {
      if (!atual.user.active) return { ok: false as const, code: "INVALIDO" as const, error: "Usuário inativo não pode ser reativado." };
      const outro = await prisma.messagingIdentity.findFirst({
        where: {
          channel: atual.channel, isActive: true,
          externalIdentifier: { in: variantesDoIdentificador(atual.channel, atual.externalIdentifier) }, NOT: { id },
        },
        select: { user: { select: { name: true } } },
      });
      if (outro) return { ok: false as const, code: "DUPLICADO" as const, error: `${DESCRICAO[atual.channel]} já está vinculado a ${outro.user.name}.` };
    }
    const agora = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.messagingIdentity.updateMany({
        where: { id, isActive: !ativo },
        data: ativo
          ? { isActive: true, deactivatedAt: null, deactivatedById: null }
          : { isActive: false, deactivatedAt: agora, deactivatedById: u.id },
      });
      await auditUpdate(tx, "MessagingIdentity", id, { isActive: !ativo }, { isActive: ativo },
        auditCtx(ctx, `${ROTULO_DO_CANAL[atual.channel]} ${ativo ? "reativado" : "desvinculado"} (${atual.user.name})`));
    });
    return { ok: true as const };
  });
}

export const desvincularIdentidade = (ctx: DomainContext, id: string) => mudarAtivo(ctx, id, false);
export const reativarIdentidade = (ctx: DomainContext, id: string) => mudarAtivo(ctx, id, true);
/** Nomes antigos (mesma regra — valem para qualquer canal). */
export const desvincularWhatsApp = desvincularIdentidade;
export const reativarWhatsApp = reativarIdentidade;

// ---------------------------------------------------------------------------
// Resolução (usada pela API; roda no escopo do dono da conta de serviço)
// ---------------------------------------------------------------------------

export type IdentidadeResolvida = {
  identityId: string;
  channel: Canal;
  externalIdentifier: string;
  user: {
    id: string;
    name: string;
    role: string;
    roleLabel: string;
    permissions: { permission: string; enabled: boolean }[];
    workspaceOwnerId: string | null;
    dataScope: "WORKSPACE" | "AGENCY";
  };
  pode: (permission: string) => boolean;
};

async function montar(identidade: {
  id: string; channel: Canal; externalIdentifier: string;
  user: { id: string; name: string; email: string; role: string; active: boolean; workspaceOwnerId: string | null; dataScope: string; scopeAgencyId: string | null; permissions: { permission: string; enabled: boolean }[] };
}): Promise<IdentidadeResolvida | null> {
  const u = identidade.user;
  if (!u.active) return null;
  const escopo = parseDataScope({ role: u.role, dataScope: u.dataScope, scopeAgencyId: u.scopeAgencyId });
  const pu = { role: u.role, permissions: u.permissions };
  return {
    identityId: identidade.id,
    channel: identidade.channel,
    externalIdentifier: identidade.externalIdentifier,
    user: {
      id: u.id,
      name: u.name,
      role: u.role,
      roleLabel: isKnownRole(u.role) ? ROLE_LABEL[u.role] : u.role,
      permissions: u.permissions,
      workspaceOwnerId: u.workspaceOwnerId,
      dataScope: escopo.kind === "AGENCY" ? "AGENCY" : "WORKSPACE",
    },
    pode: (p: string) => hasPermission(pu, p),
  };
}

const SELECT_IDENTIDADE = {
  id: true,
  channel: true,
  externalIdentifier: true,
  user: {
    select: {
      id: true, name: true, email: true, role: true, active: true, workspaceOwnerId: true,
      dataScope: true, scopeAgencyId: true,
      permissions: { select: { permission: true, enabled: true } },
    },
  },
} as const;

/** Canal + identificador → usuário ATIVO do dono do escopo atual (null = não vinculado). */
export async function resolverIdentidade(canal: Canal, raw: string): Promise<IdentidadeResolvida | null> {
  const id = normalizarIdentificador(canal, raw);
  if (!id) return null;
  const achada = await prisma.messagingIdentity.findFirst({
    where: { channel: canal, isActive: true, externalIdentifier: { in: variantesDoIdentificador(canal, id) } },
    select: SELECT_IDENTIDADE,
  });
  if (!achada) return null;
  // Último uso, amostrado (no máximo 1 escrita por minuto por vínculo).
  await prisma.messagingIdentity.updateMany({
    where: { id: achada.id, OR: [{ lastResolvedAt: null }, { lastResolvedAt: { lt: new Date(Date.now() - 60_000) } }] },
    data: { lastResolvedAt: new Date() },
  });
  return montar(achada);
}

/** Atalho do WhatsApp. */
export const resolverPorTelefone = (raw: string) => resolverIdentidade("WHATSAPP", raw);

/** Id de vínculo (header X-B2C-Identity) → usuário ATIVO do dono do escopo atual. */
export async function resolverPorId(identityId: string): Promise<IdentidadeResolvida | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(identityId)) return null;
  const achada = await prisma.messagingIdentity.findFirst({
    where: { id: identityId, isActive: true },
    select: SELECT_IDENTIDADE,
  });
  return achada ? montar(achada) : null;
}
