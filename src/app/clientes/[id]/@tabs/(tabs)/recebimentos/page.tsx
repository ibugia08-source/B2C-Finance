import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

const BILLING_STATUS: Record<string, { label: string; variant: any }> = {
  PENDING: { label: "Em aberto", variant: "warning" },
  PARTIAL: { label: "Parcial", variant: "warning" },
  PAID: { label: "Paga", variant: "success" },
  OVERDUE: { label: "Vencida", variant: "destructive" },
  CANCELED: { label: "Cancelada", variant: "secondary" },
};

const COLLECTION_STATUS: Record<string, string> = {
  NOT_CONTACTED: "Sem contato",
  CONTACTED: "Contatado",
  PROMISED: "Prometeu pagar",
  PAID: "Pago",
  IGNORED: "Sem resposta",
  ESCALATED: "Escalado",
};

export default async function RecebimentosPage({
  params,
}: {
  params: { id: string };
}) {
  const billings = await prisma.billing.findMany({
    where: { clientId: params.id },
    orderBy: { dueDate: "desc" },
  });

  if (billings.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <Empty>
            Nenhuma cobrança registrada. O módulo de cobranças (geração e
            acompanhamento) chega na Etapa 4.
          </Empty>
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
                  {COLLECTION_STATUS[b.collectionStatus as keyof typeof COLLECTION_STATUS] ??
                    b.collectionStatus}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
