"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { showUndoToast } from "@/components/undo-toast";
import { cancelScheduledStatusChangeAction } from "@/lib/actions/client-status";
import { CLIENT_STATUS_LABEL, clientStatusPill } from "../_meta";
import { StatusChangeDialog } from "../status-change-dialog";

export type TimelineItem = {
  status: string;
  from: string;
  to: string | null;
  reason: string | null;
  origin: string;
  needsReview: boolean;
};

const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const rotulo = (s: string) => CLIENT_STATUS_LABEL[s as keyof typeof CLIENT_STATUS_LABEL] ?? s;
const ORIGEM: Record<string, string> = {
  USUARIO: "registrado por usuário",
  SISTEMA: "registrado pelo sistema",
  IMPORTACAO: "importação",
  BACKFILL_COMPROVADO: "reconstruído da trilha do sistema",
  BACKFILL_INFERIDO: "reconstruído por inferência",
  BACKFILL_INDETERMINADO: "início desconhecido",
};

/**
 * HISTÓRICO DE STATUS do cliente (26/09/2026): a linha do tempo com vigência,
 * o status atual, a próxima alteração programada (cancelável antes da data) e
 * o aviso quando a reconstrução do histórico precisa de conferência.
 * As datas chegam prontas do servidor ("hoje" do calendário da Bahia).
 */
export function StatusHistoryPanel({
  clientId,
  clientName,
  timeline,
  today,
  canChange,
  canSchedule,
}: {
  clientId: string;
  clientName: string;
  timeline: TimelineItem[];
  today: string;
  canChange: boolean;
  canSchedule: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const atual = timeline.find((i) => i.from <= today && (i.to == null || i.to >= today)) ?? null;
  const proxima = timeline.filter((i) => i.from > today).sort((a, b) => a.from.localeCompare(b.from))[0] ?? null;
  const revisar = timeline.some((i) => i.needsReview);

  async function cancelar(from: string) {
    if (
      !(await confirmAction({
        title: "Cancelar a alteração programada?",
        description: `A alteração que começaria em ${fmt(from)} deixa de existir e o status anterior continua valendo em diante.`,
        confirmLabel: "Cancelar alteração",
        destructive: true,
      }))
    )
      return;
    start(async () => {
      const r = await cancelScheduledStatusChangeAction({ clientId, effectiveFrom: from });
      showUndoToast({ message: r.ok ? "Alteração programada cancelada." : String(r.error) });
    });
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="font-semibold">Histórico de status</h3>
            <p className="text-sm">
              Status atual:{" "}
              {atual ? (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${clientStatusPill(atual.status)}`}>
                  {rotulo(atual.status)}
                </span>
              ) : (
                <span className="text-muted-foreground">sem registro</span>
              )}
            </p>
            {proxima && (
              <p className="text-sm text-info-ink">
                Próxima alteração: {rotulo(proxima.status)} a partir de {fmt(proxima.from)}
                {canSchedule && (
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-1 h-auto p-0 text-xs"
                    disabled={pending}
                    onClick={() => cancelar(proxima.from)}
                  >
                    cancelar
                  </Button>
                )}
              </p>
            )}
          </div>
          {canChange && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Alterar status
            </Button>
          )}
        </div>

        {revisar && (
          <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Parte deste histórico foi reconstruída sem data suficiente (sem data de entrada ou de saída registrada).
            Os períodos sem registro não contam como ativos. Para corrigir, use &quot;Alterar status&quot; com a data
            real — exige a permissão de alteração retroativa.
          </p>
        )}

        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem histórico de status.</p>
        ) : (
          <ol className="relative space-y-3 border-l pl-4">
            {[...timeline].reverse().map((i) => {
              const futuro = i.from > today;
              return (
                <li key={i.from} className="relative">
                  <span
                    aria-hidden
                    className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                      futuro ? "bg-info" : i === atual ? "bg-primary" : "bg-muted-foreground/40"
                    }`}
                  />
                  <p className="text-sm">
                    <span className="font-medium">{rotulo(i.status)}</span>{" "}
                    <span className="text-muted-foreground">
                      — {i.to == null ? `a partir de ${fmt(i.from)}` : `${fmt(i.from)} até ${fmt(i.to)}`}
                    </span>
                    {futuro && (
                      <span className="ml-2 rounded-full bg-info-soft px-1.5 py-0.5 text-[10px] font-medium text-info-ink">
                        programado
                      </span>
                    )}
                    {i.needsReview && (
                      <span className="ml-2 rounded-full border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        revisar
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ORIGEM[i.origin] ?? i.origin}
                    {i.reason ? ` · ${i.reason}` : ""}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        <StatusChangeDialog
          open={open}
          onOpenChange={setOpen}
          clientIds={[clientId]}
          clientName={clientName}
          currentStatus={atual?.status ?? null}
          competence={today.slice(0, 7)}
          today={today}
        />
      </CardContent>
    </Card>
  );
}
