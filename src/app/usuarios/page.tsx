import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { UserDialog } from "./user-dialog";
import { UsersList, type UserRow } from "./users-list";
import { requireAdmin } from "@/lib/auth/viewer";

export default async function UsuariosPage() {
  await requireAdmin();

  const [users, peopleAll] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      include: { person: true },
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
  }));

  const admins = rows.filter((u) => u.role === "ADMIN").length;
  const ativos = rows.filter((u) => u.active).length;
  const vinculados = rows.filter((u) => u.personId).length;

  return (
    <div>
      <PageHeader
        title="Usuários"
        description="Cadastro de acesso e vínculo com pessoas financeiras."
        actions={<UserDialog people={peopleAll} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Usuários" value={String(rows.length)} />
        <StatCard title="Administradores" value={String(admins)} />
        <StatCard title="Ativos" value={String(ativos)} intent="positive" />
        <StatCard title="Vinculados" value={String(vinculados)} />
      </div>

      <UsersList users={rows} people={peopleAll} />
    </div>
  );
}
