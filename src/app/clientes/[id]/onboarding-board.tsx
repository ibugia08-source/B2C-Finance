"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, Circle, Rocket, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { showUndoToast } from "@/components/undo-toast";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  concluirOnboardingAction, iniciarOnboardingAction, marcarTarefaAction,
} from "@/lib/actions/onboarding";
import type { QuadroOnboarding } from "@/lib/onboarding-meta";

/**
 * BOARD DE ONBOARDING DO CLIENTE (F1.18 · ref. 01 §4.11, 02 §4.2).
 *
 * As tarefas ficam agrupadas pelo PRAZO (D+7, D+30, D+90) e não por
 * estado, porque a pergunta do gestor não é "o que está feito?" e sim "o
 * que vence agora?". Estado é a cor da linha; prazo é a estrutura.
 *
 * Encerrar com obrigatória pendente é possível, mas exige motivo e grava
 * EXCEPTION em vez de COMPLETE (01 §4.11) — a diferença entre "fez tudo"
 * e "seguiu mesmo faltando" continua visível depois.
 */

const GRUPOS = [
  { dias: 7, titulo: "Primeira semana", legenda: "D+7" },
  { dias: 30, titulo: "Primeiro mês", legenda: "D+30" },
  { dias: 90, titulo: "Primeiro trimestre", legenda: "D+90" },
];

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Não iniciado",
  IN_PROGRESS: "Em andamento",
  COMPLETE: "Concluído",
  EXCEPTION: "Encerrado com exceção",
};

export function OnboardingBoard({
  quadro,
  clientId,
  podeEditar,
}: {
  quadro: QuadroOnboarding | null;
  clientId: string;
  podeEditar: boolean;
}) {
  const [pending, start] = useTransition();
  const [feitas, setFeitas] = useState<Record<string, boolean>>({});

  if (!quadro) {
    return (
      <EmptyState
        icon={Rocket}
        title="Este cliente ainda não tem relação com uma agência"
        description="O onboarding pertence à relação cliente–agência. Ela é criada junto com o cliente."
      />
    );
  }

  if (quadro.total === 0) {
    return (
      <EmptyState
        icon={Rocket}
        title="Onboarding não iniciado"
        description="Aplique o roteiro padrão: contrato, acessos, formulários de canal, kickoff, primeira campanha no ar e primeira reunião de resultado, com prazos de 7, 30 e 90 dias."
        action={
          podeEditar ? (
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await iniciarOnboardingAction(quadro.relationshipId, clientId);
                  showUndoToast({ message: r.ok ? (r.info ?? "Onboarding iniciado.") : r.error });
                })
              }
            >
              <Rocket className="mr-1 h-4 w-4" /> Iniciar onboarding
            </Button>
          ) : undefined
        }
      />
    );
  }

  const concluida = (id: string, doneAt: string | null) => feitas[id] ?? !!doneAt;
  const feitasTotal = quadro.tarefas.filter((t) => concluida(t.id, t.doneAt)).length;
  const pct = Math.round((feitasTotal / quadro.total) * 100);

  function alternar(id: string, valor: boolean) {
    setFeitas((p) => ({ ...p, [id]: valor })); // otimista (02 §7.7)
    start(async () => {
      const r = await marcarTarefaAction(id, valor, clientId);
      if (!r.ok) {
        setFeitas((p) => ({ ...p, [id]: !valor }));
        showUndoToast({ message: r.error });
      }
    });
  }

  async function encerrar() {
    const pendentes = quadro!.tarefas.filter((t) => t.required && !concluida(t.id, t.doneAt)).length;
    let motivo: string | null = null;
    if (pendentes > 0) {
      const seguir = await confirmAction({
        title: `Encerrar com ${pendentes} obrigatória(s) pendente(s)?`,
        description:
          "O onboarding fica marcado como encerrado COM exceção, e as pendências continuam aparecendo aqui.",
        confirmLabel: "Encerrar com exceção",
        destructive: true,
      });
      if (!seguir) return;
      motivo = `Encerrado com ${pendentes} obrigatória(s) pendente(s)`;
    }
    start(async () => {
      const r = await concluirOnboardingAction(quadro!.relationshipId, clientId, motivo);
      showUndoToast({ message: r.ok ? (r.info ?? "Onboarding encerrado.") : r.error });
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-caption uppercase tracking-wide text-muted-foreground">
              {STATUS_LABEL[quadro.status] ?? quadro.status}
            </p>
            <p className="mt-1 text-emphasis font-semibold">
              {feitasTotal} de {quadro.total} concluídas
              {quadro.obrigatoriasPendentes > 0 && (
                <span className="ml-2 text-caption font-normal text-warning">
                  {quadro.obrigatoriasPendentes} obrigatória(s) pendente(s)
                </span>
              )}
            </p>
            <div className="mt-2 h-1.5 w-56 max-w-full overflow-hidden rounded-pill bg-muted">
              <div
                className={cn("h-full rounded-pill", pct === 100 ? "bg-success" : "bg-primary")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {podeEditar && quadro.status !== "COMPLETE" && (
            <Button variant="outline" onClick={encerrar} disabled={pending}>
              Encerrar onboarding
            </Button>
          )}
        </CardContent>
      </Card>

      {GRUPOS.map((g) => {
        const doGrupo = quadro.tarefas.filter((t) => (t.offsetDays ?? 0) === g.dias);
        if (doGrupo.length === 0) return null;
        return (
          <div key={g.dias}>
            <p className="mb-1.5 text-caption font-medium uppercase tracking-wide text-muted-foreground">
              {g.titulo} <span className="font-mono">{g.legenda}</span>
            </p>
            <div className="overflow-hidden rounded-card border">
              {doGrupo.map((t, i) => {
                const ok = concluida(t.id, t.doneAt);
                return (
                  <div
                    key={t.id}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2.5",
                      i > 0 && "border-t",
                      ok && "bg-success-soft/40",
                      !ok && t.atrasada && "bg-danger-soft/30"
                    )}
                  >
                    <button
                      type="button"
                      disabled={!podeEditar || pending}
                      onClick={() => alternar(t.id, !ok)}
                      aria-label={`${ok ? "Reabrir" : "Concluir"} ${t.title}`}
                      className="mt-0.5 shrink-0 rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {ok ? (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-body font-medium", ok && "text-muted-foreground line-through")}>
                        {t.title}
                        {t.required && (
                          <span className="ml-1.5 text-caption font-normal text-muted-foreground">
                            obrigatória
                          </span>
                        )}
                      </p>
                      {t.description && (
                        <p className="text-caption text-muted-foreground">{t.description}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-caption">
                      {ok ? (
                        <span className="text-success">
                          {t.doneAt ? new Date(t.doneAt).toLocaleDateString("pt-BR") : "concluída"}
                        </span>
                      ) : t.atrasada ? (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <TriangleAlert className="h-3 w-3" aria-hidden />
                          venceu {t.dueAt ? new Date(t.dueAt).toLocaleDateString("pt-BR") : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          até {t.dueAt ? new Date(t.dueAt).toLocaleDateString("pt-BR") : "—"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
