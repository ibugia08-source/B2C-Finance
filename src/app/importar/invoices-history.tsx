import { formatBRL, formatDateBR } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PayInvoiceDialog } from "../faturas/pay-dialog";
import { DeleteInvoiceButton } from "./delete-actions";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function statusVariant(s: string): any {
  if (s === "paga") return "success";
  if (s === "atrasada") return "destructive";
  if (s === "parcial") return "warning";
  if (s === "fechada") return "secondary";
  return "outline";
}

export function InvoicesHistory({ invoices }: { invoices: any[] }) {
  return (
    <>
    {/* Desktop: tabela completa */}
    <div className="hidden md:block">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Conta</TableHead>
          <TableHead>Mês</TableHead>
          <TableHead>Vencimento</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Pago</TableHead>
          <TableHead className="text-right">Em aberto</TableHead>
          <TableHead>Status</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
              <img
                src="/brand/empty-faturas.svg"
                alt=""
                className="mx-auto mb-3 w-56 max-w-full opacity-95"
              />
              Nenhuma fatura ainda. Importe a fatura de um cartão para gerá-las.
            </TableCell>
          </TableRow>
        )}
        {invoices.map((inv) => (
          <TableRow key={inv.id}>
            <TableCell className="font-medium">{inv.card.name}</TableCell>
            <TableCell>
              {MESES[inv.referenceMonth - 1]} / {inv.referenceYear}
            </TableCell>
            <TableCell>{formatDateBR(inv.dueDate)}</TableCell>
            <TableCell className="text-right">{formatBRL(inv.total)}</TableCell>
            <TableCell className="text-right">{formatBRL(inv.paid)}</TableCell>
            <TableCell className="text-right font-medium">
              {formatBRL(inv.total - inv.paid)}
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(inv.status)} className="capitalize">
                {inv.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                <PayInvoiceDialog invoice={inv} />
                <DeleteInvoiceButton
                  invoiceId={inv.id}
                  label={`${MESES[inv.referenceMonth - 1]}/${inv.referenceYear} — ${inv.card.name}`}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>

    {/* Mobile: cada fatura vira um card */}
    <MobileCards>
      {invoices.length === 0 ? (
        <MobileEmpty>
          <img
            src="/brand/empty-faturas.svg"
            alt=""
            className="mx-auto mb-3 w-56 max-w-full opacity-95"
          />
          Nenhuma fatura ainda. Importe a fatura de um cartão para gerá-las.
        </MobileEmpty>
      ) : (
        invoices.map((inv) => (
          <MobileCard key={inv.id}>
            <MobileCardHeader
              title={inv.card.name}
              aside={
                <Badge variant={statusVariant(inv.status)} className="capitalize">
                  {inv.status}
                </Badge>
              }
            />
            <div className="space-y-1.5">
              <Field label="Mês">
                {MESES[inv.referenceMonth - 1]} / {inv.referenceYear}
              </Field>
              <Field label="Vencimento">{formatDateBR(inv.dueDate)}</Field>
              <Field label="Total">{formatBRL(inv.total)}</Field>
              <Field label="Pago">{formatBRL(inv.paid)}</Field>
              <Field label="Em aberto">
                <span className="font-medium">{formatBRL(inv.total - inv.paid)}</span>
              </Field>
            </div>
            <MobileCardActions>
              <PayInvoiceDialog invoice={inv} />
              <DeleteInvoiceButton
                invoiceId={inv.id}
                label={`${MESES[inv.referenceMonth - 1]}/${inv.referenceYear} — ${inv.card.name}`}
              />
            </MobileCardActions>
          </MobileCard>
        ))
      )}
    </MobileCards>
    </>
  );
}
