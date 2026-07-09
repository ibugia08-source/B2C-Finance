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
import { OfferDialog } from "./offer-dialog";
import { OfferActions } from "./row-actions";

const MODALITY_LABEL: Record<string, string> = {
  MRR: "MRR",
  TCV: "TCV",
  CUSTOM: "Personalizado",
};

export default async function OfertasPage() {
  await requireAdmin();

  const [offersRaw, services] = await Promise.all([
    prisma.offer.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        services: { select: { serviceId: true, service: { select: { name: true } } } },
      },
    }),
    prisma.service.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Serializa Decimal → number para os componentes client.
  const offers = offersRaw.map((o) => ({
    ...o,
    defaultValue: o.defaultValue != null ? Number(o.defaultValue) : null,
    serviceNames: o.services.map((s) => s.service.name),
    serviceIds: o.services.map((s) => s.serviceId),
    services: undefined,
  }));

  const ativas = offers.filter((o) => o.active).length;

  return (
    <div>
      <PageHeader
        title="Planos (Ofertas)"
        description="Pacotes comerciais: junção de serviços com valor, modalidade e duração"
        actions={<OfferDialog services={services} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <StatCard title="Ofertas ativas" value={String(ativas)} intent="positive" />
        <StatCard title="Total de ofertas" value={String(offers.length)} />
        <StatCard
          title="Serviços no catálogo"
          value={String(services.length)}
          hint="disponíveis para compor ofertas"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Oferta</TableHead>
                  <TableHead>Serviços incluídos</TableHead>
                  <TableHead>Modalidade</TableHead>
                  <TableHead className="text-right">Valor padrão</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                      Nenhuma oferta cadastrada. Crie a primeira juntando serviços do
                      catálogo com um valor (ex.: &quot;Avançado Óticas&quot;).
                    </TableCell>
                  </TableRow>
                )}
                {offers.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">
                      {o.name}
                      {o.description && (
                        <p className="text-xs text-muted-foreground max-w-xs truncate">
                          {o.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      {o.serviceNames.length ? (
                        <span className="text-sm">{o.serviceNames.join(", ")}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={o.modality === "MRR" ? "default" : "secondary"}>
                        {MODALITY_LABEL[o.modality] ?? o.modality}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {o.defaultValue != null ? formatBRL(o.defaultValue) : "—"}
                    </TableCell>
                    <TableCell>
                      {o.durationMonths != null ? `${o.durationMonths} meses` : "—"}
                    </TableCell>
                    <TableCell>{o.paymentMethod ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={o.active ? "success" : "secondary"}>
                        {o.active ? "Ativa" : "Inativa"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <OfferActions offer={o} services={services} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCards>
            {offers.length === 0 ? (
              <MobileEmpty>
                Nenhuma oferta cadastrada. Crie a primeira juntando serviços do
                catálogo com um valor.
              </MobileEmpty>
            ) : (
              offers.map((o) => (
                <MobileCard key={o.id}>
                  <MobileCardHeader
                    title={o.name}
                    aside={
                      <Badge variant={o.active ? "success" : "secondary"}>
                        {o.active ? "Ativa" : "Inativa"}
                      </Badge>
                    }
                  />
                  <div className="space-y-1.5">
                    <Field label="Serviços">
                      {o.serviceNames.length ? o.serviceNames.join(", ") : "—"}
                    </Field>
                    <Field label="Modalidade">{MODALITY_LABEL[o.modality] ?? o.modality}</Field>
                    <Field label="Valor padrão">
                      {o.defaultValue != null ? formatBRL(o.defaultValue) : "—"}
                    </Field>
                    <Field label="Duração">
                      {o.durationMonths != null ? `${o.durationMonths} meses` : "—"}
                    </Field>
                    <Field label="Pagamento">{o.paymentMethod ?? "—"}</Field>
                  </div>
                  <MobileCardActions>
                    <OfferActions offer={o} services={services} />
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
