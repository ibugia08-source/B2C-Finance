"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { showUndoToast } from "@/components/undo-toast";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { CalendarClock, Trash2 } from "lucide-react";
import {
  agendarRelatorioAction, removerAgendamentoAction,
} from "@/lib/actions/relatorios-agendados";

type Agendamento = {
  id: string;
  reportKey: string;
  frequency: string;
  recipients: string[];
  enabled: boolean;
  lastRunAt: string | null;
};

export function PainelDeAgendamentos({
  agendamentos,
  relatorios,
  podeEditar,
}: {
  agendamentos: Agendamento[];
  relatorios: { key: string; title: string }[];
  podeEditar: boolean;
}) {
  const [pending, start] = useTransition();
  const [reportKey, setReportKey] = useState(relatorios[0]?.key ?? "");
  const [frequency, setFrequency] = useState("SEMANAL");
  const [emails, setEmails] = useState("");
  const tituloDe = (key: string) => relatorios.find((r) => r.key === key)?.title ?? key;

  return (
    <div className="space-y-4">
      <p className="text-dense text-muted-foreground">
        A rotina diária monta o relatório do período anterior fechado e coloca o
        e-mail na fila de envio. Enquanto não houver provedor de e-mail
        configurado, os envios ficam aguardando na fila — nada se perde.
      </p>

      {podeEditar ? (
        <Card>
          <CardContent className="p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="ag-rel">Relatório</Label>
                <Select id="ag-rel" value={reportKey} onChange={(e) => setReportKey(e.target.value)}>
                  {relatorios.map((r) => (
                    <option key={r.key} value={r.key}>{r.title}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ag-freq">Frequência</Label>
                <Select id="ag-freq" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                  <option value="SEMANAL">Toda semana (semana anterior)</option>
                  <option value="MENSAL">Todo mês (mês anterior)</option>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ag-emails">Para quem (um e-mail por linha)</Label>
                <Textarea
                  id="ag-emails"
                  rows={2}
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  placeholder={"financeiro@empresa.com\ndono@empresa.com"}
                />
              </div>
            </div>
            <div className="mt-3">
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await agendarRelatorioAction(reportKey, frequency as any, emails);
                    showUndoToast({
                      message: r.ok ? "Agendamento salvo." : r.error,
                    });
                    if (r.ok) setEmails("");
                  })
                }
              >
                <CalendarClock className="mr-1.5 h-4 w-4" aria-hidden />
                Agendar envio
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {agendamentos.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nenhum relatório agendado"
          description="Escolha um relatório acima e ele passa a chegar por e-mail no fim de cada período."
        />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border-soft p-0">
            {agendamentos.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{tituloDe(a.reportKey)}</p>
                  <p className="text-caption text-muted-foreground">
                    {a.frequency === "MENSAL" ? "Mensal" : "Semanal"} ·{" "}
                    {a.recipients.join(", ")}
                    {a.lastRunAt
                      ? ` · último envio ${new Intl.DateTimeFormat("pt-BR").format(new Date(a.lastRunAt))}`
                      : " · ainda não enviado"}
                  </p>
                </div>
                <Badge variant={a.enabled ? "success" : "outline"}>
                  {a.enabled ? "Ativo" : "Pausado"}
                </Badge>
                {podeEditar ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: "Cancelar este envio?",
                        description: `“${tituloDe(a.reportKey)}” deixa de ser enviado. Os e-mails já na fila não são afetados.`,
                        confirmLabel: "Cancelar envio",
                      });
                      if (!ok) return;
                      start(async () => {
                        await removerAgendamentoAction(a.id);
                        showUndoToast({ message: "Agendamento removido." });
                      });
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Remover</span>
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
