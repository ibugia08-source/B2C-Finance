import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { requireAdmin } from "@/lib/auth/viewer";
import { PlanDialog } from "./plan-dialog";
import { PlanActions } from "./row-actions";
import { CONTRACT_TYPE_LABEL, RECURRENCE_LABEL } from "@/app/contratos/_meta";

export default async function PlanosPage() {
  await requireAdmin();

  const [plansRaw, services, contractCounts] = await Promise.all([
    prisma.plan.findMany({
      orderBy: [{ active: "desc" }, { monthlyPrice: "asc" }],
      include: { services: { include: { service: true } } },
    }),
    prisma.service.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.contract.groupBy({
      by: ["planId"],
      where: { planId: { not: null }, status: { in: ["ACTIVE", "RENEWAL"] } },
      _count: { _all: true },
    }),
  ]);
  const inUse = new Map(contractCounts.map((c) => [c.planId, c._count._all]));

  const plans = plansRaw.map((p) => ({
    ...p,
    monthlyPrice: Number(p.monthlyPrice),
    setupFee: p.setupFee != null ? Number(p.setupFee) : null,
  }));

  return (
    <div>
      <PageHeader
        title="Planos"
        description="Planos comerciais da agência"
        actions={<PlanDialog services={services} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <StatCard
          title="Planos ativos"
          value={String(plans.filter((p) => p.active).length)}
          intent="positive"
        />
        <StatCard title="Total" value={String(plans.length)} />
        <StatCard
          title="Com contratos vigentes"
          value={String(inUse.size)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plano</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Periodicidade</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Setup</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Serviços</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                      Nenhum plano cadastrado. Crie planos comerciais (Básico,
                      Avançado, Completo…) para agilizar a criação de contratos.
                    </TableCell>
                  </TableRow>
                )}
                {plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{CONTRACT_TYPE_LABEL[p.type] ?? p.type}</TableCell>
                    <TableCell>{RECURRENCE_LABEL[p.recurrence] ?? p.recurrence}</TableCell>
                    <TableCell className="text-right">{formatBRL(p.monthlyPrice)}</TableCell>
                    <TableCell className="text-right">
                      {p.setupFee != null ? formatBRL(p.setupFee) : "—"}
                    </TableCell>
                    <TableCell>
                      {p.defaultDuration ? `${p.defaultDuration} meses` : "—"}
                    </TableCell>
                    <TableCell className="max-w-[200px] text-sm">
                      {p.services.map((s) => s.service.name).join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.active ? "success" : "secondary"}>
                        {p.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <PlanActions plan={p} services={services} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCards>
            {plans.length === 0 ? (
              <MobileEmpty>
                Nenhum plano cadastrado. Crie planos comerciais para agilizar os
                contratos.
              </MobileEmpty>
            ) : (
              plans.map((p) => (
                <MobileCard key={p.id}>
                  <MobileCardHeader
                    title={p.name}
                    aside={
                      <span className="font-semibold">{formatBRL(p.monthlyPrice)}</span>
                    }
                  />
                  <div className="space-y-1.5">
                    <Field label="Tipo">{CONTRACT_TYPE_LABEL[p.type] ?? p.type}</Field>
                    <Field label="Periodicidade">
                      {RECURRENCE_LABEL[p.recurrence] ?? p.recurrence}
                    </Field>
                    <Field label="Setup">
                      {p.setupFee != null ? formatBRL(p.setupFee) : "—"}
                    </Field>
                    <Field label="Serviços">
                      {p.services.map((s) => s.service.name).join(", ") || "—"}
                    </Field>
                  </div>
                  <MobileCardActions>
                    <PlanActions plan={p} services={services} />
                  </MobileCardActions>
                </MobileCard>
              ))
            )}
          </MobileCards>
        </CardContent>
      </Card>
    </div>
  );
}
