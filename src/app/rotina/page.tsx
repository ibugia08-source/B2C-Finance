import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/metric-card";
import { formatBRL, formatDateBR, formatDateInputLocal } from "@/lib/format";
import { requirePagePermission } from "@/lib/auth/viewer";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { gatesDaRotina, montarRotinaDoDia } from "@/lib/services/daily-routine";
import { domainContextFor } from "@/lib/auth/domain-session";
import { AISuggestionsPanel } from "./ai-suggestions";
import { MarkExpensePaid } from "./expense-actions";
import { DismissButton, ActionCheck, ExpenseDueDateDialog } from "./routine-controls";
import { MONTH_LABEL } from "@/app/clientes/_meta";
import { SavedViews } from "@/components/saved-views";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MessageDialog } from "@/app/cobrancas/message-dialog";
import { PaymentDialog } from "@/app/cobrancas/payment-dialog";
import type { MessageTone } from "@/lib/billing-message";
import { MessageSquareText, BadgeDollarSign, ExternalLink, ListChecks } from "lucide-react";

/**
 * ROTINA DIÁRIA — central de EXECUÇÃO do dia (a análise vive na Dashboard).
 * Estrutura: métricas do dia → Cobranças (a receber) → Pagamentos (a pagar)
 * → Ações de hoje (checklist) → Sugestões da IA (no final).
 *
 * Regras:
 *  - Cobranças = clientes vencidos (vermelho) + vencendo hoje/próximos 3 dias
 *    (amarelo). Fonte: Billing por competência (TCV nunca vira recorrente).
 *  - Pagamentos = despesas da empresa vencidas (vermelho) + hoje/3 dias (amarelo).
 *  - "Remover da rotina de hoje" só OCULTA o item do dia (RoutineItemState);
 *    nunca apaga nem altera cliente, cobrança, despesa ou status financeiro.
 *  - Checklist "Ações de hoje" persiste conclusões por dia.
 */

const PRIORITY_META: Record<string, { label: string; variant: any }> = {
  alta: { label: "Alta", variant: "destructive" },
  media: { label: "Média", variant: "warning" },
  baixa: { label: "Baixa", variant: "secondary" },
};

// Cores suaves das linhas: fonte única em lib/status-meta (língua da planilha).
import { ROW_OVERDUE, ROW_SOON } from "@/lib/status-meta";

export default async function RotinaPage() {
  const viewer = await requirePagePermission("rotina.visualizar");

  // Personalização por permissão: cada seção, card e item do checklist só
  // aparece (e só busca dados) se o usuário tiver acesso ao módulo de origem.
  // Botões seguem a permissão que a server action correspondente exige.
  const ctx = await domainContextFor(viewer);
  const gates = gatesDaRotina(ctx);
  const hasAnyContent =
    gates.cobrancas || gates.pagamentos || gates.caixa || gates.renovacoes || gates.upsell;

  // Perfil sem acesso a nenhum módulo que alimenta a rotina: nada a buscar.
  if (!hasAnyContent) {
    return (
      <div>
        <PageHeader
          title="Rotina diária"
          description="Acompanhe cobranças, pagamentos e ações financeiras que precisam de atenção hoje."
        />
        <Card>
          <CardContent className="py-14 text-center">
            <p className="text-sm font-medium">Sua rotina está vazia</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Seu perfil ainda não tem acesso aos módulos que alimentam a rotina
              diária (cobranças, pagamentos, renovações ou upsell). Fale com o
              administrador para liberar os acessos.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gates.cobrancas) await markOverdueBillings();

  // A REGRA da rotina (o que cobrar, pagar e fazer hoje) mora em
  // services/daily-routine — a mesma que a API vai devolver.
  const {
    today,
    in4,
    tomorrow,
    queue,
    accounts,
    dueSoonBillings,
    overdueExpenses,
    upcomingExpenses,
    states,
    cash,
    renewalWindows,
    openUpsells,
    n,
    removed,
    doneActions,
    daysUntil,
    vencidos,
    queueIds,
    proximos,
    vencidosSorted,
    cobrVencidasTotal,
    cobrProximasTotal,
    payPriority,
    payVencidos,
    payProximos,
    pagVencidosTotal,
    pagProximosTotal,
    acoes,
    pagHoje,
    cobrHoje,
    renov,
    renovPendentes,
    renovPendenteValor,
    ORDER,
    acoesPendentes,
  } = await montarRotinaDoDia(ctx);
  const iso = formatDateInputLocal;
  const mesRef = (m: number, y: number) => `${MONTH_LABEL[m] ?? m}/${y}`;

  // Tom padrão da mensagem por atraso (amigável → direta → urgente).
  const toneFor = (daysOverdue: number): MessageTone =>
    daysOverdue >= 15 ? "urgente" : daysOverdue > 0 ? "direto" : "amigavel";
  const ROUTINE_TONES: MessageTone[] = ["amigavel", "direto", "urgente"];

  // Grid de métricas se adapta ao nº de cards visíveis (5, 3 ou 1).
  const statCount = 1 + (gates.cobrancas ? 2 : 0) + (gates.pagamentos ? 2 : 0);
  const statGrid =
    statCount >= 5
      ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
      : statCount >= 3
        ? "grid-cols-2 md:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2";

  return (
    <div>
      <PageHeader
        title="Rotina diária"
        description="Acompanhe cobranças, pagamentos e ações financeiras que precisam de atenção hoje."
      />

      <div className="mb-3">
        <SavedViews module="rotina" />
      </div>

      {/* ===== Métricas principais (hoje + próximos 3 dias) ===== */}
      <div className={`grid ${statGrid} gap-3 mb-3`}>
        {gates.cobrancas && (
          <>
            <StatCard
              href="#cobrancas"
              title="Cobranças vencidas"
              value={String(vencidosSorted.length)}
              intent={vencidosSorted.length > 0 ? "negative" : "positive"}
              hint={formatBRL(cobrVencidasTotal)}
            />
            <StatCard
              href="#cobrancas"
              title="Cobranças próximas"
              value={String(proximos.length)}
              intent={proximos.length > 0 ? "warning" : "default"}
              hint={`${formatBRL(cobrProximasTotal)} · hoje a 3 dias`}
            />
          </>
        )}
        {gates.pagamentos && (
          <>
            <StatCard
              href="#pagamentos"
              title="Pagamentos vencidos"
              value={String(payVencidos.length)}
              intent={payVencidos.length > 0 ? "negative" : "positive"}
              hint={formatBRL(pagVencidosTotal)}
            />
            <StatCard
              href="#pagamentos"
              title="Pagamentos próximos"
              value={String(payProximos.length)}
              intent={payProximos.length > 0 ? "warning" : "default"}
              hint={`${formatBRL(pagProximosTotal)} · hoje a 3 dias`}
            />
          </>
        )}
        <StatCard
          href="#acoes"
          title="Ações pendentes"
          value={String(acoesPendentes)}
          intent={acoesPendentes > 0 ? "warning" : "positive"}
          hint={`${acoes.length - acoesPendentes} concluída(s) hoje`}
        />
      </div>

      {/* ===== COBRANÇAS ===== */}
      {gates.cobrancas && (
        <>
          <h2 id="cobrancas" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 scroll-mt-24">
            Cobranças
          </h2>
          <p className="text-xs text-muted-foreground mb-3 -mt-1">
            Valores a receber dos clientes — vencidos e vencendo até 3 dias.
          </p>
          <Card className="mb-3">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Valor devido</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vencidosSorted.length === 0 && proximos.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                        Nenhuma cobrança precisando de atenção. 🎉
                      </TableCell>
                    </TableRow>
                  )}
                  {vencidosSorted.map((q) => {
                    const pm = PRIORITY_META[q.priority];
                    return (
                      <TableRow key={q.clientId} className={ROW_OVERDUE}>
                        <TableCell>
                          <Link href={`/clientes/${q.clientId}`} className="font-medium hover:underline">
                            {q.clientName}
                          </Link>
                          <span className="block text-[11px] text-muted-foreground">
                            {q.billingCount} cobrança(s) em aberto
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium text-destructive">
                          {formatBRL(q.totalOverdue)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDateBR(q.anchorBilling.dueDate)}
                          <span className="block text-[11px] text-destructive">
                            venceu há {q.daysOverdue} dia(s)
                          </span>
                        </TableCell>
                        <TableCell><Badge variant="destructive">Vencido</Badge></TableCell>
                        <TableCell><Badge variant={pm.variant}>{pm.label}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            {gates.gerarCobranca && (
                              <MessageDialog
                                phone={q.phone}
                                billingId={q.anchorBilling.id}
                                tones={ROUTINE_TONES}
                                defaultTone={toneFor(q.daysOverdue)}
                                input={{
                                  clientName: q.clientName,
                                  openAmount: formatBRL(q.totalOverdue),
                                  dueDate: formatDateBR(q.anchorBilling.dueDate),
                                  daysOverdue: q.daysOverdue,
                                  serviceNames: q.anchorBilling.serviceNames,
                                  hasPromise: !!q.promise,
                                  contactCount: q.attempts,
                                }}
                                trigger={
                                  <Button variant="ghost" size="icon" title="Gerar mensagem de cobrança">
                                    <MessageSquareText className="h-4 w-4" />
                                  </Button>
                                }
                              />
                            )}
                            {gates.registrarPagamento && (
                              <PaymentDialog
                                billing={{
                                  id: q.anchorBilling.id,
                                  openAmount: q.anchorBilling.openAmount,
                                  description: q.anchorBilling.description,
                                }}
                                accounts={accounts}
                                trigger={
                                  <Button variant="ghost" size="icon" title="Registrar pagamento">
                                    <BadgeDollarSign className="h-4 w-4 text-emerald-600" />
                                  </Button>
                                }
                              />
                            )}
                            {gates.concluirAcao && (
                              <DismissButton itemType="cobranca" itemKey={q.clientId} itemLabel={q.clientName} />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {proximos.map(({ b, open, dias, priority }) => {
                    const pm = PRIORITY_META[priority];
                    return (
                      <TableRow key={b.id} className={ROW_SOON}>
                        <TableCell>
                          <Link href={`/clientes/${b.client.id}`} className="font-medium hover:underline">
                            {b.client.name}
                          </Link>
                          <span className="block text-[11px] text-muted-foreground max-w-[220px] truncate">
                            {b.description}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatBRL(open)}</TableCell>
                        <TableCell className="text-sm">
                          {formatDateBR(b.dueDate)}
                          <span className="block text-[11px] text-warning">
                            {dias === 0 ? "vence hoje" : dias === 1 ? "vence amanhã" : `vence em ${dias} dias`}
                          </span>
                        </TableCell>
                        <TableCell><Badge variant="warning">Em aberto</Badge></TableCell>
                        <TableCell><Badge variant={pm.variant}>{pm.label}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            {gates.gerarCobranca && (
                              <MessageDialog
                                phone={b.client.phone}
                                billingId={b.id}
                                tones={ROUTINE_TONES}
                                defaultTone="amigavel"
                                input={{
                                  clientName: b.client.name,
                                  openAmount: formatBRL(open),
                                  dueDate: formatDateBR(b.dueDate),
                                  daysOverdue: 0,
                                  serviceNames: [],
                                  hasPromise: false,
                                  contactCount: 0,
                                  referenceMonth: mesRef(b.competenceMonth, b.competenceYear),
                                }}
                                trigger={
                                  <Button variant="ghost" size="icon" title="Gerar mensagem de cobrança">
                                    <MessageSquareText className="h-4 w-4" />
                                  </Button>
                                }
                              />
                            )}
                            {gates.registrarPagamento && (
                              <PaymentDialog
                                billing={{ id: b.id, openAmount: open, description: b.description }}
                                accounts={accounts}
                                trigger={
                                  <Button variant="ghost" size="icon" title="Registrar pagamento">
                                    <BadgeDollarSign className="h-4 w-4 text-emerald-600" />
                                  </Button>
                                }
                              />
                            )}
                            {gates.concluirAcao && (
                              <DismissButton itemType="cobranca" itemKey={b.client.id} itemLabel={b.client.name} />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* ===== PAGAMENTOS ===== */}
      {gates.pagamentos && (
        <>
          <h2 id="pagamentos" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 scroll-mt-24">
            Pagamentos
          </h2>
          <p className="text-xs text-muted-foreground mb-3 -mt-1">
            Valores que a agência precisa pagar — despesas vencidas e vencendo até 3 dias.
          </p>
          <Card className="mb-3">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Despesa</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payVencidos.length === 0 && payProximos.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                        Nenhum pagamento precisando de atenção. 🎉
                      </TableCell>
                    </TableRow>
                  )}
                  {[...payVencidos, ...payProximos].map((p) => {
                    const pm = PRIORITY_META[p.priority];
                    return (
                      <TableRow key={p.id} className={p.overdue ? ROW_OVERDUE : ROW_SOON}>
                        <TableCell className="font-medium max-w-[240px] truncate">{p.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.category ?? "—"}</TableCell>
                        <TableCell className={`text-right font-medium ${p.overdue ? "text-destructive" : ""}`}>
                          {formatBRL(p.amount)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.dueDate ? formatDateBR(p.dueDate) : "hoje"}
                          <span className={`block text-[11px] ${p.overdue ? "text-destructive" : "text-warning"}`}>
                            {p.overdue
                              ? `vencido há ${p.dias} dia(s)`
                              : p.dias === 0 ? "vence hoje" : p.dias === 1 ? "vence amanhã" : `vence em ${p.dias} dias`}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.overdue ? "destructive" : "warning"}>
                            {p.overdue ? "Vencido" : "Pendente"}
                          </Badge>
                        </TableCell>
                        <TableCell><Badge variant={pm.variant}>{pm.label}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end items-center">
                            {gates.marcarPaga && <MarkExpensePaid id={p.id} />}
                            {gates.alterarVencimento && (
                              <ExpenseDueDateDialog
                                expenseId={p.id}
                                description={p.description}
                                currentDue={p.dueDate ? iso(p.dueDate) : iso(today)}
                              />
                            )}
                            <Button variant="ghost" size="icon" asChild title="Ver em Contas a Pagar">
                              <Link href={`/despesas?mes=${(p.dueDate ? iso(p.dueDate) : iso(today)).slice(0, 7)}`}>
                                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                              </Link>
                            </Button>
                            {gates.concluirAcao && (
                              <DismissButton itemType="pagamento" itemKey={p.id} itemLabel={p.description} />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* ===== AÇÕES DE HOJE ===== */}
      <h2 id="acoes" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 scroll-mt-24">
        Ações de hoje
      </h2>
      <Card className="mb-3">
        <CardContent className="p-5">
          {acoes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nada urgente hoje. Dia tranquilo! 🎉
            </p>
          ) : (
            <ul className="space-y-2.5">
              {acoes.map((a) => {
                const pm = PRIORITY_META[a.priority];
                const done = doneActions.has(a.key);
                const content = (
                  <span className="inline-flex items-start gap-2">
                    <Badge variant={done ? "outline" : pm.variant} className="shrink-0 mt-0.5 text-[10px] px-1.5">
                      {pm.label}
                    </Badge>
                    {a.href ? (
                      <Link href={a.href} className={done ? "" : "hover:underline"}>
                        {a.text}
                      </Link>
                    ) : (
                      a.text
                    )}
                  </span>
                );
                return (
                  <li key={a.key} className="flex items-start gap-2">
                    {gates.concluirAcao ? (
                      <ActionCheck itemKey={a.key} done={done}>
                        {content}
                      </ActionCheck>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {acoes.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-4 flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" />
              {acoesPendentes} pendente(s) · {acoes.length - acoesPendentes} concluída(s) — o checklist zera a cada dia.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== Sugestões inteligentes (IA) — no final ===== */}
      {gates.ia && <AISuggestionsPanel />}
    </div>
  );
}
