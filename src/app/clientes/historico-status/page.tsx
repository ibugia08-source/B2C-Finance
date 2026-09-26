import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { can, requirePagePermission } from "@/lib/auth/viewer";
import { ApplyDueButton } from "./apply-due-button";
import { getTimelines, describeInterval } from "@/lib/clients/status-history";
import { CLIENT_STATUS_LABEL } from "../_meta";

export const dynamic = "force-dynamic";

const ORIGEM: Record<string, string> = {
  BACKFILL_INFERIDO: "Inferido",
  BACKFILL_INDETERMINADO: "Início desconhecido",
};

/**
 * REVISÃO DO HISTÓRICO DE STATUS (26/09/2026) — o relatório do que a
 * reconstrução NÃO conseguiu provar. Nada aqui foi inventado: onde faltou
 * data de entrada/saída, o status vale só a partir do que se sabe e o
 * período anterior fica sem status. Corrigir = "Alterar status" no cliente,
 * com a data real (permissão de alteração retroativa).
 */
export default async function HistoricoStatusRevisaoPage() {
  const viewer = await requirePagePermission("clientes.visualizar");
  const pendentes = await prisma.clientStatusHistory.findMany({
    where: { needsReview: true },
    select: { clientId: true },
    distinct: ["clientId"],
  });
  const ids = pendentes.map((p) => p.clientId);
  const [clientes, timelines] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, status: true, startedAt: true, churnedAt: true },
      orderBy: { name: "asc" },
    }),
    getTimelines(ids),
  ]);

  return (
    <div>
      <PageHeader
        title="Histórico de status a revisar"
        description="Clientes cuja linha do tempo de status foi reconstruída sem data suficiente"
        actions={can(viewer, "clientes.alterar_status") ? <ApplyDueButton /> : undefined}
      />
      <Card className="mb-4">
        <CardContent className="p-4 text-sm text-muted-foreground space-y-1">
          <p>
            A reconstrução usou só evidências: trilha de auditoria, perdas registradas, datas de entrada, saída e
            pausa, e as cobranças do cliente. Onde elas não bastaram, o status passou a valer a partir da data
            conhecida — os meses anteriores ficam <strong>sem status</strong> e não contam como ativos.
          </p>
          <p>
            Para corrigir, abra o cliente e use <strong>Alterar status</strong> com a data real (exige permissão de
            alteração retroativa e competência aberta).
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {clientes.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nenhum histórico pendente de revisão.</p>
          ) : (
            <ul className="divide-y">
              {clientes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <Link href={`/clientes/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      Hoje: {CLIENT_STATUS_LABEL[c.status as keyof typeof CLIENT_STATUS_LABEL] ?? c.status}
                      {c.startedAt ? "" : " · sem data de entrada"}
                    </p>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-0.5 text-right">
                    {(timelines.get(c.id) ?? []).map((i) => (
                      <li key={i.from}>
                        {CLIENT_STATUS_LABEL[i.status as keyof typeof CLIENT_STATUS_LABEL] ?? i.status} —{" "}
                        {describeInterval(i)}
                        {i.needsReview && ` · ${ORIGEM[i.origin] ?? "revisar"}`}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
