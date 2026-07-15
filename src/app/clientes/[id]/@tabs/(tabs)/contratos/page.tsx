import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
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

const CONTRACT_STATUS: Record<string, { label: string; variant: any }> = {
  PENDING: { label: "Pendente", variant: "secondary" },
  ACTIVE: { label: "Ativo", variant: "success" },
  RENEWAL: { label: "Em renovação", variant: "warning" },
  OVERDUE: { label: "Vencido", variant: "destructive" },
  ENDED: { label: "Encerrado", variant: "outline" },
  CANCELED: { label: "Cancelado", variant: "outline" },
};

export default async function ContratosPage({
  params,
}: {
  params: { id: string };
}) {
  const contracts = await prisma.contract.findMany({
    where: { clientId: params.id },
    include: { services: { include: { service: true } } },
  });

  if (contracts.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <Empty>
            Nenhum contrato cadastrado para este cliente. O módulo de contratos
            (criação e renovação) chega na próxima etapa.
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
                <TableCell className="font-medium">{ct.title}</TableCell>
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
      </CardContent>
    </Card>
  );
}
