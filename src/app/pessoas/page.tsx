import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { PersonDialog } from "./person-dialog";
import { PeopleList, type PersonRow } from "./people-list";
import { getViewer } from "@/lib/auth/viewer";

const OPEN_RECEIVABLE = ["aberto", "atrasado", "renegociado"];

export default async function PessoasPage() {
  await getViewer("/pessoas");

  // Consultas agregadas (evita N+1): 1 lista + 2 groupBy — escopadas por dono.
  const [people, gastoByPerson, recvByPerson] = await Promise.all([
    prisma.person.findMany({ orderBy: { name: "asc" }, include: { user: true } }),
    prisma.transaction.groupBy({
      by: ["responsibleId"],
      where: { type: "despesa", status: { not: "cancelado" }, responsibleId: { not: null } },
      _sum: { amount: true },
    }),
    prisma.receivable.groupBy({
      by: ["personId", "status"],
      _sum: { amount: true },
    }),
  ]);

  const gastoMap = new Map<string, number>();
  for (const g of gastoByPerson) {
    if (g.responsibleId) gastoMap.set(g.responsibleId, g._sum.amount ?? 0);
  }

  const aReceberMap = new Map<string, number>();
  const pagoMap = new Map<string, number>();
  for (const r of recvByPerson) {
    const amt = r._sum.amount ?? 0;
    if (OPEN_RECEIVABLE.includes(r.status)) {
      aReceberMap.set(r.personId, (aReceberMap.get(r.personId) ?? 0) + amt);
    } else if (r.status === "pago") {
      pagoMap.set(r.personId, (pagoMap.get(r.personId) ?? 0) + amt);
    }
  }

  const rows: PersonRow[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    notes: p.notes,
    userEmail: p.user?.email ?? null,
    totalGasto: gastoMap.get(p.id) ?? 0,
    aReceber: aReceberMap.get(p.id) ?? 0,
    pago: pagoMap.get(p.id) ?? 0,
  }));

  // Resumo global
  const totalGasto = rows.reduce((s, r) => s + r.totalGasto, 0);
  const totalDevendo = rows.reduce((s, r) => s + r.aReceber, 0);
  const totalPago = rows.reduce((s, r) => s + r.pago, 0);

  return (
    <div>
      <PageHeader
        title="Pessoas"
        description="Cadastre e acompanhe gastos, dívidas e pagamentos por pessoa."
        actions={<PersonDialog />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Pessoas" value={String(rows.length)} />
        <StatCard title="Total gasto" value={formatBRL(totalGasto)} intent="negative" />
        <StatCard title="Devendo a você" value={formatBRL(totalDevendo)} intent="warning" />
        <StatCard title="Já pago" value={formatBRL(totalPago)} intent="positive" />
      </div>

      <PeopleList people={rows} />
    </div>
  );
}
