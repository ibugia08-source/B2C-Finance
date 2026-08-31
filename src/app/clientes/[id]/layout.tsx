import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { ClientHeader } from "./client-header";
import { TabsNavigation, type TabsCount } from "./tabs-navigation";
import { getClientSummaries, getClientRiskProfile } from "@/lib/services/client-metrics";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const revalidate = 60;

export default async function ClientDetailLayout({
  params,
  children,
}: {
  params: { id: string };
  children: React.ReactNode;
}) {
  const viewer = await requirePagePermission("clientes.visualizar");
  const canUpsell = can(viewer, "upsell.criar");

  const [client, contracts, billings, payments, generatedContracts, documents, notes, history, summaries] =
    await Promise.all([
      prisma.client.findUnique({
        where: { id: params.id },
      }),
      prisma.contract.count({
        where: { clientId: params.id },
      }),
      prisma.billing.count({
        where: { clientId: params.id, status: { not: "CANCELED" } },
      }),
      prisma.payment.count({
        where: { billing: { clientId: params.id } },
      }),
      prisma.generatedContract.count({
        where: { clientId: params.id },
      }),
      prisma.clientDocument.count({
        where: { clientId: params.id },
      }),
      prisma.clientNote.count({
        where: { clientId: params.id },
      }),
      prisma.collectionHistory.count({
        where: { clientId: params.id },
      }),
      getClientSummaries([params.id]),
    ]);

  if (!client) notFound();

  const risk = await getClientRiskProfile(params.id, client.startedAt);

  // Opções para o quick-add de upsell do header (só se o viewer pode criar).
  const [upsellServices, upsellOffers] = canUpsell
    ? await Promise.all([
        prisma.service.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.offer.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ])
    : [[], []];

  const summary = summaries.get(params.id) || {
    activeContracts: 0,
    nextRenewal: null,
    totalRevenue: 0,
    openAmount: 0,
    overdueAmount: 0,
  };

  const monthly = client.monthlyValue != null ? Number(client.monthlyValue) : 0;

  // O contador do onboarding mostra o que FALTA, não o total: a aba
  // existe para chamar atenção do que está pendente.
  const onboardingPendentes = await prisma.onboardingTask.count({
    where: { relationship: { clientId: params.id }, doneAt: null },
  });

  const tabCounts: TabsCount = {
    contratos: contracts,
    cobrancas: billings,
    pagamentos: payments,
    documentos: generatedContracts + documents,
    contexto: notes,
    historico: history,
    onboarding: onboardingPendentes,
  };

  return (
    <div>
      <ClientHeader
        client={client}
        summary={summary}
        monthly={monthly}
        risk={risk}
        upsell={
          canUpsell
            ? { services: upsellServices, offers: upsellOffers }
            : null
        }
      />

      <TabsNavigation clientId={params.id} counts={tabCounts} />

      {children}
    </div>
  );
}
