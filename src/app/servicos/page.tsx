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
import { ServiceDialog } from "./service-dialog";
import { ServiceActions } from "./row-actions";

export default async function ServicosPage() {
  await requireAdmin();

  const [servicesRaw, contractCounts] = await Promise.all([
    prisma.service.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.contractService.groupBy({
      by: ["serviceId"],
      where: { contract: { status: { in: ["ACTIVE", "RENEWAL"] } } },
      _count: { _all: true },
    }),
  ]);
  const inUse = new Map(contractCounts.map((c) => [c.serviceId, c._count._all]));

  const services = servicesRaw.map((s) => ({
    ...s,
    defaultPrice: s.defaultPrice != null ? Number(s.defaultPrice) : null,
    estimatedCost: s.estimatedCost != null ? Number(s.estimatedCost) : null,
  }));
  const ativos = services.filter((s) => s.active).length;

  return (
    <div>
      <PageHeader
        title="Serviços"
        description="Catálogo de serviços da agência"
        actions={<ServiceDialog />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <StatCard title="Serviços ativos" value={String(ativos)} intent="positive" />
        <StatCard title="Total no catálogo" value={String(services.length)} />
        <StatCard
          title="Em contratos vigentes"
          value={String(inUse.size)}
          hint="serviços vinculados a contratos ativos"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serviço</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Valor base</TableHead>
                  <TableHead className="text-right">Custo estimado</TableHead>
                  <TableHead>Responsável padrão</TableHead>
                  <TableHead>Contratos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                      Nenhum serviço cadastrado. Comece criando os serviços que a
                      agência oferece (Meta Ads, Google Ads, Social Media…).
                    </TableCell>
                  </TableRow>
                )}
                {services.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.name}
                      {s.description && (
                        <p className="text-xs text-muted-foreground max-w-xs truncate">
                          {s.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{s.category ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {s.defaultPrice != null ? formatBRL(s.defaultPrice) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.estimatedCost != null ? formatBRL(s.estimatedCost) : "—"}
                    </TableCell>
                    <TableCell>{s.defaultOwner ?? "—"}</TableCell>
                    <TableCell>{inUse.get(s.id) ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={s.active ? "success" : "secondary"}>
                        {s.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <ServiceActions service={s} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCards>
            {services.length === 0 ? (
              <MobileEmpty>
                Nenhum serviço cadastrado. Comece criando os serviços que a agência
                oferece.
              </MobileEmpty>
            ) : (
              services.map((s) => (
                <MobileCard key={s.id}>
                  <MobileCardHeader
                    title={s.name}
                    aside={
                      <Badge variant={s.active ? "success" : "secondary"}>
                        {s.active ? "Ativo" : "Inativo"}
                      </Badge>
                    }
                  />
                  <div className="space-y-1.5">
                    <Field label="Categoria">{s.category ?? "—"}</Field>
                    <Field label="Valor base">
                      {s.defaultPrice != null ? formatBRL(s.defaultPrice) : "—"}
                    </Field>
                    <Field label="Custo estimado">
                      {s.estimatedCost != null ? formatBRL(s.estimatedCost) : "—"}
                    </Field>
                    <Field label="Responsável">{s.defaultOwner ?? "—"}</Field>
                    <Field label="Contratos ativos">{inUse.get(s.id) ?? 0}</Field>
                  </div>
                  <MobileCardActions>
                    <ServiceActions service={s} />
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
