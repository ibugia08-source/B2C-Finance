import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  MobileCards, MobileCard, MobileCardHeader, MobileCardActions, Field, MobileEmpty,
} from "@/components/ui/record-card";
import { formatBRL, formatDateBR } from "@/lib/format";
import { contractTermLabel } from "@/lib/renewal-expectation";
import { ROW_PAID, ROW_OVERDUE } from "@/lib/status-meta";
import { CLIENT_STATUS_LABEL, clientStatusVariant } from "@/app/clientes/_meta";
import { RenewFlowDialog } from "./renew-flow-dialog";
import { ClientLossDialog } from "@/app/clientes/loss-dialog";
import type { RenewalPanelRow } from "@/lib/services/renewal-metrics";

/**
 * Tabela de renovações do mês — compartilhada entre a seção da Gestão do Mês
 * e o módulo /renovacoes. Colunas: Cliente, Modalidade, Status, Expectativa
 * de renovação (data), Entrada + prazo (a base do cálculo), Responsável,
 * Valor esperado e "Renovou?". Linhas já resolvidas (renovou = verde;
 * perdeu = vermelho) ganham a tintura da planilha.
 */
export function RenewalsTable({
  rows,
  canRenew,
  canMarkLost,
  canRegisterPayment,
  defaultCompetence,
  emptyMessage,
}: {
  rows: RenewalPanelRow[];
  canRenew: boolean;
  canMarkLost: boolean;
  canRegisterPayment: boolean;
  defaultCompetence: string; // "YYYY-MM" do mês em exibição
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const decision = (r: RenewalPanelRow) => {
    if (r.renewal) {
      return (
        <div className="text-right">
          <Badge variant="success">Renovado</Badge>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {formatDateBR(new Date(r.renewal.renewedAtISO))} · {r.renewal.months != null ? `${r.renewal.months}m` : "indeterminado"} ·{" "}
            {formatBRL(r.renewal.totalValue)}
          </p>
        </div>
      );
    }
    if (r.lostAtISO) {
      return (
        <div className="text-right">
          <Badge variant="destructive">Não renovou</Badge>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {formatDateBR(new Date(r.lostAtISO))} · {formatBRL(r.lostValue)}
          </p>
        </div>
      );
    }
    return (
      <div className="flex justify-end gap-1.5">
        {canRenew && (
          <RenewFlowDialog
            client={{ id: r.clientId, name: r.name }}
            modality={r.modality}
            indefinite={r.contractIndefinite}
            contract={r.contract}
            expectedValue={r.expected}
            defaultCompetence={defaultCompetence}
            canRegisterPayment={canRegisterPayment}
            trigger={
              <Button size="sm" variant="outline" className="text-success border-success/40">
                Sim, renovou
              </Button>
            }
          />
        )}
        {canMarkLost && (
          <ClientLossDialog
            clientId={r.clientId}
            clientName={r.name}
            renewalCompetence={defaultCompetence}
            trigger={
              <Button size="sm" variant="outline" className="text-destructive border-destructive/40">
                Não renovou
              </Button>
            }
          />
        )}
        {!canRenew && !canMarkLost && (
          <span className="text-xs text-muted-foreground">Pendente</span>
        )}
      </div>
    );
  };

  const rowClass = (r: RenewalPanelRow) =>
    r.renewal ? ROW_PAID : r.lostAtISO ? ROW_OVERDUE : "";

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Modalidade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expectativa</TableHead>
              <TableHead>Entrada + prazo</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead className="text-right">Valor esperado</TableHead>
              <TableHead className="text-right">Renovou?</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.clientId} className={rowClass(r)}>
                <TableCell>
                  <Link
                    href={`/clientes/${r.clientId}`}
                    className="font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{r.modality ?? "—"}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={clientStatusVariant(r.status)}>
                    {(CLIENT_STATUS_LABEL as Record<string, string>)[r.status] ?? r.status}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">
                  {r.expectedRenewalAtISO ? formatDateBR(new Date(r.expectedRenewalAtISO)) : "—"}
                </TableCell>
                <TableCell className="tabular-nums">
                  {r.startedAtISO ? formatDateBR(new Date(r.startedAtISO)) : "—"}
                  <span className="block text-[10px] text-muted-foreground">
                    {r.contractIndefinite
                      ? "prazo indeterminado"
                      : r.contractMonths != null ? `prazo ${contractTermLabel(r.contractMonths)}` : "sem prazo"}
                    {r.monthsActive != null ? ` · ${r.monthsActive} meses de casa` : ""}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.salesOwner ?? "—"}
                </TableCell>
                <TableCell className="text-right stat-number">
                  {r.expected > 0 ? formatBRL(r.expected) : "—"}
                  <span className="block text-[10px] text-muted-foreground">
                    {r.modality === "TCV" ? "valor cheio" : "mensalidade"}
                  </span>
                </TableCell>
                <TableCell className="text-right">{decision(r)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <MobileCards>
        {rows.length === 0 ? (
          <MobileEmpty>{emptyMessage}</MobileEmpty>
        ) : (
          rows.map((r) => (
            <MobileCard key={r.clientId}>
              <MobileCardHeader
                title={r.name}
                aside={<Badge variant="outline">{r.modality ?? "—"}</Badge>}
              />
              <div className="space-y-1.5">
                <Field label="Status">
                  {(CLIENT_STATUS_LABEL as Record<string, string>)[r.status] ?? r.status}
                </Field>
                <Field label="Expectativa">
                  {r.expectedRenewalAtISO ? formatDateBR(new Date(r.expectedRenewalAtISO)) : "—"}
                </Field>
                <Field label="Entrada + prazo">
                  {r.startedAtISO ? formatDateBR(new Date(r.startedAtISO)) : "—"}
                  {r.contractIndefinite || r.contractMonths != null
                    ? ` · ${contractTermLabel(r.contractMonths, r.contractIndefinite).toLowerCase()}`
                    : ""}
                </Field>
                <Field label="Responsável">{r.salesOwner ?? "—"}</Field>
                <Field label="Valor esperado">{r.expected > 0 ? formatBRL(r.expected) : "—"}</Field>
              </div>
              <MobileCardActions>{decision(r)}</MobileCardActions>
            </MobileCard>
          ))
        )}
      </MobileCards>
    </>
  );
}
