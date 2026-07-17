import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDateBR } from "@/lib/format";
import { getClientSummaries } from "@/lib/services/client-metrics";
import { FileSignature, Download } from "lucide-react";
import { ClientDialog } from "../client-dialog";
import { ContactDialog, ContactActions } from "./contact-dialog";
import { CLIENT_STATUS_LABEL, clientStatusVariant } from "../_meta";
import {
  AttachDocumentDialog,
  DocumentDeleteButton,
  NoteDialog,
  NoteActions,
} from "./dossier-dialogs";
import { GeneratedContractActions } from "@/app/contratos/generated-actions";
import {
  GENERATED_STATUS_LABEL,
  generatedStatusVariant,
  DOCUMENT_TYPE_LABEL,
  NOTE_TYPE_LABEL,
} from "@/app/contratos/_meta";

const BILLING_STATUS: Record<string, { label: string; variant: any }> = {
  PENDING: { label: "Em aberto", variant: "warning" },
  PARTIAL: { label: "Parcial", variant: "warning" },
  PAID: { label: "Paga", variant: "success" },
  OVERDUE: { label: "Vencida", variant: "destructive" },
  CANCELED: { label: "Cancelada", variant: "secondary" },
};
const CONTRACT_STATUS: Record<string, { label: string; variant: any }> = {
  PENDING: { label: "Pendente", variant: "secondary" },
  ACTIVE: { label: "Ativo", variant: "success" },
  RENEWAL: { label: "Em renovação", variant: "warning" },
  OVERDUE: { label: "Vencido", variant: "destructive" },
  ENDED: { label: "Encerrado", variant: "outline" },
  CANCELED: { label: "Cancelado", variant: "outline" },
};
const PAYMENT_METHOD: Record<string, string> = {
  PIX: "Pix",
  TRANSFER: "Transferência",
  BOLETO: "Boleto",
  CARD: "Cartão",
  CASH: "Dinheiro",
  OTHER: "Outro",
};
const COLLECTION_STATUS: Record<string, string> = {
  NOT_CONTACTED: "Sem contato",
  CONTACTED: "Contatado",
  PROMISED: "Prometeu pagar",
  PAID: "Pago",
  IGNORED: "Sem resposta",
  ESCALATED: "Escalado",
};

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: string };
}) {
  await requireAdmin();

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
    },
  });
  if (!client) notFound();

  const [
    contracts,
    billings,
    payments,
    history,
    incomes,
    summaryMap,
    generatedContracts,
    documents,
    contextNotes,
  ] =
    await Promise.all([
      prisma.contract.findMany({
        where: { clientId: client.id },
        orderBy: [{ status: "asc" }, { startDate: "desc" }],
        include: { services: { include: { service: true } } },
      }),
      prisma.billing.findMany({
        where: { clientId: client.id },
        orderBy: { dueDate: "desc" },
        take: 60,
      }),
      prisma.payment.findMany({
        where: { billing: { clientId: client.id } },
        orderBy: { paidAt: "desc" },
        take: 60,
        include: { billing: { select: { description: true } }, account: true },
      }),
      prisma.collectionHistory.findMany({
        where: { clientId: client.id },
        orderBy: { contactedAt: "desc" },
        take: 40,
      }),
      prisma.income.findMany({
        where: { clientId: client.id },
        orderBy: { receivedAt: "desc" },
        take: 40,
      }),
      getClientSummaries([params.id]),
      prisma.generatedContract.findMany({
        where: { clientId: params.id },
        orderBy: { generatedAt: "desc" },
        include: { template: { select: { name: true } } },
      }),
      prisma.clientDocument.findMany({
        where: { clientId: params.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.clientNote.findMany({
        where: { clientId: params.id },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

  const summary = summaryMap.get(client.id)!;

  const serial = {
    ...client,
    monthlyValue: client.monthlyValue != null ? Number(client.monthlyValue) : null,
  };

  const activeServiceNames =
    summary.activeServices.length > 0 ? summary.activeServices : [];

  // A aba ativa vem da URL (?tab=) — a barra de abas é a TabsNavigation do
  // layout (header persistente). Aliases antigos continuam funcionando.
  const TAB_ALIAS: Record<string, string> = {
    "dados-principais": "visao-geral",
    "dados-fiscais": "visao-geral",
    recebimentos: "cobrancas",
    notas: "contexto",
  };
  const VALID_TABS = [
    "visao-geral", "contratos", "documentos", "cobrancas",
    "pagamentos", "servicos", "historico", "contexto",
  ];
  const rawTab = searchParams?.tab ?? "visao-geral";
  const activeTab = VALID_TABS.includes(rawTab)
    ? rawTab
    : TAB_ALIAS[rawTab] ?? "visao-geral";

  return (
    <div>
      {/* Header, mini-dashboard e barra de abas vivem no layout (client-header
          + tabs-navigation) — esta página renderiza SÓ o conteúdo da aba. */}
      <Tabs value={activeTab}>

        {/* ---------- Visão geral ---------- */}
        <TabsContent value="visao-geral">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5 space-y-2">
                <h2 className="font-semibold mb-2">Dados cadastrais</h2>
                <Info label="Status">
                  <Badge variant={clientStatusVariant(client.status)}>
                    {CLIENT_STATUS_LABEL[client.status]}
                  </Badge>
                </Info>
                <Info label="Razão social">{client.legalName ?? "—"}</Info>
                <Info label="CNPJ / CPF">{client.document ?? "—"}</Info>
                <Info label="Segmento">{client.segment ?? "—"}</Info>
                <Info label="Cidade/UF">
                  {client.city ? `${client.city}${client.state ? `/${client.state}` : ""}` : "—"}
                </Info>
                <Info label="Origem">{client.origin ?? "—"}</Info>
                <Info label="Resp. comercial">{client.salesOwner ?? "—"}</Info>
                <Info label="Resp. operacional">{client.opsOwner ?? "—"}</Info>
                <Info label="Dia de pagamento">
                  {client.paymentDay != null ? `dia ${client.paymentDay}` : "—"}
                </Info>
                <Info label="Entrada">
                  {client.startedAt ? formatDateBR(client.startedAt) : "—"}
                </Info>
                {client.churnedAt && (
                  <Info label="Saída (churn)">{formatDateBR(client.churnedAt)}</Info>
                )}
                <Info label="E-mail">{client.email ?? "—"}</Info>
                <Info label="WhatsApp">{client.phone ?? "—"}</Info>
                {client.tags.length > 0 && (
                  <Info label="Tags">
                    <span className="flex flex-wrap gap-1 justify-end">
                      {client.tags.map((t) => (
                        <Badge key={t} variant="outline">
                          {t}
                        </Badge>
                      ))}
                    </span>
                  </Info>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold">Contatos</h2>
                  <ContactDialog clientId={client.id} />
                </div>
                {client.contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Nenhum contato cadastrado ainda.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {client.contacts.map((ct) => (
                      <div
                        key={ct.id}
                        className="flex items-start justify-between gap-2 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-sm">
                            {ct.name}{" "}
                            {ct.isPrimary && <Badge variant="default">principal</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[ct.role, ct.email, ct.phone].filter(Boolean).join(" · ") ||
                              "—"}
                          </p>
                        </div>
                        <ContactActions contact={ct} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------- Contratos ---------- */}
        <TabsContent value="contratos">
          <Card>
            <CardContent className="p-0">
              {contracts.length === 0 ? (
                <Empty>
                  Nenhum contrato cadastrado para este cliente. O módulo de
                  contratos (criação e renovação) chega na próxima etapa.
                </Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Mensal</TableHead>
                      <TableHead className="text-right">Total (TCV)</TableHead>
                      <TableHead>Início</TableHead>
                      <TableHead>Renovação</TableHead>
                      <TableHead>Serviços</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contracts.map((ct) => (
                      <TableRow key={ct.id}>
                        <TableCell className="font-medium">
                          {ct.title}
                        </TableCell>
                        <TableCell>
                          <Badge variant={CONTRACT_STATUS[ct.status]?.variant ?? "secondary"}>
                            {CONTRACT_STATUS[ct.status]?.label ?? ct.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatBRL(Number(ct.monthlyValue))}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatBRL(Number(ct.totalValue))}
                        </TableCell>
                        <TableCell>{formatDateBR(ct.startDate)}</TableCell>
                        <TableCell>
                          {ct.renewalDate ? formatDateBR(ct.renewalDate) : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {ct.services.map((s) => s.service.name).join(", ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Documentos e Contratos ---------- */}
        <TabsContent value="documentos">
          <div className="space-y-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold">Contratos gerados</h2>
                  <Button size="sm" asChild>
                    <Link href={`/contratos?para=${client.id}`}>
                      <FileSignature className="h-3.5 w-3.5 mr-1" /> Gerar novo contrato
                    </Link>
                  </Button>
                </div>
                {generatedContracts.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Este cliente ainda não possui contratos gerados.
                    <br />
                    Você pode gerar um novo contrato a partir de um modelo cadastrado.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {generatedContracts.map((g) => (
                      <div
                        key={g.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{g.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {g.template?.name ? `modelo ${g.template.name} · ` : ""}
                            gerado em {formatDateBR(g.generatedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={generatedStatusVariant(g.status)}>
                            {GENERATED_STATUS_LABEL[g.status]}
                          </Badge>
                          <GeneratedContractActions contract={g} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold">Documentos anexados</h2>
                  <AttachDocumentDialog clientId={client.id} />
                </div>
                {documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Nenhum documento anexado a este cliente.
                    <br />
                    Adicione contratos, comprovantes ou arquivos importantes para manter o histórico organizado.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {documents.map((d) => (
                      <div
                        key={d.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{d.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {DOCUMENT_TYPE_LABEL[d.documentType]} · {formatDateBR(d.createdAt)}
                            {d.description ? ` · ${d.description}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" asChild title="Baixar documento">
                            <a href={`/api/arquivos/documento/${d.id}`}>
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                          <DocumentDeleteButton id={d.id} name={d.name} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------- Cobranças ---------- */}
        <TabsContent value="cobrancas">
          <Card>
            <CardContent className="p-0">
              {billings.length === 0 ? (
                <Empty>
                  Nenhuma cobrança registrada. O módulo de cobranças (geração e
                  acompanhamento) chega na Etapa 4.
                </Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Competência</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Pago</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Cobrança</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billings.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium max-w-xs truncate">
                          {b.description}
                        </TableCell>
                        <TableCell>
                          {String(b.competenceMonth).padStart(2, "0")}/{b.competenceYear}
                        </TableCell>
                        <TableCell>{formatDateBR(b.dueDate)}</TableCell>
                        <TableCell className="text-right">
                          {formatBRL(Number(b.amount))}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatBRL(Number(b.paidTotal))}
                        </TableCell>
                        <TableCell>
                          <Badge variant={BILLING_STATUS[b.status]?.variant ?? "secondary"}>
                            {BILLING_STATUS[b.status]?.label ?? b.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {COLLECTION_STATUS[b.collectionStatus] ?? b.collectionStatus}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Pagamentos ---------- */}
        <TabsContent value="pagamentos">
          <Card>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <Empty>Nenhum pagamento registrado para este cliente.</Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Referente a</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Conta</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{formatDateBR(p.paidAt)}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          {p.billing.description}
                        </TableCell>
                        <TableCell>{PAYMENT_METHOD[p.method] ?? p.method}</TableCell>
                        <TableCell>{p.account?.name ?? "—"}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-600">
                          +{formatBRL(Number(p.amount))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Serviços ---------- */}
        <TabsContent value="servicos">
          <Card>
            <CardContent className="p-5">
              {activeServiceNames.length === 0 ? (
                <Empty>
                  Nenhum serviço ativo. Serviços ficam ativos quando vinculados a
                  um contrato ativo do cliente.
                </Empty>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeServiceNames.map((s) => (
                    <Badge key={s} variant="default">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- Histórico financeiro ---------- */}
        <TabsContent value="historico">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold mb-3">Interações de cobrança</h2>
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nenhuma interação registrada.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {history.map((h) => (
                      <div key={h.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline">
                            {COLLECTION_STATUS[h.status] ?? h.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDateBR(h.contactedAt)}
                            {h.channel ? ` · ${h.channel}` : ""}
                          </span>
                        </div>
                        {h.message && (
                          <p className="mt-2 text-muted-foreground whitespace-pre-wrap">
                            {h.message}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h2 className="font-semibold mb-3">Receitas recebidas (caixa)</h2>
                {incomes.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nenhuma receita vinculada a este cliente ainda.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {incomes.map((i) => (
                      <div
                        key={i.id}
                        className="flex items-center justify-between text-sm border-b border-border/50 pb-2 last:border-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate">{i.description || "Receita"}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateBR(i.receivedAt)}
                          </p>
                        </div>
                        <span className="font-medium text-emerald-600 shrink-0">
                          +{formatBRL(i.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------- Contexto do Cliente ---------- */}
        <TabsContent value="contexto">
          <div className="space-y-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold">Contexto do Cliente</h2>
                  <NoteDialog clientId={client.id} />
                </div>
                {contextNotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Nenhuma observação de contexto ainda. Registre histórico
                    comercial, particularidades do contrato, dados de negociação
                    e alertas internos para o time.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {contextNotes.map((n) => (
                      <div key={n.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm">{n.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {(n.type && NOTE_TYPE_LABEL[n.type]) || "Observação"} ·{" "}
                              {formatDateBR(n.updatedAt)}
                            </p>
                          </div>
                          <NoteActions clientId={client.id} note={n} />
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                          {n.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold">Observações do cadastro</h2>
                  <ClientDialog
                    initial={serial}
                    trigger={
                      <Button variant="outline" size="sm">
                        Editar
                      </Button>
                    }
                  />
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {client.notes || "Sem observações registradas."}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm border-b border-border/50 pb-2 last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-12 px-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
