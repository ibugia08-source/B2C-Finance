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

/** Raiz do workspace do viewer (dono dos dados que ele enxerga). */
function workspaceRootOf(viewer: Viewer): string {
  return viewer.workspaceOwnerId ?? viewer.id;
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
    const parsed = CreateSchema.parse({
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || "").trim().toLowerCase(),
      password: String(formData.get("password") || ""),
      role: String(formData.get("role") || "FINANCEIRO"),
      active: formData.get("active") !== "false",
      personId: (formData.get("personId") as string) || null,
    });
    const overrides = parseOverrides(formData);

    // Escalada de privilégio: só ADMIN cria outro ADMIN; papel/ajustes além do
    // padrão exigem a permissão de alterar permissões.
    if (parsed.role === "ADMIN" && viewer.role !== "ADMIN") {
      return { ok: false, error: "Apenas administradores podem criar administradores." };
    }
    if (overrides.length > 0 && !can(viewer, "usuarios.alterar_permissoes")) {
      return { ok: false, error: "Você não tem permissão para ajustar permissões." };
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
      // Garante 1:1 — desfaz vínculo anterior dessa Person
      followUps.push(
        prisma.person.update({
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
    const parsed = UpdateSchema.parse({
      id: String(formData.get("id") || ""),
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || "").trim().toLowerCase(),
      password: (formData.get("password") as string) || null,
      role: String(formData.get("role") || "FINANCEIRO"),
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
    if (!target) return { ok: false, error: "Usuário não encontrado." };

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

    const data: any = {
      name: parsed.name,
      email: parsed.email,
      active: parsed.active,
    };
    if (canManagePerms) data.role = parsed.role;
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
      // 2. vincula a Person selecionada
      if (parsed.personId) {
        ops.push(
          prisma.person.update({
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
    if (!target) return { ok: false, error: "Usuário não encontrado." };
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

export async function linkPersonToUser(personId: string, userId: string | null) {
  await requirePermission("usuarios.editar");
  if (userId) {
    // Desfaz vínculo anterior do mesmo user a outra pessoa
    await prisma.person.updateMany({
      where: { userId, NOT: { id: personId } },
      data: { userId: null },
    });
  }
  await prisma.person.update({
    where: { id: personId },
    data: { userId },
  });
  revalidateAdmin();
  revalidateFinance({ personId });
}
