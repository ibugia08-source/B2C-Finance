import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/auth/viewer";
import type { TemplateVariable } from "@/lib/docx/template";
import { GenerateWizard, type WizardTemplate } from "./generate-wizard";
import { COMMERCIAL_TYPE_LABEL } from "../../_meta";
import { ArrowLeft } from "lucide-react";

/** Geração de contrato: cliente → formulário dinâmico → revisão → DOCX. */
export default async function GerarContratoPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { cliente?: string };
}) {
  await requirePagePermission("contratos.gerar_contrato");

  const [template, clients] = await Promise.all([
    prisma.contractTemplate.findUnique({ where: { id: params.id } }),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        legalName: true,
        document: true,
        email: true,
        phone: true,
        address: true,
        legalRepresentative: true,
        city: true,
        state: true,
        segment: true,
        paymentDay: true,
      },
    }),
  ]);
  if (!template) notFound();

  const wizardTemplate: WizardTemplate = {
    id: template.id,
    name: template.name,
    description: template.description,
    commercialType: template.commercialType,
    defaultDueDay: template.defaultDueDay,
    durationMonths: template.durationMonths,
    monthlyAmount: template.monthlyAmount != null ? Number(template.monthlyAmount) : null,
    totalAmount: template.totalAmount != null ? Number(template.totalAmount) : null,
    variables: (template.variables as unknown as TemplateVariable[]) ?? [],
  };

  const preselected =
    searchParams.cliente && clients.some((c) => c.id === searchParams.cliente)
      ? searchParams.cliente
      : null;

  return (
    <div>
      <div className="mb-2">
        <Link
          href={`/contratos/${template.id}`}
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para o modelo
        </Link>
      </div>
      <PageHeader
        title={`Gerar contrato — ${template.name}`}
        description={[
          template.description,
          template.commercialType ? COMMERCIAL_TYPE_LABEL[template.commercialType] : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Preencha as variáveis e baixe o DOCX pronto"}
      />
      <GenerateWizard
        template={wizardTemplate}
        clients={clients}
        preselectedClientId={preselected}
      />
    </div>
  );
}
