import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/viewer";
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
  await requireAdmin();

  const [client, contracts, billings, payments, generatedContracts, documents, notes, history, summaries] =
    await Promise.all([
      prisma.client.findUnique({
        where: { id: params.id },
      }),
      prisma.contract.count({
        where: { clientId: params.id },
      }),
      prisma.billing.count({
        where: { clientId: params.id },
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

  const summary = summaries.get(params.id) || {
    activeContracts: 0,
    nextRenewal: null,
    totalRevenue: 0,
    openAmount: 0,
    overdueAmount: 0,
  };

  const monthly = client.monthlyValue != null ? Number(client.monthlyValue) : 0;

  const tabCounts: TabsCount = {
    contratos: contracts,
    recebimentos: billings,
    pagamentos: payments,
    documentos: generatedContracts + documents,
    notas: notes,
    historico: history,
  };

  return (
    <div>
      <ClientHeader
        client={client}
        summary={summary}
        monthly={monthly}
        risk={risk}
      />

      <TabsNavigation clientId={params.id} counts={tabCounts} />

      {children}
    </div>
  );
}
