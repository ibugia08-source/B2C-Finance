"use server";
import { revalidateAdmin, revalidateFinance } from "@/lib/revalidate";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requirePermission, can, type Viewer } from "@/lib/auth/viewer";
import { isKnownPermission, isKnownRole } from "@/lib/permissions";
import type { ActionResult } from "./clients";

const RoleSchema = z
  .string()
  .refine(isKnownRole, "Papel inválido.");

/** Diferenças de permissão vs. o padrão do papel, vindas da matriz (JSON). */
const OverridesSchema = z.array(
  z.object({ permission: z.string(), enabled: z.boolean() })
);

const CreateSchema = z.object({
  name: z.string().min(1, "Nome obrigatório"),
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Senha mínima de 6 caracteres"),
  role: RoleSchema,
  active: z.boolean(),
  personId: z.string().nullable().optional(),
});

const UpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().optional().nullable(),
  role: RoleSchema,
  active: z.boolean(),
  personId: z.string().nullable().optional(),
});


/**
 * Recorte de dados (F1.10 · 03 §1.1). Espelha em Zod a mesma coerência que o
 * banco garante por CHECK: AGENCY exige agência, WORKSPACE proíbe.
 * Os dois níveis existem de propósito — a mensagem amigável vem daqui, e o
 * banco é quem realmente impede, inclusive contra escrita fora da tela.
 */
const EscopoSchema = z
  .object({
    dataScope: z.enum(["WORKSPACE", "AGENCY"]).default("WORKSPACE"),
    scopeAgencyId: z.string().nullable().optional(),
  })
  .refine((v) => v.dataScope === "WORKSPACE" || !!v.scopeAgencyId, {
    message: "Escolha a agência que este usuário enxerga.",
    path: ["scopeAgencyId"],
  });

/** Lê o recorte do formulário, já normalizado (ADMIN é sempre total). */
function lerEscopo(formData: FormData, role: string) {
  if (role === "ADMIN") return { dataScope: "WORKSPACE" as const, scopeAgencyId: null };
  const parsed = EscopoSchema.parse({
    dataScope: String(formData.get("dataScope") || "WORKSPACE"),
    scopeAgencyId: (formData.get("scopeAgencyId") as string) || null,
  });
  return {
    dataScope: parsed.dataScope,
    scopeAgencyId: parsed.dataScope === "AGENCY" ? parsed.scopeAgencyId! : null,
  };
}

/** Raiz do workspace do viewer (dono dos dados que ele enxerga). */
function workspaceRootOf(viewer: Viewer): string {
  return viewer.workspaceOwnerId ?? viewer.id;
}

/**
 * User é modelo GLOBAL (fora da extensão de dono): sem esta checagem, quem tem
 * usuarios.editar/excluir em um workspace alcançava usuários de OUTRO pelo id.
 */
function isInWorkspace(
  target: { id: string; workspaceOwnerId: string | null },
  viewer: Viewer
): boolean {
  const root = workspaceRootOf(viewer);
  return target.id === root || target.workspaceOwnerId === root;
}

/**
 * Papel que quem NÃO tem usuarios.alterar_permissoes pode atribuir: o mais
 * restrito do catálogo (só olha, sem valor sensível). Antes o padrão do
 * formulário era FINANCEIRO — o select vem desabilitado para esse usuário,
 * não é enviado, e o servidor caía no FINANCEIRO: criar usuário virava
 * escalada de privilégio.
 */
const PAPEL_SEM_GESTAO_DE_PERMISSOES = "LEITURA";

/**
 * Recorte de quem cria sem poder alterar permissões: nunca mais largo que o
 * do próprio criador. Criador de uma agência só cria usuário daquela agência.
 */
async function escopoLimitadoAoDoCriador(
  viewer: Viewer,
  pedido: { dataScope: "WORKSPACE" | "AGENCY"; scopeAgencyId: string | null }
): Promise<
  | { ok: true; escopo: { dataScope: "WORKSPACE" | "AGENCY"; scopeAgencyId: string | null } }
  | { ok: false; error: string }
> {
  const proprio = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: { dataScope: true, scopeAgencyId: true },
  });
  if (!proprio || proprio.dataScope !== "AGENCY" || !proprio.scopeAgencyId) {
    // Criador enxerga o workspace inteiro: qualquer recorte é igual ou menor.
    return { ok: true, escopo: pedido };
  }
  if (pedido.dataScope === "WORKSPACE") {
    // Campo desabilitado na tela não é enviado → herda o recorte do criador.
    return { ok: true, escopo: { dataScope: "AGENCY", scopeAgencyId: proprio.scopeAgencyId } };
  }
  if (pedido.scopeAgencyId !== proprio.scopeAgencyId) {
    return { ok: false, error: "Você só pode criar usuários da sua própria agência." };
  }
  return { ok: true, escopo: pedido };
}

function parseOverrides(formData: FormData): { permission: string; enabled: boolean }[] {
  const raw = formData.get("permissions");
  if (!raw) return [];
  try {
    const parsed = OverridesSchema.parse(JSON.parse(String(raw)));
    return parsed.filter((p) => isKnownPermission(p.permission));
  } catch {
    return [];
  }
}

/**
 * Garante que não estamos rebaixando/desativando/excluindo o ÚLTIMO
 * administrador ativo — regra que impede a conta de ficar sem admin.
 */
async function assertNotLastActiveAdmin(targetId: string): Promise<string | null> {
  const others = await prisma.user.count({
    where: { role: "ADMIN", active: true, NOT: { id: targetId } },
  });
  if (others === 0) {
    return "Este é o último administrador ativo — promova outro administrador antes.";
  }
  return null;
}

export async function createUser(formData: FormData): Promise<ActionResult> {
  const viewer = await requirePermission("usuarios.criar");
  try {
    const canManagePerms = can(viewer, "usuarios.alterar_permissoes");
    const papelPedido = String(formData.get("role") || "");
    // Sem alterar_permissoes: só o papel mais restrito (vazio = ele).
    if (!canManagePerms && papelPedido && papelPedido !== PAPEL_SEM_GESTAO_DE_PERMISSOES) {
      return { ok: false, error: "Você não tem permissão para escolher o papel do usuário." };
    }
    const parsed = CreateSchema.parse({
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || "").trim().toLowerCase(),
      password: String(formData.get("password") || ""),
      role: papelPedido || (canManagePerms ? "FINANCEIRO" : PAPEL_SEM_GESTAO_DE_PERMISSOES),
      active: formData.get("active") !== "false",
      personId: (formData.get("personId") as string) || null,
    });
    const overrides = parseOverrides(formData);

    // Escalada de privilégio: só ADMIN cria outro ADMIN; papel/ajustes além do
    // padrão exigem a permissão de alterar permissões.
    if (parsed.role === "ADMIN" && viewer.role !== "ADMIN") {
      return { ok: false, error: "Apenas administradores podem criar administradores." };
    }
    if (overrides.length > 0 && !canManagePerms) {
      return { ok: false, error: "Você não tem permissão para ajustar permissões." };
    }

    let escopo = lerEscopo(formData, parsed.role);
    if (!canManagePerms) {
      const r = await escopoLimitadoAoDoCriador(viewer, escopo);
      if (!r.ok) return { ok: false, error: r.error };
      escopo = r.escopo;
    }

    // Sem pré-checagem de e-mail: a constraint única do banco decide (P2002)
    // — economiza um roundtrip no caminho feliz.
    const passwordHash = await bcrypt.hash(parsed.password, 10);

    const user = await prisma.user.create({
      data: {
        name: parsed.name,
        email: parsed.email,
        passwordHash,
        role: parsed.role,
        active: parsed.active,
        ...escopo,
        // Membro da equipe enxerga os dados do dono da conta do criador.
        workspaceOwnerId: workspaceRootOf(viewer),
      },
    });

    // Ajustes finos + vínculo de Pessoa num único batch (uma ida ao banco).
    const followUps: any[] = [];
    if (parsed.role !== "ADMIN" && overrides.length > 0) {
      followUps.push(
        prisma.userPermission.createMany({
          data: overrides.map((o) => ({
            userId: user.id,
            permission: o.permission,
            enabled: o.enabled,
          })),
        })
      );
    }
    if (parsed.personId) {
      // Garante 1:1 — desfaz vínculo anterior dessa Person. updateMany é
      // escopado por dono: Person de outro workspace não é tocada.
      followUps.push(
        prisma.person.updateMany({
          where: { id: parsed.personId },
          data: { userId: user.id },
        })
      );
    }
    if (followUps.length > 0) await prisma.$transaction(followUps);

    revalidateAdmin();
    revalidateFinance();
    return { ok: true, id: user.id };
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false, error: "Já existe um usuário com este e-mail." };
    }
    return { ok: false, error: e?.message ?? "Falha ao criar o usuário." };
  }
}

export async function updateUser(formData: FormData): Promise<ActionResult> {
  const viewer = await requirePermission("usuarios.editar");
  try {
    // Select de papel desabilitado (sem alterar_permissoes) não é enviado:
    // vazio = manter o papel atual, e não "virar FINANCEIRO" (que era lido
    // como troca de papel e barrava qualquer edição dessa pessoa).
    const papelEnviado = String(formData.get("role") || "");
    const parsed = UpdateSchema.parse({
      id: String(formData.get("id") || ""),
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || "").trim().toLowerCase(),
      password: (formData.get("password") as string) || null,
      role: papelEnviado || "FINANCEIRO",
      active: formData.get("active") !== "false",
      personId: (formData.get("personId") as string) || null,
    });
    const overrides = parseOverrides(formData);

    const target = await prisma.user.findUnique({
      where: { id: parsed.id },
      include: {
        permissions: { select: { permission: true, enabled: true } },
        person: { select: { id: true } },
      },
    });
    if (!target || !isInWorkspace(target, viewer)) {
      return { ok: false, error: "Usuário não encontrado." };
    }
    if (!papelEnviado && isKnownRole(target.role)) parsed.role = target.role;

    // Só ADMIN mexe em contas de ADMIN ou promove alguém a ADMIN.
    if ((target.role === "ADMIN" || parsed.role === "ADMIN") && viewer.role !== "ADMIN") {
      return { ok: false, error: "Apenas administradores podem gerenciar administradores." };
    }

    // Nunca deixar a conta sem administrador ativo.
    if (target.role === "ADMIN" && (parsed.role !== "ADMIN" || !parsed.active)) {
      const guard = await assertNotLastActiveAdmin(target.id);
      if (guard) return { ok: false, error: guard };
    }

    const roleChanged = parsed.role !== target.role;
    const overridesChanged =
      JSON.stringify(
        [...overrides].sort((a, b) => a.permission.localeCompare(b.permission))
      ) !==
      JSON.stringify(
        [...target.permissions]
          .map((p) => ({ permission: p.permission, enabled: p.enabled }))
          .sort((a, b) => a.permission.localeCompare(b.permission))
      );
    const canManagePerms = can(viewer, "usuarios.alterar_permissoes");
    if ((roleChanged || overridesChanged) && !canManagePerms) {
      return { ok: false, error: "Você não tem permissão para alterar papel/permissões." };
    }

    // Trocar e-mail/senha de OUTRA pessoa é tomar a conta dela: usuarios.editar
    // não basta (edita nome, status, vínculo). Exige alterar_permissoes (o
    // ADMIN tem todas). O próprio usuário continua podendo trocar os seus.
    const credenciaisMudam =
      parsed.email !== target.email.toLowerCase() || !!parsed.password;
    if (credenciaisMudam && target.id !== viewer.id && !canManagePerms) {
      return {
        ok: false,
        error: "Você não tem permissão para alterar e-mail ou senha de outro usuário.",
      };
    }

    const data: any = {
      name: parsed.name,
      email: parsed.email,
      active: parsed.active,
    };
    if (canManagePerms) {
      data.role = parsed.role;
      // O recorte anda junto do papel: quem não pode mexer em permissão também
      // não pode alargar o que o outro enxerga.
      Object.assign(data, lerEscopo(formData, parsed.role));
    }
    if (parsed.password) {
      data.passwordHash = await bcrypt.hash(parsed.password, 10);
    }

    // Um único batch com SÓ o que mudou (edições típicas: 1 ida ao banco).
    const ops: any[] = [prisma.user.update({ where: { id: parsed.id }, data })];

    const wantedOverrides = parsed.role === "ADMIN" ? [] : overrides;
    const mustRewriteOverrides =
      canManagePerms && (overridesChanged || (roleChanged && target.permissions.length > 0));
    if (mustRewriteOverrides) {
      ops.push(prisma.userPermission.deleteMany({ where: { userId: parsed.id } }));
      if (wantedOverrides.length > 0) {
        ops.push(
          prisma.userPermission.createMany({
            data: wantedOverrides.map((o) => ({
              userId: parsed.id,
              permission: o.permission,
              enabled: o.enabled,
            })),
          })
        );
      }
    }

    // Vínculo com Person: só sincroniza se de fato mudou.
    const currentPersonId = target.person?.id ?? null;
    if (parsed.personId !== currentPersonId) {
      // 1. desvincula qualquer Person que apontava para esse user mas não é a selecionada
      ops.push(
        prisma.person.updateMany({
          where: { userId: parsed.id, NOT: parsed.personId ? { id: parsed.personId } : undefined },
          data: { userId: null },
        })
      );
      // 2. vincula a Person selecionada (updateMany: escopado por dono)
      if (parsed.personId) {
        ops.push(
          prisma.person.updateMany({
            where: { id: parsed.personId },
            data: { userId: parsed.id },
          })
        );
      }
    }

    await prisma.$transaction(ops);

    revalidateAdmin();
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    if (e?.code === "P2002") {
      return { ok: false, error: "Já existe um usuário com este e-mail." };
    }
    return { ok: false, error: e?.message ?? "Falha ao salvar o usuário." };
  }
}

export async function deleteUser(id: string): Promise<ActionResult> {
  const viewer = await requirePermission("usuarios.excluir");
  try {
    if (id === viewer.id) {
      return { ok: false, error: "Você não pode excluir o próprio usuário." };
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || !isInWorkspace(target, viewer)) {
      return { ok: false, error: "Usuário não encontrado." };
    }
    if (target.role === "ADMIN") {
      if (viewer.role !== "ADMIN") {
        return { ok: false, error: "Apenas administradores podem excluir administradores." };
      }
      const guard = await assertNotLastActiveAdmin(id);
      if (guard) return { ok: false, error: guard };
    }

    // Solta vínculo de Person, se houver
    await prisma.person.updateMany({ where: { userId: id }, data: { userId: null } });
    await prisma.user.delete({ where: { id } });
    revalidateAdmin();
    revalidateFinance();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Falha ao excluir o usuário." };
  }
}

