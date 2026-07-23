import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { UserDialog } from "./user-dialog";
import { UsersList, type UserRow } from "./users-list";
import { requirePagePermission, can } from "@/lib/auth/viewer";

export default async function UsuariosPage() {
  const viewer = await requirePagePermission("usuarios.visualizar");
  // Mostra apenas a equipe DESTE workspace (dono + membros).
  const root = viewer.workspaceOwnerId ?? viewer.id;

  const [users, peopleAll] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ id: root }, { workspaceOwnerId: root }] },
      orderBy: { createdAt: "asc" },
      include: {
        person: true,
        permissions: { select: { permission: true, enabled: true } },
      },
    }),
    prisma.person.findMany({ orderBy: { name: "asc" } }),
  ]);

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    personId: u.person?.id ?? null,
    personName: u.person?.name ?? null,
    permissions: u.permissions,
  }));

  const admins = rows.filter((u) => u.role === "ADMIN").length;
  const ativos = rows.filter((u) => u.active).length;
  const vinculados = rows.filter((u) => u.personId).length;

  const canCreate = can(viewer, "usuarios.criar");
  const canEdit = can(viewer, "usuarios.editar");
  const canDelete = can(viewer, "usuarios.excluir");
  const canManagePermissions = can(viewer, "usuarios.alterar_permissoes");

  return (
    <div>
      <PageHeader
        title="Usuários"
        description="Equipe, papéis e permissões de acesso à plataforma."
        actions={
          canCreate ? (
            <UserDialog people={peopleAll} canManagePermissions={canManagePermissions} />
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Usuários" value={String(rows.length)} />
        <StatCard title="Administradores" value={String(admins)} />
        <StatCard title="Ativos" value={String(ativos)} intent="positive" />
        <StatCard title="Vinculados" value={String(vinculados)} />
      </div>

      <UsersList
        users={rows}
        people={peopleAll}
        canEdit={canEdit}
        canDelete={canDelete}
        canManagePermissions={canManagePermissions}
      />
    </div>
  );
}
