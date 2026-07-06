import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/viewer";
import type { TemplateVariable } from "@/lib/docx/template";
import { TemplateEditDialog, type TemplateLite } from "../template-actions";
import { GeneratedContractActions } from "../generated-actions";
import { VariablesEditor } from "./variables-editor";
import {
  COMMERCIAL_TYPE_LABEL,
  BILLING_MODEL_LABEL,
  DURATION_TYPE_LABEL,
  TEMPLATE_STATUS_LABEL,
  templateStatusVariant,
  GENERATED_STATUS_LABEL,
  generatedStatusVariant,
} from "../_meta";
import { ArrowLeft, Download, FileSignature, AlertTriangle } from "lucide-react";

/** Detalhe do modelo: metadados, variáveis mapeadas e contratos gerados. */
export default async function TemplateDetailPage({ params }: { params: { id: string } }) {
  await requireAdmin();

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
    include: {
      generated: {
        orderBy: { generatedAt: "desc" },
        include: { client: { select: { id: true, name: true } } },
      },
    },
  });
  if (!template) notFound();

  const variables = (template.variables as unknown as TemplateVariable[]) ?? [];
  const warnings = (template.warnings as unknown as string[]) ?? [];
  const lite: TemplateLite = {
    id: template.id,
    name: template.name,
    description: template.description,
    commercialType: template.commercialType,
    billingModel: template.billingModel,
    durationType: template.durationType,
    durationMonths: template.durationMonths,
    monthlyAmount: template.monthlyAmount != null ? Number(template.monthlyAmount) : null,
    totalAmount: template.totalAmount != null ? Number(template.totalAmount) : null,
    defaultDueDay: template.defaultDueDay,
    includedServices: Array.isArray(template.includedServices)
      ? (template.includedServices as string[])
      : [],
    internalNotes: template.internalNotes,
    status: template.status,
  };

  const facts: [string, string][] = [
    ["Tipo comercial", template.commercialType ? COMMERCIAL_TYPE_LABEL[template.commercialType] : "—"],
    ["Prazo", template.durationType ? DURATION_TYPE_LABEL[template.durationType] : "—"],
    ["Duração", template.durationMonths != null ? `${template.durationMonths} meses` : "—"],
    ["Valor mensal", lite.monthlyAmount ? formatBRL(lite.monthlyAmount) : "—"],
    ["Valor total", lite.totalAmount ? formatBRL(lite.totalAmount) : "—"],
    ["Forma de pagamento", template.billingModel ? BILLING_MODEL_LABEL[template.billingModel] : "—"],
    ["Dia de vencimento", template.defaultDueDay != null ? `Dia ${template.defaultDueDay}` : "—"],
    ["Arquivo", template.originalFileName],
    ["Enviado em", formatDateBR(template.createdAt)],
    ["Última atualização", formatDateBR(template.updatedAt)],
  ];

  return (
    <div>
      <div className="mb-2">
        <Link href="/contratos" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Voltar para a biblioteca de modelos
        </Link>
      </div>
      <PageHeader
        title={template.name}
        description={template.description ?? "Modelo de contrato DOCX"}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <a href={`/api/arquivos/modelo/${template.id}`}>
                <Download className="h-4 w-4 mr-1" /> Baixar modelo
              </a>
            </Button>
            <TemplateEditDialog template={lite} />
            <Button asChild>
              <Link href={`/contratos/${template.id}/gerar`}>
                <FileSignature className="h-4 w-4 mr-1" /> Gerar contrato a partir de Modelo
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              Metadados comerciais
              <Badge variant={templateStatusVariant(template.status)}>
                {TEMPLATE_STATUS_LABEL[template.status]}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium text-right truncate">{v}</dd>
                </div>
              ))}
            </dl>
            {lite.includedServices.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1">Serviços incluídos</p>
                <div className="flex flex-wrap gap-1">
                  {lite.includedServices.map((s) => (
                    <Badge key={s} variant="secondary">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
            {template.internalNotes && (
              <p className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap">
                {template.internalNotes}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Variáveis do modelo ({variables.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {warnings.length > 0 && (
              <div className="mb-3 space-y-1">
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-600 flex gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
                  </p>
                ))}
              </div>
            )}
            {variables.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhuma variável foi identificada neste modelo.
                <br />
                Confira se o documento utiliza variáveis no formato {"{{Nome da variável}}"}.
              </p>
            ) : (
              <VariablesEditor templateId={template.id} variables={variables} />
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="text-lg font-semibold mb-3">Contratos gerados com este modelo</h2>
      <Card>
        <CardContent className="p-0">
          {template.generated.length === 0 ? (
            <p className="text-center text-muted-foreground py-10 text-sm">
              Nenhum contrato gerado a partir deste modelo ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Gerado em</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {template.generated.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium max-w-xs truncate">{g.name}</TableCell>
                    <TableCell>
                      {g.client ? (
                        <Link href={`/clientes/${g.client.id}`} className="hover:underline">
                          {g.client.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDateBR(g.generatedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={generatedStatusVariant(g.status)}>
                        {GENERATED_STATUS_LABEL[g.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <GeneratedContractActions contract={g} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
