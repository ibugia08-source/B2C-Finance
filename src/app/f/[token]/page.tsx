import { prisma } from "@/lib/prisma";
import { runWithOwner } from "@/lib/auth/owner-scope";
import { B2CLogo } from "@/components/mascot";
import { prefillValue, type PrefillClient } from "@/lib/docx/prefill";
import type { TemplateVariable } from "@/lib/docx/template";
import { PublicContractForm } from "./public-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Formulário de contrato — B2C Gestão",
  robots: { index: false, follow: false },
};

function Unavailable() {
  return (
    <div className="min-h-screen app-shell flex items-center justify-center p-6 text-foreground">
      <div className="w-full max-w-md rounded-2xl border bg-card shadow-xl p-8 text-center space-y-4">
        <B2CLogo height={36} className="mx-auto" />
        <h1 className="text-lg font-semibold">Link indisponível</h1>
        <p className="text-sm text-muted-foreground">
          Este formulário não está mais disponível. Fale com a equipe da B2C
          Gestão para receber um novo link.
        </p>
      </div>
    </div>
  );
}

/**
 * Formulário PÚBLICO de contrato (/f/{token}) — substitui os "modelos" do
 * ZapSign. Sem login: o token opaco é a credencial; o dono dos dados vem do
 * próprio link (runWithOwner). Sem sessão, o escopo do Prisma é fail-closed —
 * por isso o link é um modelo global e o restante roda sob o dono explícito.
 */
export default async function PublicContractFormPage({
  params,
}: {
  params: { token: string };
}) {
  const link = await prisma.contractFormLink.findUnique({
    where: { token: params.token },
  });
  if (!link || !link.active) return <Unavailable />;

  const data = await runWithOwner(link.ownerId, async () => {
    const template = await prisma.contractTemplate.findUnique({
      where: { id: link.templateId },
    });
    if (!template || template.status !== "ACTIVE") return null;

    // Link direcionado → pré-preenche o cadastro DESSE cliente. Link geral
    // nunca expõe dados de cliente algum.
    const client: PrefillClient | null = link.clientId
      ? await prisma.client.findUnique({
          where: { id: link.clientId },
          select: {
            name: true, legalName: true, document: true, email: true,
            phone: true, address: true, legalRepresentative: true,
            city: true, state: true, segment: true, paymentDay: true,
          },
        })
      : null;
    return { template, client };
  });
  if (!data) return <Unavailable />;

  const variables = (data.template.variables as unknown as TemplateVariable[]) ?? [];
  const meta = {
    defaultDueDay: data.template.defaultDueDay,
    durationMonths: data.template.durationMonths,
    monthlyAmount:
      data.template.monthlyAmount != null ? Number(data.template.monthlyAmount) : null,
    totalAmount:
      data.template.totalAmount != null ? Number(data.template.totalAmount) : null,
  };
  const defaults: Record<string, string> = {};
  for (const v of variables) {
    defaults[v.rawName] = prefillValue(v, data.client, meta);
  }

  return (
    <div className="min-h-screen app-shell flex items-center justify-center p-4 sm:p-6 text-foreground">
      <div className="w-full max-w-xl py-8">
        <div className="rounded-2xl border bg-card shadow-xl overflow-hidden">
          <div className="px-6 sm:px-8 pt-7 pb-5 border-b">
            <B2CLogo height={30} />
            <h1 className="mt-4 text-xl font-semibold tracking-tight">
              {data.template.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Preencha os dados abaixo para prepararmos o seu contrato. Leva
              menos de 2 minutos.
            </p>
          </div>
          <div className="px-6 sm:px-8 py-6">
            <PublicContractForm
              token={params.token}
              variables={variables}
              defaults={defaults}
            />
          </div>
        </div>
        <p className="mt-4 text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          B2C Gestão · dados usados apenas para a preparação do contrato
        </p>
      </div>
    </div>
  );
}
