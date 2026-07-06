import { PageHeader } from "@/components/page-header";
import { SavedViews } from "@/components/saved-views";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, parseDateBR } from "@/lib/format";
import {
  mrrAtivo,
  tcvVendido,
  receitaReconhecidaMes,
  vencidosWhere,
} from "@/lib/services/contract-metrics";
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
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import { ContractDialog } from "./contract-dialog";
import { ContractActions } from "./row-actions";
import { ContractFilters } from "./filters";
import { GenerateAllButton } from "./generate-all-button";
import { GenerateClientBillingsButton } from "./generate-client-billings";
import { CobrancasTabs } from "@/app/cobrancas/module-tabs";
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_TYPE_LABEL,
  contractStatusVariant,
} from "./_meta";

type Search = {
  status?: string;
  tipo?: string;
  cliente?: string;
  servico?: string;
  renovacao?: string;
  vencidos?: string;
  inicioDe?: string;
  inicioAte?: string;
  fimDe?: string;
  fimAte?: string;
};

function dateRange(de?: string, ate?: string) {
  const range: any = {};
  const d = de ? parseDateBR(de) : null;
  const a = ate ? parseDateBR(ate) : null;
  if (d) range.gte = d;
  if (a) {
    a.setDate(a.getDate() + 1);
    range.lt = a;
  }
  return Object.keys(range).length ? range : undefined;
}

export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireAdmin();

  const where: any = {};
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.tipo) where.type = searchParams.tipo;
  if (searchParams.cliente) where.clientId = searchParams.cliente;
  if (searchParams.servico) {
    where.services = { some: { serviceId: searchParams.servico } };
  }
  const inicio = dateRange(searchParams.inicioDe, searchParams.inicioAte);
  if (inicio) where.startDate = inicio;
  const fim = dateRange(searchParams.fimDe, searchParams.fimAte);
  if (fim) where.endDate = fim;
  // Janela de renovação: 30 → até 30d; 60 → 31–60d; 90 → 61–90d.
  const renewWindow = (dias: number) => {
    const from = new Date();
    if (dias > 30) from.setDate(from.getDate() + (dias - 30));
    const to = new Date();
    to.setDate(to.getDate() + dias);
    return { from, to };
  };
  if (searchParams.renovacao) {
    const dias = parseInt(searchParams.renovacao, 10) || 30;
    const { from, to } = renewWindow(dias);
    where.status = { in: ["ACTIVE", "RENEWAL"] };
    where.renewalDate = dias > 30 ? { gt: from, lte: to } : { not: null, lte: to };
  }
  if (searchParams.vencidos === "1") {
    Object.assign(where, vencidosWhere());
  }

  const anoInicio = new Date(new Date().getFullYear(), 0, 1);
  const anoFim = new Date(new Date().getFullYear() + 1, 0, 1);

  // Contagens das janelas de vencimento (contratos ativos com renovação marcada)
  const renewCount = (dias: number) => {
    const { from, to } = renewWindow(dias);
    return prisma.contract.count({
      where: {
        status: { in: ["ACTIVE", "RENEWAL"] },
        renewalDate: dias > 30 ? { gt: from, lte: to } : { not: null, lte: to },
      },
    });
  };

  const [contractsRaw, clients, servicesRaw, mrr, tcvAno, reconhecida, renov30, renov60, renov90] =
    await Promise.all([
      prisma.contract.findMany({
        where,
        orderBy: [{ status: "asc" }, { startDate: "desc" }],
        take: 200,
        include: {
          client: { select: { id: true, name: true } },
          services: { include: { service: { select: { name: true } } } },
        },
      }),
      prisma.client.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.service.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, defaultPrice: true },
      }),
      mrrAtivo(),
      tcvVendido(anoInicio, anoFim),
      receitaReconhecidaMes(),
      renewCount(30),
      renewCount(60),
      renewCount(90),
    ]);

  // Serializações Decimal → number para componentes client
  const contracts = contractsRaw.map((c) => ({
    ...c,
    monthlyValue: Number(c.monthlyValue),
    totalValue: Number(c.totalValue),
    setupFee: c.setupFee != null ? Number(c.setupFee) : null,
    services: c.services.map((s) => ({
      serviceId: s.serviceId,
      unitPrice: Number(s.unitPrice),
      name: s.service.name,
    })),
  }));
  const services = servicesRaw.map((s) => ({
    id: s.id,
    name: s.name,
    defaultPrice: s.defaultPrice != null ? Number(s.defaultPrice) : null,
  }));

  const today = new Date();
  const isVencido = (c: (typeof contracts)[number]) =>
    ["ACTIVE", "RENEWAL"].includes(c.status) &&
    ((c.endDate && new Date(c.endDate) < today) ||
      (c.renewalDate && new Date(c.renewalDate) < today));

  return (
    <div>
      <PageHeader
        title="Acordos comerciais"
        description="Contratos MRR/TCV que alimentam as cobranças — tudo no mesmo hub de receita"
        actions={
          <div className="flex flex-wrap gap-2">
            <GenerateAllButton />
            <ContractDialog clients={clients} services={services} />
          </div>
        }
      />

      <CobrancasTabs active="/acordos" />

      <div className="mb-3 print:hidden">
        <SavedViews module="acordos" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <StatCard title="MRR ativo" value={formatBRL(mrr)} intent="positive"
          hint="recorrência mensal vigente" />
        <StatCard title={`TCV vendido (${today.getFullYear()})`} value={formatBRL(tcvAno)}
          hint="valor contratado no ano" />
        <StatCard title="Reconhecida no mês" value={formatBRL(reconhecida)}
          hint="competência (independe do caixa)" />
      </div>

      {/* Contratos a vencer — clique filtra a lista pela janela */}
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
        Contratos a vencer
      </h2>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard
          href="/acordos?renovacao=30"
          title="Próximos 30 dias"
          value={String(renov30)}
          intent={renov30 > 0 ? "negative" : "default"}
          hint="renovar agora"
        />
        <StatCard
          href="/acordos?renovacao=60"
          title="31 a 60 dias"
          value={String(renov60)}
          intent={renov60 > 0 ? "warning" : "default"}
          hint="preparar renovação"
        />
        <StatCard
          href="/acordos?renovacao=90"
          title="61 a 90 dias"
          value={String(renov90)}
          hint="no radar"
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <ContractFilters
            clients={clients.map((c) => ({ value: c.id, label: c.name }))}
            services={services.map((s) => ({ value: s.id, label: s.name }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">TCV</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Renovação</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                      Nenhum contrato encontrado. Crie o primeiro contrato para
                      começar a medir MRR e TCV.
                    </TableCell>
                  </TableRow>
                )}
                {contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium max-w-[220px]">
                      <span className="truncate block">{c.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.services.map((s) => s.name).join(", ") || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link href={`/clientes/${c.client.id}`} className="hover:underline font-medium block">
                        {c.client.name}
                      </Link>
                      {["ACTIVE", "RENEWAL", "OVERDUE", "PENDING"].includes(c.status) && (
                        <span className="mt-1 block">
                          <GenerateClientBillingsButton contractId={c.id} />
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{CONTRACT_TYPE_LABEL[c.type] ?? c.type}</TableCell>
                    <TableCell className="text-right">
                      {c.monthlyValue > 0 ? formatBRL(c.monthlyValue) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.totalValue > 0 ? formatBRL(c.totalValue) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateBR(c.startDate)}
                      {c.endDate ? ` → ${formatDateBR(c.endDate)}` : " → sem fim"}
                    </TableCell>
                    <TableCell>
                      {c.renewalDate ? formatDateBR(c.renewalDate) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          isVencido(c) ? "destructive" : contractStatusVariant(c.status)
                        }
                      >
                        {isVencido(c) ? "Vencido" : CONTRACT_STATUS_LABEL[c.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <ContractActions
                        contract={c}
                        clients={clients}
                        services={services}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCards>
            {contracts.length === 0 ? (
              <MobileEmpty>
                Nenhum contrato encontrado. Crie o primeiro contrato para começar a
                medir MRR e TCV.
              </MobileEmpty>
            ) : (
              contracts.map((c) => (
                <MobileCard key={c.id}>
                  <MobileCardHeader
                    title={c.title}
                    aside={
                      <Badge
                        variant={
                          isVencido(c) ? "destructive" : contractStatusVariant(c.status)
                        }
                      >
                        {isVencido(c) ? "Vencido" : CONTRACT_STATUS_LABEL[c.status]}
                      </Badge>
                    }
                  />
                  <div className="space-y-1.5">
                    <Field label="Cliente">{c.client.name}</Field>
                    <Field label="Tipo">{CONTRACT_TYPE_LABEL[c.type] ?? c.type}</Field>
                    <Field label="Mensal">
                      {c.monthlyValue > 0 ? formatBRL(c.monthlyValue) : "—"}
                    </Field>
                    <Field label="TCV">
                      {c.totalValue > 0 ? formatBRL(c.totalValue) : "—"}
                    </Field>
                    <Field label="Vigência">
                      {formatDateBR(c.startDate)}
                      {c.endDate ? ` → ${formatDateBR(c.endDate)}` : " → sem fim"}
                    </Field>
                    <Field label="Renovação">
                      {c.renewalDate ? formatDateBR(c.renewalDate) : "—"}
                    </Field>
                  </div>
                  {["ACTIVE", "RENEWAL", "OVERDUE", "PENDING"].includes(c.status) && (
                    <GenerateClientBillingsButton contractId={c.id} />
                  )}
                  <MobileCardActions>
                    <ContractActions
                      contract={c}
                      clients={clients}
                      services={services}
                    />
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
