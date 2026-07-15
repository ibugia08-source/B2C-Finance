import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Empty } from "../../../shared-components";

const PAYMENT_METHOD: Record<string, string> = {
  PIX: "Pix",
  TRANSFER: "Transferência",
  BOLETO: "Boleto",
  CARD: "Cartão",
  CASH: "Dinheiro",
  OTHER: "Outro",
};

export default async function PagamentosPage({
  params,
}: {
  params: { id: string };
}) {
  const payments = await prisma.payment.findMany({
    where: { billing: { clientId: params.id } },
    include: { billing: true, account: true },
    orderBy: { paidAt: "desc" },
  });

  if (payments.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <Empty>Nenhum pagamento registrado para este cliente.</Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
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
      </CardContent>
    </Card>
  );
}
