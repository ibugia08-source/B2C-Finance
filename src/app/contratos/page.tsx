import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/viewer";
import { TemplateUploadDialog } from "./template-upload-dialog";
import { TemplateActions, type TemplateLite } from "./template-actions";
import { GeneratedContractActions } from "./generated-actions";
import {
  COMMERCIAL_TYPE_LABEL,
  DURATION_TYPE_LABEL,
  TEMPLATE_STATUS_LABEL,
  templateStatusVariant,
  GENERATED_STATUS_LABEL,
  generatedStatusVariant,
} from "./_meta";
import { Braces, FileText, AlertTriangle } from "lucide-react";

type Search = { status?: string; tipo?: string; para?: string };

/**
 * Biblioteca de Modelos de Contrato: modelos DOCX com variáveis {{ }}
 * e histórico de contratos gerados. O acordo comercial (MRR/TCV,
 * cobranças, renovação) vive em /acordos.
 */
export default async function ContratosPage({ searchParams }: { searchParams: Search }) {
  await requireAdmin();

  const where: any = {};
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.tipo) where.commercialType = searchParams.tipo;

  const [templatesRaw, generatedRaw] = await Promise.all([
    prisma.contractTemplate.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: { _count: { select: { generated: true } } },
    }),
    prisma.generatedContract.findMany({
      orderBy: { generatedAt: "desc" },
      take: 20,
      include: {
        client: { select: { id: true, name: true } },
        template: { select: { name: true } },
      },
    }),
  ]);

  const templates = templatesRaw.map((t) => ({
    ...t,
    monthlyAmount: t.monthlyAmount != null ? Number(t.monthlyAmount) : null,
    totalAmount: t.totalAmount != null ? Number(t.totalAmount) : null,
    includedServices: Array.isArray(t.includedServices) ? (t.includedServices as string[]) : [],
    variableCount: Array.isArray(t.variables) ? (t.variables as unknown[]).length : 0,
    warningCount: Array.isArray(t.warnings) ? (t.warnings as unknown[]).length : 0,
  }));

  const para = searchParams.para ? `?cliente=${searchParams.para}` : "";

  return (
    <div>
      <PageHeader
        title="Contratos"
        description="Biblioteca de modelos DOCX e geração de contratos preenchidos"
        actions={<TemplateUploadDialog />}
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <form className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Status</label>
              <select
                name="status"
                defaultValue={searchParams.status ?? ""}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {Object.entries(TEMPLATE_STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Tipo comercial</label>
              <select
                name="tipo"
                defaultValue={searchParams.tipo ?? ""}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {Object.entries(COMMERCIAL_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="outline">Filtrar</Button>
          </form>
        </CardContent>
      </Card>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium text-foreground">Nenhum modelo de contrato cadastrado.</p>
            <p className="text-sm mt-1">
              Envie um modelo em DOCX com variáveis entre chaves — ex.: {"{{Nome da empresa}}"} — para começar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <CardContent className="p-5 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/contratos/${t.id}`} className="font-semibold hover:underline block truncate">
                      {t.name}
                    </Link>
                    {t.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{t.description}</p>
                    )}
                  </div>
                  <Badge variant={templateStatusVariant(t.status)}>
                    {TEMPLATE_STATUS_LABEL[t.status]}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-1.5 text-xs">
                  {t.commercialType && (
                    <Badge variant="secondary">{COMMERCIAL_TYPE_LABEL[t.commercialType]}</Badge>
                  )}
                  {t.durationType && (
                    <Badge variant="outline">{DURATION_TYPE_LABEL[t.durationType]}</Badge>
                  )}
                  {t.durationMonths != null && (
                    <Badge variant="outline">{t.durationMonths} meses</Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {t.monthlyAmount != null && t.monthlyAmount > 0 && (
                    <div>
                      <span className="text-muted-foreground">Mensal </span>
                      <span className="font-medium">{formatBRL(t.monthlyAmount)}</span>
                    </div>
                  )}
                  {t.totalAmount != null && t.totalAmount > 0 && (
                    <div>
                      <span className="text-muted-foreground">Total </span>
                      <span className="font-medium">{formatBRL(t.totalAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Braces className="h-3.5 w-3.5 text-primary" />
                    {t.variableCount} variável(is)
                  </div>
                  <div>
                    <span className="text-muted-foreground">Gerados </span>
                    <span className="font-medium">{t._count.generated}</span>
                  </div>
                </div>

                {t.warningCount > 0 && (
                  <p className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> {t.warningCount} alerta(s) de variável — ver detalhes
                  </p>
                )}

                <p className="text-xs text-muted-foreground mt-auto">
                  Criado em {formatDateBR(t.createdAt)} · atualizado {formatDateBR(t.updatedAt)}
                </p>

                <div className="border-t pt-2 -mx-1">
                  <TemplateActions
                    template={t as unknown as TemplateLite}
                    generateHref={`/contratos/${t.id}/gerar${para}`}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="text-lg font-semibold mt-8 mb-3">Contratos gerados recentemente</h2>
      <Card>
        <CardContent className="p-0">
          {generatedRaw.length === 0 ? (
            <p className="text-center text-muted-foreground py-10 text-sm">
              Nenhum contrato gerado ainda. Use “Gerar contrato” em um modelo para criar o primeiro.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Gerado em</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {generatedRaw.map((g) => (
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
                    <TableCell className="max-w-[180px] truncate">{g.template?.name ?? "—"}</TableCell>
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
